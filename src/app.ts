import { randomUUID } from 'node:crypto'

export const sessionCookie = '__Host-sharewifiqr_session'
const plans = [
  { id: 'free', name: 'Free', monthlyPrice: 0, trackedCodes: 1, monthlyTrackedScans: 100 },
  { id: 'plus', name: 'Plus', monthlyPrice: 100, trackedCodes: 10, monthlyTrackedScans: 1000 },
  { id: 'business', name: 'Business', monthlyPrice: 600, trackedCodes: 50, monthlyTrackedScans: 10000 },
].map(plan => ({ ...plan, currency: 'USD' }))

export type ProfileNames = Partial<{ firstName: string; lastName: string }>
export type PaymentProvider = 'stripe' | 'paypal'
export type PaymentMethod = { provider: PaymentProvider; updatedAt: string } | null
type PaymentMethodRead = { paymentMethod: PaymentMethod } | 'unauthenticated' | 'not_found'

export type Identity = {
  login: (request: Request) => Promise<Response>
  callback: (request: Request) => Promise<Response>
  me: (token: string) => Promise<object | undefined>
  updateProfile: (token: string, csrfToken: string, names: ProfileNames) =>
    Promise<'updated' | 'unauthenticated' | 'csrf_denied'>
  getPaymentMethod: (token: string, customerId: string) => Promise<PaymentMethodRead>
  setPaymentMethod: (token: string, csrfToken: string, customerId: string, provider: PaymentProvider) =>
    Promise<PaymentMethodRead | 'csrf_denied'>
  logout: (token: string, csrfToken: string) => Promise<boolean>
}

export function readCookie(request: Request, name: string) {
  const matches = (request.headers.get('cookie') ?? '').split(';')
    .map(part => part.trim()).filter(part => part.startsWith(name + '='))
  return matches.length === 1 ? matches[0].slice(name.length + 1) : undefined
}

const paymentMethodRoute = '/v1/customers/{customerId}/payment-method'
const methods = new Map([
  ['/health', ['GET']], ['/v1/plans', ['GET']], ['/v1/me', ['GET', 'PATCH']],
  ['/v1/session', ['DELETE']], ['/v1/auth/login', ['GET']], ['/v1/auth/callback', ['GET']],
  [paymentMethodRoute, ['GET', 'PUT']],
])
const credentialedRoutes = ['/v1/plans', '/v1/me', '/v1/session', paymentMethodRoute]

function matchRoute(pathname: string) {
  const customer = /^\/v1\/customers\/([0-9a-f]{32})\/payment-method$/.exec(pathname)
  return customer ? { route: paymentMethodRoute, customerId: customer[1] } : { route: pathname }
}

async function readJsonObject(request: Request) {
  if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') return
  const body: unknown = await request.json().catch(() => undefined)
  if (body && typeof body === 'object' && !Array.isArray(body)) return body as Record<string, unknown>
}

async function readPaymentProvider(request: Request): Promise<PaymentProvider | undefined> {
  const body = await readJsonObject(request)
  if (!body || Object.keys(body).length !== 1) return
  if (body.provider === 'stripe' || body.provider === 'paypal') return body.provider
}

async function readProfileNames(request: Request): Promise<ProfileNames | undefined> {
  const body = await readJsonObject(request)
  if (!body) return
  const entries = Object.entries(body)
  if (!entries.length) return
  const names: ProfileNames = {}
  for (const [key, value] of entries) {
    if ((key !== 'firstName' && key !== 'lastName') || typeof value !== 'string') return
    const name = value.trim()
    if (!name || Array.from(name).length > 150) return
    names[key] = name
  }
  return names
}

export function createApi(portalOrigin: string, identity?: Identity) {
  return async (request: Request, path = new URL(request.url).pathname) => {
    const requestId = randomUUID()
    const { route: pathname, customerId } = matchRoute(path)
    const cors = credentialedRoutes.includes(pathname)
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
    const supportedMethods = methods.get(pathname)
    if (!supportedMethods) return error(404, 'not_found', 'Resource not found.')
    if (request.method === 'OPTIONS' && cors) {
      const method = request.headers.get('access-control-request-method') ?? ''
      const allowedHeaders = method === 'PATCH' || method === 'PUT' ? ['Content-Type', 'X-CSRF-Token']
        : method === 'DELETE' ? ['X-CSRF-Token'] : []
      const requestedHeaders = (request.headers.get('access-control-request-headers') ?? '')
        .toLowerCase().split(',').map(header => header.trim()).filter(Boolean)
      if (!allowedOrigin || !supportedMethods.includes(method) ||
          requestedHeaders.some(header => !allowedHeaders.some(allowed => allowed.toLowerCase() === header))) {
        return error(403, 'preflight_denied', 'This cross-origin request is not allowed.')
      }
      headers.set('Access-Control-Allow-Methods', supportedMethods.join(', '))
      if (allowedHeaders.length) headers.set('Access-Control-Allow-Headers', allowedHeaders.join(', '))
      return new Response(null, { status: 204, headers })
    }
    const method = request.method
    if (!supportedMethods.includes(method)) {
      headers.set('Allow', [...supportedMethods, ...(cors ? ['OPTIONS'] : [])].join(', '))
      return error(405, 'method_not_allowed', 'Method not allowed.')
    }

    try {
      if (pathname === '/health') return Response.json({ status: 'ok' }, { headers })
      if (pathname === '/v1/plans') return Response.json({ plans }, { headers })
      if (pathname === '/v1/auth/login' || pathname === '/v1/auth/callback') {
        if (!identity) return error(503, 'auth_unavailable', 'Sign-in is temporarily unavailable.')
        const response = pathname.endsWith('/login') ? await identity.login(request) : await identity.callback(request)
        for (const [key, value] of headers) response.headers.set(key, value)
        return response
      }
      if (method !== 'GET' && !allowedOrigin) return error(403, 'origin_denied', 'Origin is not allowed.')
      const token = readCookie(request, sessionCookie)
      if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return error(401, 'unauthenticated', 'Sign in to continue.')
      if (!identity) return error(503, 'auth_unavailable', 'Sign-in is temporarily unavailable.')
      const csrf = request.headers.get('x-csrf-token') ?? ''
      if (customerId) {
        let result
        if (method === 'GET') result = await identity.getPaymentMethod(token, customerId)
        else {
          const provider = await readPaymentProvider(request)
          if (!provider) return error(400, 'invalid_payment_method', 'Send provider as "stripe" or "paypal".')
          result = await identity.setPaymentMethod(token, csrf, customerId, provider)
        }
        if (result === 'unauthenticated') return error(401, result, 'Sign in to continue.')
        if (result === 'csrf_denied') return error(403, result, 'Session validation failed.')
        if (result === 'not_found') return error(404, result, 'Resource not found.')
        return Response.json(result, { headers })
      }
      if (method === 'GET') {
        const actor = await identity.me(token)
        return actor ? Response.json(actor, { headers }) : error(401, 'unauthenticated', 'Sign in to continue.')
      }
      if (method === 'PATCH') {
        const names = await readProfileNames(request)
        if (!names) return error(400, 'invalid_profile', 'Send firstName or lastName as nonempty strings of up to 150 characters.')
        const result = await identity.updateProfile(token, csrf, names)
        if (result === 'unauthenticated') return error(401, result, 'Sign in to continue.')
        if (result === 'csrf_denied') return error(403, result, 'Session validation failed.')
        return new Response(null, { status: 204, headers })
      }
      if (!csrf || !await identity.logout(token, csrf)) return error(403, 'csrf_denied', 'Session validation failed.')
      headers.set('Set-Cookie', sessionCookie + '=; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=0')
      return new Response(null, { status: 204, headers })
    } catch {
      console.error('API request failed', { requestId, pathname })
      return error(503, 'temporarily_unavailable', 'Please try again shortly.')
    }
  }
}
