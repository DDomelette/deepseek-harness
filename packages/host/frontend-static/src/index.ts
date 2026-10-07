/**
 * @deepseek-ai/dsh-host-frontend-static — SPA dist server over the webserver
 * fallback seat: serves the built frontend directory with explicit index
 * entry points. A readable index renders at the dist root and at every path that
 * resolves to the index file — the configured index path, and a case-only
 * difference from it on a case-insensitive volume; missing paths return 404,
 * traversal outside the dist root is 403, unknown extensions ship as
 * octet-stream, and non-GET/HEAD is 405. Every
 * index response first passes Connection's browser authentication, then the
 * webserver's index render (structured injection rows, then raw taps); a client
 * refused on a non-loopback authority receives that shell as a 401 carrying the
 * auth-required boot fact, so a phone that must pair is told so instead of
 * reading a dead end.
 * Non-index assets stay public. The dist location is workspace knowledge of
 * the composing application, so `distIndex` is typically supplied through a
 * `!!js` expression, never hardcoded by a deployment.
 * @module @deepseek-ai/dsh-host-frontend-static
 */

import type { ServerResponse } from 'node:http'
import { realpathSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
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
   * @returns index.html with the structured injections, the raw taps, and the site-root base.
   */
  renderIndex(): Promise<string>
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
const TEXT_MIME = 'text/plain; charset=utf-8'

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
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.map': 'application/json',
  '.webmanifest': 'application/manifest+json',
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

/**
 * Insert the auth-required fact ahead of every document script.
 * @param html - rendered shell.
 * @returns the shell carrying the fact, or the fact ahead of a headless fragment.
 */
function markAuthRequired(html: string): string {
  const markup = `<script>globalThis.${AUTH_REQUIRED_FACT} = true</script>`
  const open = /<head(?:\s[^>]*)?>/i.exec(html)
  if (open === null) return `${markup}${html}`
  const at = open.index + open[0].length
  return `${html.slice(0, at)}${markup}${html.slice(at)}`
}

/**
 * Whether a resolved request path names the index entry itself. Path text alone
 * cannot decide: on a case-insensitive volume (NTFS, APFS) `/INDEX.html` names
 * the same file as `/index.html` while comparing unequal, and treating it as an
 * asset would serve the shell without Connection's authentication. Resolving
 * both sides also covers a symlink pointing at the index; a path that cannot be
 * resolved is not the entry, and the caller's read reports the same 404 either
 * way.
 * @param target - resolved absolute request path under the dist root.
 * @param distRoot - the dist directory the path was resolved under.
 * @param distIndex - configured absolute path of the index file.
 * @returns true when the request names the index entry itself.
 */
function isIndexEntry(target: string, distRoot: string, distIndex: string): boolean {
  if (target === distRoot || target === distIndex) return true
  try {
    return realpathSync.native(target) === realpathSync.native(distIndex)
  } catch {
    // The two resolutions are the only statements here; an absent target or an
    // unbuilt dist is the caller's static miss, never an index response.
    return false
  }
}

/**
 * Serve one GET/HEAD static request from the dist root.
 * @param pathname - decoded URL pathname of the request.
 * @param res - the node:http response to write.
 * @param distRoot - absolute dist root directory (resolved by the caller).
 * @param distIndex - absolute path of index.html inside distRoot.
 * @param authorizeIndex - Connection's verdict for an index response, before its bytes are read.
 * @param renderIndex - produces the index.html body (structured injection
 * rendering) for the dist root and configured index path.
 */
export async function serveStatic(
  pathname: string, res: ServerResponse, distRoot: string, distIndex: string,
  authorizeIndex: () => ConnectionIndexAccess,
  renderIndex: () => Promise<string>,
): Promise<void> {
  const target = resolve(normalize(join(distRoot, pathname)))
  // Traversal rejection: the target must be distRoot itself (`/`) or stay under
  // it. `sep`, not '/': resolve() emits backslash paths on Windows, where a '/'
  // suffix would reject every legitimate subpath as traversal.
  if (target !== distRoot && !target.startsWith(distRoot + sep)) {
    res.writeHead(403)
    res.end()
    return
  }
  let body: string | Buffer
  let type: string
  let status = 200
  let headers: Record<string, string> = {}
  // Whether the request named the shell entry, which decides what an absent
  // target means: a missing dist is the one 404 an operator can act on.
  let indexEntry = false
  try {
    indexEntry = isIndexEntry(target, distRoot, distIndex)
    if (indexEntry) {
      const access = authorizeIndex()
      if (access === 'answered') return
      body = await renderIndex()
      if (access === 'auth-required') {
        body = markAuthRequired(body)
        status = 401
        headers = { 'cache-control': 'no-store' }
      }
      type = HTML_MIME
    } else {
      body = await readFile(target)
      type = MIME[extname(target)] ?? 'application/octet-stream'
    }
  } catch (error) {
    // Only absent or non-file targets are 404; other filesystem failures reach
    // the webserver's request-failure handling.
    if (!STATIC_MISS_CODES.has((error as NodeJS.ErrnoException).code)) throw error
    if (indexEntry) {
      // The readiness line already printed a URL, so a shell that cannot be
      // rendered names the step that produces it instead of a bare 404.
      res.writeHead(404, { 'content-type': TEXT_MIME })
      res.end('the frontend dist has no index.html; run `pnpm run build` in the checkout, then reload\n')
      return
    }
    res.writeHead(404)
    res.end()
    return
  }
  res.writeHead(status, { 'content-type': type, ...headers })
  res.end(body)
}

/**
 * Claim the webserver fallback seat and serve the dist.
 * @param ctx - plugin context carrying the webServer service.
 * @param config - validated {@link Config}.
 */
export function apply(ctx: Context, config: Config): void {
  const distIndex = config.distIndex
  const distRoot = dirname(distIndex)
  // The dist is built with a relative base so the same files mount under any
  // static directory; served pages also answer deep SPA-fallback paths, where
  // relative asset URLs would resolve under the request directory, so the
  // served form anchors them at the site root ahead of every URL-bearing tag.
  const renderIndex = async (): Promise<string> => {
    const body = ctx.webServer.renderIndex(await readFile(distIndex, 'utf8'))
    return body.replace(/<head(?:\s[^>]*)?>/i, open => `${open}<base href="/">`)
  }
  ctx.provide(FRONTEND_SERVICE, { renderIndex })
  ctx.effect(() => ctx.webServer.registerFallback(async (req, res) => {
    // Non-GET/HEAD without a matching named route is 405 (fallback-only
    // semantics: named routes own their method handling).
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405)
      res.end()
      return
    }
    /* v8 ignore next -- node:http always sets url on server requests */
    const rawPath = new URL(req.url ?? '/', 'http://x').pathname
    await serveStatic(
      decodeURIComponent(rawPath),
      res,
      distRoot,
      distIndex,
      () => ctx.connection.authorizeIndex(req, res),
      renderIndex,
    )
  }), 'frontend-static: fallback seat')
}
