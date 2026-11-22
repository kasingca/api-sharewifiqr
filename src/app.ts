import { randomUUID } from 'node:crypto'

export const sessionCookie = '__Host-sharewifiqr_session'
const plans = [
  { id: 'free', name: 'Free', monthlyPrice: 0, trackedCodes: 1, monthlyTrackedScans: 100 },
  { id: 'plus', name: 'Plus', monthlyPrice: 100, trackedCodes: 10, monthlyTrackedScans: 1000 },
  { id: 'business', name: 'Business', monthlyPrice: 600, trackedCodes: 50, monthlyTrackedScans: 10000 },
].map(plan => ({ ...plan, currency: 'USD' }))

export type Identity = {
  login: () => Promise<Response>
  callback: (request: Request) => Promise<Response>
  me: (token: string) => Promise<object | undefined>
  logout: (token: string, csrfToken: string) => Promise<boolean>
}

export function readCookie(request: Request, name: string) {
  const matches = (request.headers.get('cookie') ?? '').split(';')
    .map(part => part.trim()).filter(part => part.startsWith(name + '='))
  return matches.length === 1 ? matches[0].slice(name.length + 1) : undefined
}

const methods = new Map([
  ['/health', 'GET'], ['/v1/plans', 'GET'], ['/v1/me', 'GET'],
  ['/v1/session', 'DELETE'], ['/v1/auth/login', 'GET'], ['/v1/auth/callback', 'GET'],
])

export function createApi(portalOrigin: string, identity?: Identity) {
  return async (request: Request, pathname = new URL(request.url).pathname) => {
    const requestId = randomUUID()
    const cors = ['/v1/plans', '/v1/me', '/v1/session'].includes(pathname)
    const origin = request.headers.get('origin')
    const allowedOrigin = origin === portalOrigin
    const headers = new Headers({ 'Cache-Control': 'no-store', 'X-Request-Id': requestId })
    if (cors) headers.set('Vary', 'Origin, Access-Control-Request-Method, Access-Control-Request-Headers')
    if (cors && allowedOrigin) {
      headers.set('Access-Control-Allow-Origin', portalOrigin)
      headers.set('Access-Control-Allow-Credentials', 'true')
    }
    const error = (status: number, code: string, message: string) =>
      Response.json({ error: { code, message, requestId } }, { status, headers })

    if (pathname === '/') return error(401, 'unauthenticated', 'Sorry, this request is not authenticated.')
    const method = methods.get(pathname)
    if (!method) return error(404, 'not_found', 'Resource not found.')
    if (request.method === 'OPTIONS' && cors) {
      const requestedHeaders = (request.headers.get('access-control-request-headers') ?? '')
        .toLowerCase().split(',').map(header => header.trim()).filter(Boolean)
      if (!allowedOrigin || request.headers.get('access-control-request-method') !== method ||
          requestedHeaders.some(header => method !== 'DELETE' || header !== 'x-csrf-token')) {
        return error(403, 'preflight_denied', 'This cross-origin request is not allowed.')
      }
      headers.set('Access-Control-Allow-Methods', method)
      if (method === 'DELETE') headers.set('Access-Control-Allow-Headers', 'X-CSRF-Token')
      return new Response(null, { status: 204, headers })
    }
    if (request.method !== method) {
      headers.set('Allow', cors ? method + ', OPTIONS' : method)
      return error(405, 'method_not_allowed', 'Method not allowed.')
    }

    try {
      if (pathname === '/health') return Response.json({ status: 'ok' }, { headers })
      if (pathname === '/v1/plans') return Response.json({ plans }, { headers })
      if (pathname === '/v1/auth/login' || pathname === '/v1/auth/callback') {
        if (!identity) return error(503, 'auth_unavailable', 'Sign-in is temporarily unavailable.')
        const response = pathname.endsWith('/login') ? await identity.login() : await identity.callback(request)
        for (const [key, value] of headers) response.headers.set(key, value)
        return response
      }
      if (method === 'DELETE' && !allowedOrigin) return error(403, 'origin_denied', 'Origin is not allowed.')
      const token = readCookie(request, sessionCookie)
      if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return error(401, 'unauthenticated', 'Sign in to continue.')
      if (!identity) return error(503, 'auth_unavailable', 'Sign-in is temporarily unavailable.')
      if (method === 'GET') {
        const actor = await identity.me(token)
        return actor ? Response.json(actor, { headers }) : error(401, 'unauthenticated', 'Sign in to continue.')
      }
      const csrf = request.headers.get('x-csrf-token')
      if (!csrf || !await identity.logout(token, csrf)) return error(403, 'csrf_denied', 'Session validation failed.')
      headers.set('Set-Cookie', sessionCookie + '=; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=0')
      return new Response(null, { status: 204, headers })
    } catch {
      console.error('API request failed', { requestId, pathname })
      return error(503, 'temporarily_unavailable', 'Please try again shortly.')
    }
  }
}
