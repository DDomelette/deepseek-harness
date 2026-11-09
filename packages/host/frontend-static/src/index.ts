/**
 * @deepseek-ai/dsh-host-frontend-static — SPA dist server over the webserver
 * fallback seat: a webserver resource serving the built frontend directory
 * with explicit index entry points. A readable index renders at the dist root
 * and configured index path; missing paths return 404, traversal outside the
 * dist root is 403, unknown extensions ship as octet-stream, and non-GET/HEAD
 * is 405. An HTTP index request first passes Connection's browser
 * authentication and renders for the browser Peer; an in-process read renders
 * for the Peer its caller admitted. Both renders go through the webserver's
 * index render (structured injection rows, then raw taps). Non-index assets
 * stay public; every file other than the index carries a weak ETag with
 * `cache-control: no-cache` and answers a matching `If-None-Match` with 304,
 * while the index carries no cache headers. The dist location is workspace
 * knowledge of the composing application, so `distIndex` is typically
 * supplied through a `!!js` expression, never hardcoded by a deployment.
 * @module @deepseek-ai/dsh-host-frontend-static
 */

import { createHash } from 'node:crypto'
import { readFile, realpath } from 'node:fs/promises'
import { dirname, extname, join, normalize, resolve, sep } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { ConnectionIndexAccess } from '@deepseek-ai/dsh-client-connection'
import type {} from '@deepseek-ai/dsh-client-connection'
import type {} from '@deepseek-ai/dsh-host-webserver'

/** Stable Cordis plugin name. */
export const name = 'frontend-static'

/** Service name of the shell renderer other Host routes ask for index.html. */
export const FRONTEND_SERVICE = 'frontend'

/**
 * The application shell as `/` renders it, for a Host route that serves the
 * application itself — a page outside the frontend fallback seat still needs
 * the same injections and site-root base.
 */
export interface FrontendService {
  /**
   * Render the shell from this deployment's dist.
   * @returns index.html with the structured injections, the raw taps, and the
   *   site-root base, or undefined when the dist has no readable index.html
   *   (the dist is unbuilt), which each caller answers where it owns the
   *   response.
   */
  renderIndex(): Promise<string | undefined>
}

/** Services required before the authenticated fallback seat can be claimed. */
export const inject = ['webServer', 'connection']

/** Plugin config: the dist anchor. */
export interface Config {
  /** Absolute path of index.html inside the dist root. */
  distIndex: string
}

export const Config: z<Config> = z.object({
  distIndex: z.string().required(),
})

const HTML_MIME = 'text/html; charset=utf-8'

/**
 * Boot fact marking a shell that was served to a client holding no accepted
 * session. `@deepseek-ai/dsh-mob`'s browser half reads it and renders the
 * pairing instructions; Connection's `authorizeIndex` decides the verdict.
 */
const AUTH_REQUIRED_FACT = '__DSH_AUTH_REQUIRED__'

const MIME: Record<string, string> = {
  '.html': HTML_MIME,
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  // Launchers require an image Content-Type for the install icons.
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.map': 'application/json',
  '.webmanifest': 'application/manifest+json',
  // The shell bundles its icon fonts, so the dist carries these three.
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  // The packed VFS image. Served as its own bytes, never as a Content-Encoding:
  // the worker inflates the body itself, and a transport-level encoding would
  // leave it inflating an already-decoded archive.
  '.gz': 'application/gzip',
}

const STATIC_MISS_CODES: ReadonlySet<string | undefined> = new Set([
  'ENOENT',
  'EISDIR',
  'ENOTDIR',
])

/** A Response body that is `bytes` itself, without the copy a buffer body gets. */
function bytesBody(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes)
      controller.close()
    },
  })
}

/**
 * Answer one GET or HEAD dist request; the webserver answers any other method
 * with 405 before a resource runs. A malformed percent-escape or a filesystem
 * failure other than a missing or non-file target rejects.
 * @param request - the request; only its method and URL path are read.
 * @param distRoot - absolute dist root directory (resolved by the caller).
 * @param distIndex - absolute path of index.html inside distRoot.
 * @param authorizeIndex - answers an index request before its bytes are read:
 * the response to send instead of the index, or undefined to serve it.
 * @param renderIndex - turns the raw index.html body into the served document
 * for the dist root and configured index path.
 * @returns the dist response; a HEAD response carries the GET status and
 * headers without a body. A file other than the index carries
 * `cache-control: no-cache` and a weak ETag from a SHA-1 of its bytes, and a
 * request whose `If-None-Match` equals that ETag receives an empty 304.
 */
async function serveStatic(
  request: Request, distRoot: string, distIndex: string,
  authorizeIndex: () => Response | undefined,
  renderIndex: (html: string) => string,
): Promise<Response> {
  const target = resolve(normalize(join(distRoot, decodeURIComponent(new URL(request.url).pathname))))
  // Traversal rejection: the target must be distRoot itself (`/`) or stay under
  // it. `sep`, not '/': resolve() emits backslash paths on Windows, where a '/'
  // suffix would reject every legitimate subpath as traversal.
  if (target !== distRoot && !target.startsWith(distRoot + sep)) return new Response(null, { status: 403 })
  const isIndex = target === distRoot || target.toLowerCase() === distIndex.toLowerCase()
  let body: string | Uint8Array<ArrayBuffer>
  let headers: Record<string, string>
  try {
    if (target === distRoot || target === distIndex
      || target.toLowerCase() === distIndex.toLowerCase() && await realpath(target) === await realpath(distIndex)) {
      const refusal = authorizeIndex()
      if (refusal !== undefined) return refusal
      body = renderIndex(await readFile(distIndex, 'utf8'))
      headers = { 'content-type': HTML_MIME }
    } else {
      body = await readFile(target)
      // Weak: gzip changes the transferred bytes.
      const cache = { 'cache-control': 'no-cache', etag: `W/"${createHash('sha1').update(body).digest('base64url')}"` }
      if (request.headers.get('if-none-match') === cache.etag) return new Response(null, { status: 304, headers: cache })
      headers = { 'content-type': MIME[extname(target)] ?? 'application/octet-stream', ...cache }
    }
  } catch (error) {
    // Only absent or non-file targets are 404; other filesystem failures reach
    // the caller, which the webserver answers with 400 over HTTP.
    if (!STATIC_MISS_CODES.has((error as NodeJS.ErrnoException).code)) throw error
    if (isIndex) return new Response(request.method === 'HEAD' ? null : 'the frontend dist has no index.html; run `pnpm run build` in the checkout, then reload\n', {
      status: 404, headers: { 'content-type': 'text/plain; charset=utf-8' },
    })
    return new Response(null, { status: 404 })
  }
  if (request.method === 'HEAD') return new Response(null, { status: 200, headers })
  return new Response(typeof body === 'string' ? body : bytesBody(body), { status: 200, headers })
}

/**
 * Claim the webserver fallback seat with a resource serving the dist.
 * @param ctx - plugin context carrying the webServer and connection services.
 * @param config - validated {@link Config}.
 */
export function apply(ctx: Context, config: Config): void {
  const distIndex = config.distIndex
  const distRoot = dirname(distIndex)
  // Connection's browser authentication writes the token exchange's 303 or
  // the 401 through a writeHead/end response; capture it as a Fetch response.
  // The answer stays a 401 unless Connection writes another one.
  const authorizeIndex = (request: Request): { access: ConnectionIndexAccess; response?: Response } => {
    let status = 401
    const headers = new Headers()
    let body: string | undefined
    const admitted = ctx.connection.authorizeIndex(request, {
      setHeader(name, value) { headers.set(name, value) },
      writeHead(nextStatus, nextHeaders) {
        status = nextStatus
        for (const [name, value] of new Headers(nextHeaders)) headers.set(name, value)
      },
      end(text) { body = text },
    })
    return admitted === 'answered'
      ? { access: admitted, response: new Response(body, { status, headers }) }
      : { access: admitted }
  }
  ctx.effect(() => ctx.webServer.registerFallback({
    resource: (request, peer) => {
      let authRequired = false
      return serveStatic(
        request,
        distRoot,
        distIndex,
        // A read with a Peer was admitted by its caller; an HTTP request carries
        // none and passes Connection's browser authentication instead.
        () => {
          if (peer !== undefined) return undefined
          const auth = authorizeIndex(request)
          authRequired = auth.access === 'auth-required'
          return auth.response
        },
        // The browser authentication admits the owner's shared browser Peer. The
        // base goes in after all index transforms, so it precedes every resource
        // reference they insert.
        (html) => {
          const rendered = ctx.webServer.renderIndex(html, peer ?? ctx.connection.browserPeer)
          const auth = authRequired ? '<script>globalThis.' + AUTH_REQUIRED_FACT + ' = true</script>' : ''
          return /<head(?:\s[^>]*)?>/i.test(rendered)
            ? rendered.replace(/<head(?:\s[^>]*)?>/i, open => open + '<base href="./">' + auth)
            : auth + rendered
        },
      ).then(response => authRequired && response.status === 200
        ? new Response(response.body, { status: 401, headers: response.headers })
        : response)
    },
  }), 'frontend-static: fallback seat')
}
