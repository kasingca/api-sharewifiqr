import { createApi } from './app.ts'
import { createIdentity } from './identity.ts'

const portal = process.env.PORTAL_ORIGIN ?? 'https://portal.sharewifiqr.com'
let handle: ReturnType<typeof createApi> | undefined

export function endpoint(path?: string | ((url: URL) => string)) {
  return {
    fetch(request: Request) {
      handle ??= createApi(portal, createIdentity(process.env, portal))
      return handle(request, typeof path === 'function' ? path(new URL(request.url)) : path)
    },
  }
}
