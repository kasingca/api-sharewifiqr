# ShareWiFiQR frontend instructions

Use this guide when building or changing the portal at `https://portal.sharewifiqr.com`. The frontend owns the pages and navigation. The API at `https://api.sharewifiqr.com` owns Okta sign-in, sessions, account roles, and authorization.

## Homepage

Make `/` the public sign-in page. Keep the layout centered and leave out the sidebar and dashboard navigation.

- **Title** — ShareWiFiQR Portal
- **Description** — Sign in or create an account to manage your Wi-Fi QR codes.
- **Log in** — Primary filled button linking to `https://api.sharewifiqr.com/v1/auth/login`.
- **Sign up** — Secondary outlined button linking to `https://api.sharewifiqr.com/v1/auth/login?intent=signup`.

Use the project's typography and colors. Place the buttons side by side when there is room and stack them on narrow screens. Give both a visible keyboard focus state. Use normal links or full-page browser navigation for authentication. Okta handles credential entry. First-time eligible Google sign-ups receive a customer account.

If the browser returns to `/?error=sign_in_failed`, show “We couldn’t complete sign-in. Please try again.” near the buttons.

## Authentication and persona routing

Okta returns the browser to the API callback at `https://api.sharewifiqr.com/v1/auth/callback`. The frontend does not need a callback route or an Okta SDK. The API validates sign-in, sets a Secure, HttpOnly cookie scoped to the API host, and redirects the browser according to the account’s stored role.

| Signed-in persona | Portal route |
| --- | --- |
| Customer | `/customer` |
| Administrator | `/admin` |

On either protected route, check the session from the browser before rendering dashboard content.

```js
const response = await fetch(new URL('/v1/me', apiOrigin), {
  credentials: 'include',
  cache: 'no-store',
});
```

- While the request is pending, show “Checking your session…” and keep protected content hidden.
- On `200`, read `destination` from the response. Accept only `/customer` or `/admin`. If the current page differs, replace the current route with that destination. Otherwise render the dashboard.
- On `401`, replace the current route with `/`.
- On other statuses, network failure, or a malformed response, keep protected content hidden and offer a retry.

The API supplies the destination. Use `actor.role` for display or navigation after loading the session. The API must authorize every protected operation. Keep session data and the CSRF token in memory and let the browser manage the session cookie. Because the cookie is scoped to the API host, ordinary portal-side middleware cannot read it.

## API reference

| Method and path | Frontend use |
| --- | --- |
| `GET /v1/me` | Read the current session with `credentials: 'include'`. |
| `PATCH /v1/me` | Update the signed-in account's first name, last name, or both. |
| `GET /v1/customers/{customerId}/payment-method` | Read the customer's saved payment method. |
| `PUT /v1/customers/{customerId}/payment-method` | Save the customer's payment method choice (`stripe` or `paypal`). |
| `DELETE /v1/session` | Sign out with `credentials: 'include'` and `X-CSRF-Token` set to the token from `/v1/me`. |
| `GET /v1/plans` | Read the public plan catalog. Prices are monthly USD cents. |
| `GET /health` | Check API availability from deployment tooling. |

`GET /v1/me` returns `destination`, `actor` (`publicId`, `role`, `firstName`, `lastName`, `email`), `effectiveCustomer` (`publicId`, `plan`), and `csrfToken`. Use `actor` for the signed-in identity. The current API returns the same account in `effectiveCustomer` and has no customer-switching endpoint.

For profile edits, send JSON with `firstName`, `lastName`, or both. Send `credentials: 'include'`, `Content-Type: application/json`, and `X-CSRF-Token` from the current session response. Names are trimmed and must contain 1–150 characters. The API takes the account from the session and accepts only the two name fields. After a `204` response, refresh `GET /v1/me` to show the saved names. A `400` indicates invalid profile input, a `401` indicates the session is unavailable, and a `403` indicates a rejected origin or CSRF token. The API does not accept email changes. Show the email from `actor.email` as read-only.

### Payment method

Customers have one payment method. Only show this section to customers (`actor.role === 'customer'`). Use `effectiveCustomer.publicId` from `GET /v1/me` as `{customerId}`. The API returns `404` when the session's account doesn't own that customer ID, which includes administrators.

Read it when the profile page loads.

```js
const url = new URL(`/v1/customers/${session.effectiveCustomer.publicId}/payment-method`, apiOrigin);
const response = await fetch(url, { credentials: 'include', cache: 'no-store' });
const { paymentMethod } = await response.json();
```

`paymentMethod` is `null` until the customer saves a choice. Otherwise it is `{ provider, updatedAt }`, where `provider` is `"stripe"` or `"paypal"` and `updatedAt` is an ISO 8601 UTC timestamp. When the value is `null`, select neither radio option and keep the save button disabled until the customer picks one.

To save, replace the whole resource with `PUT`.

```js
const response = await fetch(url, {
  method: 'PUT',
  credentials: 'include',
  headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': session.csrfToken },
  body: JSON.stringify({ provider: 'paypal' }),
});
```

The body must contain exactly one field, `provider`, set to `"stripe"` or `"paypal"`. A `200` response returns the saved `{ paymentMethod }`. Use it to update the page without another request. A `400` (`invalid_payment_method`) indicates a bad body, a `401` indicates the session is unavailable, a `403` indicates a rejected origin or CSRF token, and a `404` indicates the customer ID isn't the signed-in customer's. Sending the same provider again is safe.

This stores the customer's preference only. It doesn't collect card or PayPal details or charge anything. Never send card numbers or account credentials to this endpoint. Stripe and PayPal checkout will use their hosted pages in a later phase. Replace any "saved in this browser" demo copy and remove local storage of the choice.

After sign-out returns `204`, clear frontend session state and replace the current route with `/`. On `401`, clear session state and return to `/` as well. On other failures, show an error and allow retry. API error responses use `{ error: { code, message, requestId } }`.

Check the backend contract before wiring any feature that needs a new endpoint. The persona redirects do not provide admin management, checkout, billing history, or QR-code APIs.

## Environment and acceptance checks

Configure the API base URL in the frontend for each environment. The backend's `PORTAL_ORIGIN` must exactly match the deployed frontend origin for credentialed requests. Use a paired HTTPS portal and API for staging. Administrator sign-in requires a provisioned staff account, the Okta staff MFA policy, and `OKTA_ADMIN_SIGN_IN_ENABLED=true` on the backend.

Before shipping changes to sign-in or routing, verify both links go through Okta, customers arrive at `/customer`, administrators arrive at `/admin`, and a signed-in user opening the other persona’s URL returns to their own dashboard. Verify signed-out visits go back to `/`, callback failures show the retry message, and sign-out ends the session.
