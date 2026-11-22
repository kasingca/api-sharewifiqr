import assert from 'node:assert/strict'
import test from 'node:test'
import { createApi } from '../src/app.ts'

const portal = 'https://portal.sharewifiqr.com'
const handle = createApi(portal)
const request = (path: string, init?: RequestInit) =>
  handle(new Request('https://api.sharewifiqr.com' + path, init))

test('the home root returns an authentication error', async () => {
  const response = await request('/')
  assert.equal(response.status, 401)
  assert.deepEqual(await response.json(), {
    error: {
      code: 'unauthenticated',
      message: 'Sorry, this request is not authenticated.',
      requestId: response.headers.get('x-request-id'),
    },
  })
})

test('health is public and uncached', async () => {
  const response = await request('/health')
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('cache-control'), 'no-store')
  assert.deepEqual(await response.json(), { status: 'ok' })
})

test('plan catalog uses USD minor units and account quotas', async () => {
  const response = await request('/v1/plans', { headers: { Origin: portal } })
  assert.equal(response.headers.get('access-control-allow-origin'), portal)
  assert.equal(response.headers.get('access-control-allow-credentials'), 'true')
  const { plans } = await response.json()
  assert.deepEqual(plans.map(({ monthlyPrice, trackedCodes, monthlyTrackedScans }: Record<string, number>) =>
    [monthlyPrice, trackedCodes, monthlyTrackedScans]), [[0, 1, 100], [100, 10, 1000], [600, 50, 10000]])
})

test('preflight validates origin and supported headers', async () => {
  for (const [origin, status] of [[portal, 204], ['https://www.sharewifiqr.com', 403]] as const) {
    const response = await request('/v1/session', {
      method: 'OPTIONS',
      headers: { Origin: origin, 'Access-Control-Request-Method': 'DELETE', 'Access-Control-Request-Headers': 'X-CSRF-Token' },
    })
    assert.equal(response.status, status)
    assert.equal(response.headers.get('access-control-allow-origin'), status === 204 ? portal : null)
  }
})

test('unknown routes and unsupported methods return rest errors', async () => {
  assert.equal((await request('/v1/unknown')).status, 404)
  const response = await request('/v1/plans', { method: 'POST' })
  assert.equal(response.status, 405)
  assert.equal(response.headers.get('allow'), 'GET, OPTIONS')
  assert.equal((await response.json()).error.code, 'method_not_allowed')
})

test('session bootstrap requires a session cookie', async () => {
  const response = await request('/v1/me', { headers: { Origin: portal } })
  assert.equal(response.status, 401)
})

test('sign-out requires the portal origin and session-bound CSRF token', async () => {
  const token = 'a'.repeat(43)
  const csrfToken = 'b'.repeat(43)
  let signedIn = true
  const handle = createApi(portal, {
    login: async () => new Response(null, { status: 303 }),
    callback: async () => new Response(null, { status: 303 }),
    me: async value => signedIn && value === token ? { csrfToken } : undefined,
    logout: async (value, csrf) => {
      if (value !== token || csrf !== csrfToken) return false
      signedIn = false
      return true
    },
  })
  const cookie = '__Host-sharewifiqr_session=' + token
  const url = 'https://api.sharewifiqr.com'
  assert.equal((await handle(new Request(url + '/v1/me', { headers: { cookie } }))).status, 200)
  const signOut = (origin: string, csrf: string) => handle(new Request(url + '/v1/session', {
    method: 'DELETE', headers: { cookie, origin, 'x-csrf-token': csrf },
  }))
  assert.equal((await signOut('https://www.sharewifiqr.com', csrfToken)).status, 403)
  assert.equal((await signOut(portal, 'wrong')).status, 403)
  const response = await signOut(portal, csrfToken)
  assert.equal(response.status, 204)
  assert.match(response.headers.get('set-cookie') ?? '', /Max-Age=0/)
  assert.equal((await handle(new Request(url + '/v1/me', { headers: { cookie } }))).status, 401)
})
