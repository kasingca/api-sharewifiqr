# ShareWiFiQR API design

## Architecture

Deploy the backend as its own Vercel project with TypeScript route handlers running as Node.js Vercel Functions. Bind https://api.sharewifiqr.com to that project. The production custom domain must serve the REST routes, Okta callback, payment webhooks, and permanent public scan URLs. Keep management, public scan, and provider webhook handlers in separate route modules. Use MySQL-compatible TiDB Cloud Starter with Drizzle ORM. The Vercel API uses `drizzle-orm/tidb-serverless` and the `@tidbcloud/serverless` HTTPS driver, configured with a server-only `TIDB_URL`. Define the schema in TypeScript. Generate and review versioned SQL migrations with Drizzle Kit, then apply them once per environment as a release step with dedicated migration credentials. Keep secrets in deployment configuration. Use separate staging data, origins, and identity credentials. Plan for commercial Vercel hosting and a production Okta tenant before public signup. The Okta Integrator Free Plan is for development.

The public website links to the Next.js portal. The portal renders a neutral shell and calls the API directly from the browser with credentials included.

PingCAP documents the HTTP driver as public preview. Pin compatible package versions and verify migrations, transactions, and concurrent quota enforcement against a staging TiDB instance before launch. A free Starter instance can throttle database operations when its quota is exhausted. A database outage must return a temporary unavailable response, rather than a plan-required response, when entitlement cannot be checked.

## Approaches

Use the standalone API to serve public guest HTML directly. This avoids a second request and keeps the entitlement check and credential disclosure in one handler. A separate guest renderer could be introduced later with an opaque identifier and its own disclosure check. The printed URL stays on the API in either arrangement.

Generate the preview and downloadable PNG in the portal using `import QRCode from 'qrcode'` and `QRCode.toDataURL(scanUrl, { width: 1024, margin: 4 })`. The API issues the canonical URL. Both the image and Copy link use that value.

## Identity and authorization

Use Okta with Google as the customer identity provider. Public signup provisions a Free customer once per verified issuer and subject. Use authorization code with PKCE, state, and nonce. The API handles the callback and stores only a digest of the opaque session identifier in TiDB. Use a host-only `__Host-sharewifiqr_session` cookie with Secure, HttpOnly, SameSite=Lax, and Path=/.

Allow credentialed CORS only from the configured portal origin. Require exact Origin and a session-bound CSRF token on authenticated browser mutations. Validate ownership and role on each request. Provision administrators separately, require MFA, and start with short-lived, audited, read-only customer views. Set explicit idle and absolute session expiry before launch.

## REST API

Publish an OpenAPI contract for versioned JSON endpoints. Use resource nouns, bounded pagination, deterministic ordering, stable error codes and request IDs. Return 201 with Location on creation and 204 on successful session deletion. Use no-store on private and credential-bearing responses.

| Endpoints | Responsibilities |
| --- | --- |
| GET /v1/auth/login and GET /v1/auth/callback | Okta browser redirects and session issuance |
| GET /v1/me, PATCH /v1/me/profile, DELETE /v1/session | Session bootstrap, profile and sign-out |
| GET and POST /v1/customers/{customerId}/codes | List and create tracked codes |
| GET and PATCH /v1/customers/{customerId}/codes/{codeId} | Read and update metadata and network configuration |
| GET /v1/customers/{customerId}/codes/{codeId}/credentials | Authorized password reveal |
| GET /v1/customers/{customerId}/scan-activity | Account and optional per-code activity, quota and reset time |
| GET /v1/plans | Plan catalog |
| GET /v1/customers/{customerId}/subscription and POST /v1/customers/{customerId}/subscription-changes | Subscription state and change requests |
| GET /v1/customers/{customerId}/payments | Shared customer and administrator billing history |
| /v1/admin and /v1/webhooks | Admin resources and signed payment provider events |

## Permanent QR links

Serve GET /<customer-id>/q/<code-id>. Use a persisted lowercase 32-character public customer ID and a persisted UUID for the code. Generate the canonical URL from the configured API origin. A code lookup must match both identifiers. For example:

```text
https://api.sharewifiqr.com/b2693d9c2124f3ca9547b897794ac6a1/q/4aa5b5c5-0546-42fc-850b-d7d36a6082ed
```

The image contains only this URL. Edits, plan changes, and policy changes preserve it. Check link availability and the owner's current entitlement before decrypting the Wi-Fi password. Encrypt recoverable passwords at rest and exclude them from lists, logs, and redirects. Send no-store on guest responses and prevent indexing.

Use an explicit deployment policy with two modes:

| Policy | Active Free link | Active Plus or Business link |
| --- | --- | --- |
| Launch | Serve Wi-Fi details | Serve Wi-Fi details |
| Paid-only | Serve plan-required page | Serve Wi-Fi details |

Existing Free links follow the paid-only policy when enabled. A verified upgrade restores access at the same URL. The guest page says “The owner needs to activate a paid plan to share Wi-Fi with this QR code.” The owner portal offers an upgrade to Plus. Unresolved and disabled links show a generic unavailable page.

Eligible guest pages show the SSID, password copy control where applicable, and manual join instructions. Offer an optional Android settings intent through a user-initiated button only after testing it on supported devices. Guests can always follow the manual instructions.

## Plans, analytics, and billing

| Plan | USD monthly | Tracked codes | Monthly tracked scans |
| --- | ---: | ---: | ---: |
| Free | 0 | 1 | 100 |
| Plus | 1 | 10 | 1,000 |
| Business | 6 | 50 | 10,000 |

Every plan includes tracked-code editing and owner-scoped analytics. The handoff's direct Wi-Fi codes are separate from portal-managed tracked links. Count qualifying visits against an account-wide cap atomically. The cap stops analytics collection while eligible guest links continue to work. Return used count, limit, reset timestamp, and incomplete-period indicators. Show approaching-limit usage, then Compare plans at the cap or Contact support on Business.

Apply confirmed paid upgrades immediately, preserving scans already counted in the period. Schedule downgrades at the next billing period. Stripe and PayPal hosted flows and verified idempotent webhooks control paid entitlement. Persist effective-dated subscription and immutable price history.

## Delivery and acceptance

1. Establish migrations, identity and sessions. Verify signup to Free, cookie scope, portal reload, exact-origin CORS, CSRF, and sign-out on paired HTTPS origins.
2. Build QR management and guest resolution. Decode one downloaded PNG, edit the stored credentials, and confirm the original image shows the new details. Test mismatched customer and code identifiers.
3. Build analytics and quotas. Verify concurrent boundary requests, capped periods, and continued guest access at the analytics cap.
4. Build administration and billing. Verify role and ownership checks, audited support access, provider retries, and entitlement changes.
5. Verify the production API domain resolves to the Vercel project over HTTPS and serves the REST API and guest route. Scan the same PNG on launch Free, paid-only Free, and paid-only Plus. Confirm Wi-Fi details, the plan-required page, then Wi-Fi details. Test iOS and Android manually.

Before their respective phases, settle legacy printed-link support, pause and retirement rules, scan qualification and reporting timezone, retention, downgrade behavior for over-limit code inventories, and payment-provider switching. Update the portal's privacy copy against actual data flows before launch. Browser demo data is outside the production migration.
