/** Real `dsh web` authentication against a temporary Harness home. */

import type { ChildProcess } from 'node:child_process'
import { spawn } from 'node:child_process'
import { stat } from 'node:fs/promises'
import { request as httpRequest } from 'node:http'
import { createRequire } from 'node:module'
import { createServer } from 'node:net'
import type { AddressInfo } from 'node:net'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { resolveLanTrust } from '@deepseek-ai/dsh-web-app'
import { describe, expect, it } from 'vitest'

const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url))
const DSH_SOURCE_BIN = join(REPO_ROOT, 'apps/cli/src/bin.ts')
const TSX_LOADER = pathToFileURL(createRequire(join(REPO_ROOT, 'package.json')).resolve('tsx')).href

interface RunningWeb {
  readonly child: ChildProcess
  readonly launchUrl: string
  readonly output: () => string
}

interface HttpResult {
  readonly status: number
  readonly body: string
}

function redact(output: string): string {
  return output.replace(/([?&]token=)[^\s)]+/gu, '$1<redacted>')
}

/** Reserve one concrete loopback port, then release it for the CLI process. */
async function freePort(): Promise<number> {
  const server = createServer()
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const port = (server.address() as AddressInfo).port
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error === undefined) resolve()
      else reject(error)
    })
  })
  return port
}

function cleanEnvironment(root: string, dshHome: string): NodeJS.ProcessEnv {
  const env = Object.fromEntries(Object.entries(process.env).filter(([name]) =>
    !/(?:KEY|SECRET|TOKEN|PASSWORD)/iu.test(name)))
  return {
    ...env,
    DSH_AGENTS_HOME: join(root, '.agents'),
    DSH_HOME: dshHome,
    DSH_TELEMETRY_DISABLED: '1',
    NODE_NO_WARNINGS: '1',
    SSH_CONNECTION: '',
    SSH_TTY: '',
    TSX_TSCONFIG_PATH: join(REPO_ROOT, 'tsconfig.json'),
  }
}

/** Start the public source CLI and wait for its authenticated readiness URL. */
async function startWeb(root: string, dshHome: string, port: number, extraArgs: string[] = []): Promise<RunningWeb> {
  const child = spawn(process.execPath, [
    '--import', TSX_LOADER,
    DSH_SOURCE_BIN,
    'web',
    '--no-open',
    '--port', String(port),
    ...extraArgs,
  ], {
    cwd: root,
    env: cleanEnvironment(root, dshHome),
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let output = ''
  const launchUrl = await new Promise<string>((resolve, reject) => {
    let settled = false
    const fail = (error: Error): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      reject(error)
    }
    const timer = setTimeout(() => {
      fail(new Error(`dsh web did not become ready:\n${redact(output)}`))
    }, 90_000)
    const append = (chunk: Buffer | string): void => {
      output = `${output}${String(chunk)}`.slice(-100_000)
      const match = /dsh web: (http:\/\/[^\s]+)/u.exec(output)
      if (settled || match?.[1] === undefined) return
      settled = true
      clearTimeout(timer)
      resolve(match[1])
    }
    child.stdout?.on('data', append)
    child.stderr?.on('data', append)
    child.once('error', (error) => {
      fail(error)
    })
    child.once('exit', (code) => {
      fail(new Error(`dsh web exited before readiness (${String(code)}):\n${redact(output)}`))
    })
  })
  return { child, launchUrl, output: () => output }
}

async function stopWeb(running: RunningWeb): Promise<void> {
  if (running.child.exitCode !== null) return
  const exited = new Promise<void>((resolve) => { running.child.once('exit', () => { resolve() }) })
  running.child.kill('SIGTERM')
  const forced = setTimeout(() => { running.child.kill('SIGKILL') }, 10_000)
  forced.unref()
  await exited
  clearTimeout(forced)
}

/** POST one real Remote envelope while controlling the wire Host header. */
function describeSettings(port: number, host: string, cookie?: string): Promise<HttpResult> {
  const body = JSON.stringify({
    type: 'client-request',
    rpcId: 'web-auth-real-cli',
    method: 'settings/describe',
    payload: { args: {} },
  })
  return new Promise((resolve, reject) => {
    const req = httpRequest({
      hostname: '127.0.0.1',
      port,
      path: '/api/settings/describe',
      method: 'POST',
      headers: {
        host,
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(body),
        ...cookie === undefined ? {} : { cookie },
      },
    }, (res) => {
      const chunks: Uint8Array[] = []
      res.on('data', (chunk: Buffer) => { chunks.push(chunk) })
      res.on('end', () => {
        resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') })
      })
    })
    req.once('error', reject)
    req.end(body)
  })
}

/** GET one path from the real server while controlling the wire Host header. */
function hostedGet(port: number, host: string, path: string): Promise<HttpResult & { readonly setCookie: string }> {
  return new Promise((resolve, reject) => {
    const req = httpRequest({
      hostname: '127.0.0.1',
      port,
      path,
      method: 'GET',
      headers: { host },
    }, (res) => {
      const chunks: Buffer[] = []
      res.on('data', (chunk: Buffer) => { chunks.push(chunk) })
      res.on('end', () => {
        resolve({
          status: res.statusCode ?? 0,
          setCookie: res.headers['set-cookie']?.[0] ?? '',
          body: Buffer.concat(chunks).toString('utf8'),
        })
      })
    })
    req.once('error', reject)
    req.end()
  })
}

describe('dsh web authentication through the real CLI', () => {
  it('rejects a forged loopback Host and preserves the browser cookie across restart', { timeout: 180_000 }, async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-web-auth-real-cli-'))
    const dshHome = join(root, '.dsh')
    const port = await freePort()
    let first: RunningWeb | undefined
    let second: RunningWeb | undefined
    try {
      first = await startWeb(root, dshHome, port)
      const firstUrl = new URL(first.launchUrl)
      expect(firstUrl.origin).toBe(`http://127.0.0.1:${String(port)}`)
      expect(firstUrl.pathname).toBe('/')
      expect(firstUrl.searchParams.get('token')).toMatch(/^[A-Za-z0-9_-]{43}$/u)

      expect(await describeSettings(port, `localhost:${String(port)}`)).toEqual({
        status: 401,
        body: 'unauthorized',
      })

      const exchange = await fetch(first.launchUrl, { redirect: 'manual' })
      expect(exchange.status).toBe(303)
      expect(exchange.headers.get('location')).toBe('/')
      const setCookie = exchange.headers.get('set-cookie')
      if (setCookie === null) throw new Error('real CLI token exchange omitted Set-Cookie')
      expect(setCookie).toContain('HttpOnly')
      expect(setCookie).toContain('SameSite=Strict')
      expect(setCookie).not.toContain('Secure')
      const cookie = setCookie.split(';', 1)[0]!

      const authenticated = await describeSettings(port, firstUrl.host, cookie)
      expect(authenticated.status).toBe(200)
      const authenticatedBody = JSON.parse(authenticated.body) as unknown
      expect(authenticatedBody).toMatchObject({
        type: 'server-response',
        rpcId: 'web-auth-real-cli',
        result: { ok: true, value: { namespaces: expect.any(Array) as unknown } },
      })

      await stopWeb(first)
      first = undefined
      second = await startWeb(root, dshHome, port)
      const secondUrl = new URL(second.launchUrl)
      expect(secondUrl.searchParams.get('token')).not.toBe(firstUrl.searchParams.get('token'))
      expect((await describeSettings(port, secondUrl.host, cookie)).status).toBe(200)

      // Windows does not carry POSIX mode bits, so the private credential file
      // is asserted where the guarantee exists.
      if (process.platform !== 'win32') {
        const credentialMode = (await stat(join(dshHome, '.credentials.yaml'))).mode & 0o777
        expect(credentialMode).toBe(0o600)
      }
    } catch (error) {
      const evidence = [first?.output(), second?.output()].filter(value => value !== undefined).join('\n')
      throw new Error(`${error instanceof Error ? error.message : String(error)}\n${redact(evidence)}`, { cause: error })
    } finally {
      if (second !== undefined) await stopWeb(second)
      if (first !== undefined) await stopWeb(first)
      await rm(root, { recursive: true, force: true })
    }
  })

  it('serves a trusted LAN authority without handing out the process token', { timeout: 180_000 }, async (context) => {
    // The expected authority comes from the product's own derivation: the address
    // a phone can reach, which excludes fake-IP TUN ranges and sorts virtual
    // adapters after physical ones rather than following enumeration order.
    const lanAddress = resolveLanTrust('0.0.0.0', []).lanAddresses[0]
    if (lanAddress === undefined) {
      context.skip()
      return
    }
    const root = await mkdtemp(join(tmpdir(), 'dsh-web-lan-real-cli-'))
    const dshHome = join(root, '.dsh')
    const port = await freePort()
    let running: RunningWeb | undefined
    try {
      running = await startWeb(root, dshHome, port, ['--host', '0.0.0.0', '--allow-lan'])
      const lanAuthority = `${lanAddress}:${String(port)}`
      // The LAN line is token-free: the process launch token is the computer's
      // own credential, and a phone reaches this deployment by pairing.
      expect(running.output()).toContain(`(LAN: http://${lanAuthority}/)`)
      expect(running.output()).not.toContain(`http://${lanAuthority}/?token=`)

      // Trust fence first, then authentication: the LAN authority is derived as
      // trusted, so an unauthenticated call is 401 rather than 403.
      expect(await describeSettings(port, lanAuthority)).toEqual({ status: 401, body: 'unauthorized' })
      // An undeclared authority is still refused by the fence (403).
      expect((await describeSettings(port, `evil.example:${String(port)}`)).status).toBe(403)

      // Even holding the fresh process token, a LAN authority cannot exchange it:
      // that is what keeps one printed URL from becoming a session no device
      // revocation could end. The answer is the application shell marked as
      // needing authentication, so the phone can name the way back in.
      const token = /dsh web: http:\/\/127\.0\.0\.1:\d+\/\?token=([^\s)]+)/u.exec(running.output())?.[1]
      if (token === undefined) throw new Error('readiness line omitted the loopback token')
      const refused = await hostedGet(port, lanAuthority, `/?token=${token}`)
      expect(refused.status).toBe(401)
      expect(refused.setCookie).toBe('')
      expect(refused.body).toContain('globalThis.__DSH_AUTH_REQUIRED__ = true')
      expect(refused.body).toContain('__DSH_BOOT__')

      // The plain LAN origin is refused the same way, and without a token it
      // never reaches the exchange above.
      const anonymous = await hostedGet(port, lanAuthority, '/')
      expect(anonymous.status).toBe(401)
      expect(anonymous.setCookie).toBe('')
      expect(anonymous.body).toContain('globalThis.__DSH_AUTH_REQUIRED__ = true')

      // The computer's own loopback exchange is unchanged.
      const loopbackExchange = await fetch(running.launchUrl, { redirect: 'manual' })
      expect(loopbackExchange.status).toBe(303)
      const cookie = loopbackExchange.headers.get('set-cookie')?.split(';', 1)[0]
      if (cookie === null || cookie === undefined) throw new Error('loopback exchange omitted Set-Cookie')
      expect((await describeSettings(port, `127.0.0.1:${String(port)}`, cookie)).status).toBe(200)
    } catch (error) {
      throw new Error(`${error instanceof Error ? error.message : String(error)}\n${redact(running?.output() ?? '')}`, { cause: error })
    } finally {
      if (running !== undefined) await stopWeb(running)
      await rm(root, { recursive: true, force: true })
    }
  })
})
