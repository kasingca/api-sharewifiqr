import { Buffer } from 'node:buffer'
import { createServer } from 'node:http'
import { Readable } from 'node:stream'
import { endpoint } from './entry.ts'

const hostname = 'localhost'
const port = 3030
const origin = `http://${hostname}:${port}`
const api = endpoint()

createServer(async (incoming, outgoing) => {
  try {
    const headers = new Headers()
    for (let index = 0; index < incoming.rawHeaders.length; index += 2) {
      headers.append(incoming.rawHeaders[index], incoming.rawHeaders[index + 1])
    }
    const init: RequestInit & { duplex?: 'half' } = { method: incoming.method, headers }
    if (incoming.method !== 'GET' && incoming.method !== 'HEAD') {
      init.body = Readable.toWeb(incoming) as ReadableStream
      init.duplex = 'half'
    }
    const request = new Request(origin + (incoming.url ?? '/'), init)
    const response = await api.fetch(request)
    const body = Buffer.from(await response.arrayBuffer())
    for (const [name, value] of response.headers) {
      if (name !== 'set-cookie') outgoing.setHeader(name, value)
    }
    const cookies = response.headers.getSetCookie()
    if (cookies.length) outgoing.setHeader('Set-Cookie', cookies)
    outgoing.writeHead(response.status).end(body)
  } catch (error) {
    console.error('Local API request failed', error)
    outgoing.writeHead(500).end()
  }
}).listen(port, hostname, () => {
  console.log(`ShareWiFiQR API listening at ${origin}`)
})
