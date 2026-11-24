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
    updateProfile: async () => 'unauthenticated',
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

test('profile reads and updates require a session and updates accept only names', async () => {
  const token = 'a'.repeat(43)
  const csrf = 'b'.repeat(43)
  let actor = { firstName: 'Avery', lastName: 'Chen', email: 'avery@example.com' }
  const api = createApi(portal, {
    login: async () => new Response(null, { status: 303 }),
    callback: async () => new Response(null, { status: 303 }),
    me: async value => value === token ? { actor, csrfToken: csrf } : undefined,
    logout: async () => false,
    updateProfile: async (value, suppliedCsrf, names) => {
      if (value !== token) return 'unauthenticated'
      if (suppliedCsrf !== csrf) return 'csrf_denied'
      actor = { ...actor, ...names }
      return 'updated'
    },
  })
  const url = 'https://api.sharewifiqr.com/v1/me'
  const cookie = '__Host-sharewifiqr_session=' + token
  const patch = (body: object, headers: Record<string, string> = {}) => api(new Request(url, {
    method: 'PATCH',
    headers: { origin: portal, cookie, 'content-type': 'application/json', 'x-csrf-token': csrf, ...headers },
    body: JSON.stringify(body),
  }))
  const preflight = await api(new Request(url, { method: 'OPTIONS', headers: {
    origin: portal, 'access-control-request-method': 'PATCH',
    'access-control-request-headers': 'content-type,x-csrf-token',
  } }))
  assert.equal(preflight.status, 204)
  assert.equal(preflight.headers.get('access-control-allow-headers'), 'Content-Type, X-CSRF-Token')
  assert.equal((await patch({ firstName: 'Sam' }, { cookie: '' })).status, 401)
  assert.equal((await patch({ firstName: 'Sam' }, { cookie: '__Host-sharewifiqr_session=' + 'c'.repeat(43) })).status, 401)
  assert.equal((await patch({ firstName: 'Sam' }, { origin: 'https://example.com' })).status, 403)
  assert.equal((await patch({ firstName: 'Sam' }, { 'x-csrf-token': 'wrong' })).status, 403)
  assert.equal((await patch({ firstName: 'Sam', role: 'admin' })).status, 400)
  assert.equal((await patch({ firstName: ' '.repeat(5) })).status, 400)
  assert.equal((await patch({ lastName: 'x'.repeat(151) })).status, 400)
  assert.equal((await patch({ firstName: '  Sam  ' })).status, 204)
  const read = await api(new Request(url, { headers: { cookie, origin: portal } }))
  assert.equal(read.headers.get('cache-control'), 'no-store')
  assert.deepEqual((await read.json()).actor, { firstName: 'Sam', lastName: 'Chen', email: 'avery@example.com' })
  assert.equal((await api(new Request(url))).status, 401)
})
