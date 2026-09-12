/** Real `dsh web` phone pairing through the public CLI and a temporary Harness home. */

import type { ChildProcess } from 'node:child_process'
import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { request as httpRequest } from 'node:http'
import { createRequire } from 'node:module'
import { createServer } from 'node:net'
import type { AddressInfo } from 'node:net'
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
  readonly setCookie: string | undefined
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

/** Start the public source CLI and wait for its readiness URL. */
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
    child.once('error', (error) => { fail(error) })
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

/** Send one real request while controlling the wire Host header and cookie. */
function call(port: number, options: {
  path: string
  host: string
  method?: string
  cookie?: string
  body?: string
  userAgent?: string
}): Promise<HttpResult> {
  return new Promise((resolve, reject) => {
    const req = httpRequest({
      hostname: '127.0.0.1',
      port,
      path: options.path,
      method: options.method ?? 'GET',
      headers: {
        host: options.host,
        ...options.cookie === undefined ? {} : { cookie: options.cookie },
        ...options.userAgent === undefined ? {} : { 'user-agent': options.userAgent },
        ...options.body === undefined
          ? {}
          : { 'content-type': 'application/json', 'content-length': Buffer.byteLength(options.body) },
      },
    }, (res) => {
      const chunks: Uint8Array[] = []
      res.on('data', (chunk: Buffer) => { chunks.push(chunk) })
      res.on('end', () => {
        resolve({
          status: res.statusCode ?? 0,
          body: Buffer.concat(chunks).toString('utf8'),
          setCookie: res.headers['set-cookie']?.[0],
        })
      })
    })
    req.once('error', reject)
    req.end(options.body)
  })
}

/** Exchange any launch URL for the browser cookie of its authority. */
async function browserCookieOf(url: string): Promise<string> {
  const exchange = await fetch(url, { redirect: 'manual' })
  const setCookie = exchange.headers.get('set-cookie')
  if (setCookie === null) throw new Error('the token exchange omitted Set-Cookie')
  return setCookie.split(';', 1)[0]!
}

const PHONE_AGENT = 'Mozilla/5.0 (Linux; Android 10; JAD-AL50) AppleWebKit/537.36'

describe('dsh web phone pairing through the real CLI', () => {
  it('pairs a phone on the LAN and revokes its device session', { timeout: 240_000 }, async (context) => {
    // The phone's authority comes from the product's own derivation, so the
    // spec asserts the address `dsh web` prints rather than a guessed one.
    const lanAddress = resolveLanTrust('0.0.0.0', []).lanAddresses[0]
    if (lanAddress === undefined) {
      context.skip()
      return
    }
    const root = await mkdtemp(join(tmpdir(), 'dsh-web-pairing-real-cli-'))
    const dshHome = join(root, '.dsh')
    const port = await freePort()
    let running: RunningWeb | undefined
    try {
      running = await startWeb(root, dshHome, port, ['--host', '0.0.0.0', '--allow-lan'])
      const lanAuthority = `${lanAddress}:${String(port)}`
      const loopbackAuthority = `127.0.0.1:${String(port)}`
      const computer = await browserCookieOf(running.launchUrl)
      const forged = `evil.example:${String(port)}`

      // The computer opens a request; the phone's own authority may not.
      const opened = await call(port, {
        path: '/pair/session',
        host: loopbackAuthority,
        method: 'POST',
        cookie: computer,
      })
      expect(opened.status).toBe(200)
      const { code } = JSON.parse(opened.body) as { code: string }
      expect(code).toMatch(/^[A-HJ-NP-Z2-9]{8}$/u)
      // The phone's authority holds no browser session, so the computer's
      // routes refuse it before the loopback rule is even reached.
      expect((await call(port, {
        path: '/pair/session',
        host: lanAuthority,
        method: 'POST',
        cookie: computer,
      })).status).toBe(401)

      // The phone opens the pairing screen: no cookie yet, still fenced.
      const screen = await call(port, {
        path: `/pair?c=${code}`,
        host: lanAuthority,
        userAgent: PHONE_AGENT,
      })
      expect(screen.status).toBe(200)
      expect(screen.body).toContain(`globalThis.__DSH_PAIR__ = {"code":"${code}"}`)
      expect((await call(port, { path: `/pair?c=${code}`, host: forged })).status).toBe(403)
      expect(JSON.parse((await call(port, {
        path: `/pair/state?c=${code}`,
        host: lanAuthority,
      })).body)).toEqual({ status: 'pending' })

      // The computer sees the request with the agent-derived name and approves it.
      const requests = JSON.parse((await call(port, {
        path: '/pair/requests',
        host: loopbackAuthority,
        cookie: computer,
      })).body) as { requests: { code: string; userAgent?: string }[] }
      expect(requests.requests).toEqual([expect.objectContaining({ code, userAgent: PHONE_AGENT })])

      expect((await call(port, {
        path: '/pair/approve',
        host: lanAuthority,
        method: 'POST',
        cookie: computer,
        body: JSON.stringify({ code, label: 'study phone', allowed: true }),
      })).status).toBe(401)

      const approved = await call(port, {
        path: '/pair/approve',
        host: loopbackAuthority,
        method: 'POST',
        cookie: computer,
        body: JSON.stringify({ code, label: 'study phone', allowed: true }),
      })
      expect(approved.status).toBe(200)
      expect(JSON.parse(approved.body)).toMatchObject({ ok: true, device: { label: 'study phone' } })

      // The phone collects the device cookie, which authenticates it on /api.
      const collected = await call(port, { path: `/pair/state?c=${code}`, host: lanAuthority })
      expect(collected.status).toBe(200)
      expect(JSON.parse(collected.body)).toEqual({ status: 'approved' })
      if (collected.setCookie === undefined) throw new Error('approval did not hand out a device cookie')
      expect(collected.setCookie).toContain('HttpOnly')
      expect(collected.setCookie).not.toContain('Secure')
      const device = collected.setCookie.split(';', 1)[0]!
      expect(device).not.toBe(computer)

      const phoneCall = (): Promise<HttpResult> => call(port, {
        path: '/api/settings/describe',
        host: lanAuthority,
        method: 'POST',
        cookie: device,
        body: JSON.stringify({
          type: 'client-request',
          rpcId: 'pairing-real-cli',
          method: 'settings/describe',
          payload: { args: {} },
        }),
      })
      expect((await phoneCall()).status).toBe(200)

      // The phone holds a valid device session, and still may not decide: the
      // computer's routes require the loopback authority on top of it.
      for (const decision of [
        { path: '/pair/session', method: 'POST', body: undefined },
        { path: '/pair/requests', method: 'GET', body: undefined },
        { path: '/pair/devices', method: 'GET', body: undefined },
        { path: '/pair/approve', method: 'POST', body: JSON.stringify({ code, label: 'phone', allowed: true }) },
      ]) {
        const attempt = await call(port, {
          path: decision.path,
          host: lanAuthority,
          method: decision.method,
          cookie: device,
          ...decision.body === undefined ? {} : { body: decision.body },
        })
        expect([decision.path, attempt.status]).toEqual([decision.path, 403])
      }

      // The computer revokes the device, and the same cookie stops working.
      const devices = JSON.parse((await call(port, {
        path: '/pair/devices',
        host: loopbackAuthority,
        cookie: computer,
      })).body) as { devices: { id: string; label: string }[] }
      expect(devices.devices).toEqual([expect.objectContaining({ label: 'study phone' })])
      const revoked = await call(port, {
        path: '/pair/revoke',
        host: loopbackAuthority,
        method: 'POST',
        cookie: computer,
        body: JSON.stringify({ deviceId: devices.devices[0]!.id }),
      })
      expect(revoked.status).toBe(200)
      expect(JSON.parse(revoked.body)).toEqual({ ok: true })
      expect((await phoneCall()).status).toBe(401)
      expect(JSON.parse((await call(port, {
        path: '/pair/devices',
        host: loopbackAuthority,
        cookie: computer,
      })).body)).toEqual({ devices: [] })

      // A code that was never opened, from a source that keeps guessing, is
      // throttled rather than searchable.
      for (let attempt = 0; attempt < 5; attempt++) {
        await call(port, { path: '/pair/state?c=ZZZZZZZZ', host: lanAuthority })
      }
      expect(JSON.parse((await call(port, {
        path: '/pair/state?c=ZZZZZZZZ',
        host: lanAuthority,
      })).body)).toEqual({ status: 'locked' })
    } catch (error) {
      throw new Error(`${error instanceof Error ? error.message : String(error)}\n${redact(running?.output() ?? '')}`, { cause: error })
    } finally {
      if (running !== undefined) await stopWeb(running)
      await rm(root, { recursive: true, force: true })
    }
  })
})
