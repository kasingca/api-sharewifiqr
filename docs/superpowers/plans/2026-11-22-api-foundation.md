# Vercel API foundation implementation plan

1. Verify Vercel routing through the Web Request handler with tests for health, plan catalog, exact-origin CORS, and method errors.
2. Define the TiDB account and session schema and initial migration. Wire the Drizzle HTTP adapter.
3. Add Okta Google Authorization Code with PKCE and server-owned session bootstrap and revocation. Verify browser-facing behavior with fake dependencies and document live verification.
4. Write the Okta, Google, TiDB, and Vercel setup instructions. QR management, analytics, administration, and billing follow this foundation.
