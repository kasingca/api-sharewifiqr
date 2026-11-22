# Set up the ShareWiFiQR API

The first release slice provides health, plan catalog, customer sign-in, session bootstrap, and sign-out. The backend is a standalone Vercel project. Use Node.js 22 and a separate staging portal, API, Okta app, and database for integration testing.

## Google and Oktas

1. Create or select a Google Cloud project. Configure the OAuth consent screen for an **External** audience and add test users while it is in testing mode. Create a **Web application** OAuth client. Add the redirect URI shown in Okta's Google social login guide, typically `https://YOUR_OKTA_DOMAIN/oauth2/v1/authorize/callback`. Use your actual Okta domain and follow Okta's custom-domain instructions if applicable.
2. In Okta Admin Console, go to **Security → Identity Providers** and add **Google**. Enter the Google client ID and secret in Okta. Enable just-in-time provisioning for new users, restrict provisioning to the intended customer population, and keep automatic linking to existing identities disabled unless you have explicitly reviewed the linking policy. Copy the Google identity provider ID into `OKTA_GOOGLE_IDP_ID`.
3. In **Applications → Applications**, create an **OIDC Web Application**. Enable Authorization Code and configure Client secret authentication using HTTP Basic (`client_secret_basic`). Register the exact sign-in redirect URI `https://api.sharewifiqr.com/v1/auth/callback`. Use the staging API URL in the staging app. Set app assignment and sign-on policies to allow newly provisioned customers. Keep privileged staff identities and policies separate.
4. Set `OKTA_ISSUER` to the exact issuer of the authorization server used by this client. The starting configuration uses the Okta org authorization server, such as `https://YOUR_OKTA_DOMAIN`. Set `OKTA_CLIENT_ID` and `OKTA_CLIENT_SECRET` from the **Okta OIDC application**. The API requests `openid profile email` and requires a verified email in the ID token. Confirm this claim with a test account before public signup.
5. Move the Google OAuth consent screen to production when ready and satisfy any Google publication requirements. Use a production Okta tenant for public signup. The Integrator Free Plan is a test sandbox capped at ten active users.

[Okta Google social login](https://developer.okta.com/docs/guides/social-login/google/main/) · [Okta web authorization code flow](https://developer.okta.com/docs/guides/implement-grant-type/authcode/main/) · [Okta sandbox limits](https://developer.okta.com/docs/reference/org-defaults/)

## TiDB Cloud and Drizzle

1. Create a **MySQL-compatible TiDB Cloud Starter** instance. Create a database named `sharewifiqr`. Set up a separate staging instance or database with separate credentials.
2. From the TiDB Cloud **Connect** dialog, get the Serverless Driver URL for the database. Use a database account limited to SELECT, INSERT, UPDATE, and DELETE on the application database. Save it as `TIDB_URL` in Vercel.
3. Create a separate credential for migrations. Use the MySQL direct connection URI, as `TIDB_MIGRATION_URL` on your release machine. Drizzle Kit enables TLS and certificate verification for that connection. URL-encode credentials when assembling a URI. Keep the migration credential out of the Vercel runtime.
4. From the API project root, install dependencies and run migrations. The shell must export the migration URL. For local use, copy `.env.example` to `.env.local` and load it with Node's `--env-file` option.

```sh
npm install
npm run typecheck
npm test
node --env-file=.env.local node_modules/drizzle-kit/bin.cjs migrate
```

Drizzle schema changes belong in `src/db/schema.ts`. Run `npm run db:generate`, review the SQL, and commit the generated files. Run migrations once per environment as a release step. Configure periodic cleanup of expired rows in `login_attempts` and `sessions` before production traffic. Both tables store expiry as Unix seconds.

[TiDB Cloud connection setup](https://docs.pingcap.com/tidbcloud/connect-to-tidb-cluster-serverless/) · [TiDB HTTP driver](https://docs.pingcap.com/tidbcloud/serverless-driver-config/) · [Drizzle TiDB setup](https://orm.drizzle.team/docs/mysql/connect-tidb)

## Local development

Run `npm run dev` with Node.js 22 to start the API at `http://localhost:3030`. The server loads `.env.local` if present. You can check the root and health endpoints without Okta or TiDB credentials.

```sh
curl -i http://localhost:3030/
curl -i http://localhost:3030/health
```

## Vercel and validation

1. Import this repository as a dedicated Vercel project with the **Other** framework preset and Node.js 22. If deploying from this directory with the CLI, run `npx vercel login` and `npx vercel link` first.
2. Set `API_ORIGIN=https://api.sharewifiqr.com`, `PORTAL_ORIGIN=https://portal.sharewifiqr.com`, and the runtime TiDB and Okta variables above under **Settings → Environment Variables**. Keep staging credentials and exact origins isolated from production.
3. Add `api.sharewifiqr.com` under **Settings → Domains** and create the DNS record Vercel shows. Deploy from the Vercel dashboard or use `npx vercel --prod`. Use a Vercel plan that permits commercial use for the paid product.
4. Confirm the production domain serves health and the plan catalog. The health response checks the HTTP handler rather than external dependencies.

```sh
curl -i https://api.sharewifiqr.com/health
curl -i https://api.sharewifiqr.com/v1/plans
```

5. Point the portal's sign-in button at `https://api.sharewifiqr.com/v1/auth/login` using a top-level navigation. After Google sign-in, confirm the browser returns to `/customer` with a host-only `__Host-sharewifiqr_session` cookie on the API host. The API defaults to a 30-minute idle timeout and a 12-hour absolute lifetime.
6. From the portal browser, call `GET /v1/me` with `credentials: 'include'`. Confirm the customer is on Free. Send `DELETE /v1/session` with the same credentials setting and the returned CSRF token in `X-CSRF-Token`. Confirm the next `GET /v1/me` returns 401. Repeat sign-in on a paired HTTPS staging portal and API before production.

[Deploy Vercel Functions](https://vercel.com/docs/functions) · [Vercel custom domains](https://vercel.com/docs/domains/working-with-domains/add-a-domain)


## Portal and personas

Set `PORTAL_ORIGIN` on the API project to the exact origin of the separately deployed portal. The portal links to `/v1/auth/login` for log-in and `/v1/auth/login?intent=signup` for sign-up on the paired API. The API redirects successful sign-ins to `/customer` or `/admin` and returns the same path as `destination` in the authenticated `/v1/me` response.

**Sign up** sends users to Google through Okta with just-in-time customer provisioning. **Log in** uses the same Google flow by default. With `OKTA_ADMIN_SIGN_IN_ENABLED=true`, **Log in** uses the Okta app's sign-in and identity-provider routing policies so staff can use their assigned identity provider. Configure routing and require MFA for the staff group on this OIDC app before enabling the setting. Test the staff policy through both portal links to confirm Google sign-up cannot authenticate a staff identity without the required policy.

Assign the admin role only to separately provisioned staff accounts by their verified Okta issuer and subject. Revoke all sessions for the affected account before changing its role, using a maintenance window or pausing the account while applying the change. New accounts receive the customer role. Verify that a new customer lands on `/customer`, a provisioned staff member lands on `/admin`, a cross-persona visit returns to the signed-in user's destination, and a signed-out visit to either page returns to the homepage.
