import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { connect } from '@tidbcloud/serverless'
import { and, eq, gt, sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/tidb-serverless'
import * as oidc from 'oauth4webapi'
import { readCookie, sessionCookie, type Identity } from './app.ts'
import { portalDestination } from './persona.ts'
import { accounts, loginAttempts, sessions } from './db/schema.ts'

const attemptCookie = '__Host-sharewifiqr_login'
const loginLifetime = 600
const idleLifetime = 30 * 60
const sessionLifetime = 12 * 60 * 60
const randomToken = () => randomBytes(32).toString('base64url')
const digest = (value: string) => createHash('sha256').update(value).digest('hex')
const nowSeconds = () => Math.floor(Date.now() / 1000)
const cookie = (name: string, value: string, lifetime: number) =>
  `${name}=${value}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${lifetime}`

export function createIdentity(env: NodeJS.ProcessEnv, portalOrigin: string): Identity | undefined {
  const { TIDB_URL, API_ORIGIN, OKTA_ISSUER, OKTA_CLIENT_ID, OKTA_CLIENT_SECRET, OKTA_GOOGLE_IDP_ID } = env
  if (!TIDB_URL || !API_ORIGIN || !OKTA_ISSUER || !OKTA_CLIENT_ID || !OKTA_CLIENT_SECRET || !OKTA_GOOGLE_IDP_ID) return

  const adminSignInEnabled = env.OKTA_ADMIN_SIGN_IN_ENABLED === 'true'
  const db = drizzle({ client: connect({ url: TIDB_URL }) })
  const callbackUrl = new URL('/v1/auth/callback', API_ORIGIN).href
  const issuer = new URL(OKTA_ISSUER)
  const client: oidc.Client = { client_id: OKTA_CLIENT_ID }
  const clientAuth = oidc.ClientSecretBasic(OKTA_CLIENT_SECRET)
  let discovery: Promise<oidc.AuthorizationServer> | undefined
  const config = () => discovery ??= oidc.discoveryRequest(issuer)
    .then(response => oidc.processDiscoveryResponse(issuer, response))
    .catch(error => {
      discovery = undefined
      throw error
    })

  const failedLogin = () => new Response(null, {
    status: 303,
    headers: {
      Location: new URL('/?error=sign_in_failed', portalOrigin).href,
      'Set-Cookie': cookie(attemptCookie, '', 0),
    },
  })
  const activeSession = (token: string, now: number) => and(
    eq(sessions.digest, digest(token)), gt(sessions.expiresAt, now), gt(sessions.idleUntil, now),
  )

  return {
    async login(request) {
      const authorizationServer = await config()
      const attempt = randomToken()
      const state = randomToken()
      const nonce = randomToken()
      const verifier = randomToken()
      if (!authorizationServer.authorization_endpoint) throw new Error('Missing authorization endpoint')
      const authorizationUrl = new URL(authorizationServer.authorization_endpoint)
      const parameters = {
        client_id: client.client_id,
        response_type: 'code',
        response_mode: 'query',
        redirect_uri: callbackUrl,
        scope: 'openid profile email',
        code_challenge: await oidc.calculatePKCECodeChallenge(verifier),
        code_challenge_method: 'S256',
        state,
        nonce,
      }
      for (const [name, value] of Object.entries(parameters)) authorizationUrl.searchParams.set(name, value)
      const signUp = new URL(request.url).searchParams.get('intent') === 'signup'
      if (signUp || !adminSignInEnabled) authorizationUrl.searchParams.set('idp', OKTA_GOOGLE_IDP_ID)
      await db.insert(loginAttempts).values({
        digest: digest(attempt), state, nonce, verifier, expiresAt: nowSeconds() + loginLifetime,
      })
      return new Response(null, {
        status: 303,
        headers: { Location: authorizationUrl.href, 'Set-Cookie': cookie(attemptCookie, attempt, loginLifetime) },
      })
    },

    async callback(request) {
      const attempt = readCookie(request, attemptCookie)
      if (!attempt || !/^[A-Za-z0-9_-]{43}$/.test(attempt)) return failedLogin()
      const key = digest(attempt)
      const now = nowSeconds()
      const attemptFilter = and(eq(loginAttempts.digest, key), gt(loginAttempts.expiresAt, now))
      const [pending] = await db.select().from(loginAttempts).where(attemptFilter).limit(1)
      const params = new URL(request.url).search
      const responseUrl = new URL(callbackUrl + params)
      if (!pending || responseUrl.searchParams.get('state') !== pending.state) return failedLogin()

      const consumed = await db.delete(loginAttempts).where(attemptFilter)
      if (consumed.rowsAffected !== 1) return failedLogin()
      const authorizationServer = await config()
      let claims: oidc.IDToken | undefined
      try {
        const callback = oidc.validateAuthResponse(authorizationServer, client, responseUrl, pending.state)
        const tokenResponse = await oidc.authorizationCodeGrantRequest(
          authorizationServer, client, clientAuth, callback, callbackUrl, pending.verifier,
        )
        const tokens = await oidc.processAuthorizationCodeResponse(authorizationServer, client, tokenResponse, {
          expectedNonce: pending.nonce,
          requireIdToken: true,
        })
        await oidc.validateApplicationLevelSignature(authorizationServer, tokenResponse)
        claims = oidc.getValidatedIdTokenClaims(tokens)
      } catch {
        return failedLogin()
      }
      if (!claims || !claims.sub || claims.sub.length > 255 || claims.iss.length > 255 ||
          claims.email_verified !== true || typeof claims.email !== 'string' ||
          !claims.email || claims.email.length > 320) return failedLogin()

      const identityKey = digest(JSON.stringify([claims.iss, claims.sub]))
      const id = randomUUID()
      await db.insert(accounts).values({
        id,
        publicId: createHash('md5').update(id).digest('hex'),
        identityKey,
        issuer: claims.iss,
        subject: claims.sub,
        email: claims.email,
        firstName: typeof claims.given_name === 'string' ? claims.given_name.slice(0, 150) : '',
        lastName: typeof claims.family_name === 'string' ? claims.family_name.slice(0, 150) : '',
      }).onDuplicateKeyUpdate({ set: { identityKey: sql`identity_key` } })
      const [account] = await db.select().from(accounts).where(eq(accounts.identityKey, identityKey)).limit(1)
      const destination = account && portalDestination(account, adminSignInEnabled)
      if (!destination) return failedLogin()

      const token = randomToken()
      const previous = readCookie(request, sessionCookie)
      if (previous) await db.delete(sessions).where(eq(sessions.digest, digest(previous)))
      const issuedAt = nowSeconds()
      await db.insert(sessions).values({
        digest: digest(token), accountId: account.id, csrfToken: randomToken(),
        createdAt: issuedAt, expiresAt: issuedAt + sessionLifetime, idleUntil: issuedAt + idleLifetime,
      })
      const headers = new Headers({ Location: new URL(destination, portalOrigin).href })
      headers.append('Set-Cookie', cookie(attemptCookie, '', 0))
      headers.append('Set-Cookie', cookie(sessionCookie, token, sessionLifetime))
      return new Response(null, { status: 303, headers })
    },

    async me(token) {
      const now = nowSeconds()
      const filter = activeSession(token, now)
      const [row] = await db.select().from(sessions)
        .innerJoin(accounts, eq(sessions.accountId, accounts.id)).where(filter).limit(1)
      if (!row) return
      const destination = portalDestination(row.accounts, adminSignInEnabled)
      if (!destination) return
      await db.update(sessions).set({ idleUntil: sql`greatest(${sessions.idleUntil}, ${now + idleLifetime})` }).where(filter)
      const { publicId, role, plan, firstName, lastName, email } = row.accounts
      return {
        destination,
        actor: { publicId, role, firstName, lastName, email },
        effectiveCustomer: { publicId, plan },
        csrfToken: row.sessions.csrfToken,
      }
    },

    async logout(token, csrfToken) {
      const filter = activeSession(token, nowSeconds())
      const [row] = await db.select({ expected: sessions.csrfToken }).from(sessions).where(filter).limit(1)
      if (!row || !/^[A-Za-z0-9_-]{43}$/.test(csrfToken) ||
          !timingSafeEqual(Buffer.from(row.expected), Buffer.from(csrfToken))) return false
      await db.delete(sessions).where(filter)
      return true
    },
  }
}
