import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import type { BrowserAuth } from '../src/browser-auth.ts'
import { DEFAULT_MAX_REQUEST_BODY_BYTES } from '../src/http-bridge.ts'
import { HostConnectionService } from '../src/rpc-host.ts'

async function mounted(): Promise<{
  readonly connection: HostConnectionService
  readonly dispose: () => Promise<void>
}> {
  const ctx = new Context()
  const fiber = ctx.plugin((pluginCtx) => {
    new HostConnectionService(pluginCtx, [], {} as BrowserAuth, DEFAULT_MAX_REQUEST_BODY_BYTES)
  })
  await fiber.await()
  return {
    connection: ctx.get('connection') as HostConnectionService,
    dispose: () => fiber.dispose(),
  }
}

describe('Connection exact Fetch routes', () => {
  it('dispatches owned methods and returns 404 for unclaimed requests', async () => {
    const { connection, dispose: disposeFiber } = await mounted()
    const route = vi.fn(async (request: Request) =>
      Response.json({ query: new URL(request.url).searchParams.get('sessionId') }))
    const dispose = connection.fetch.register({
      path: '/api/session.export',
      methods: ['GET', 'HEAD', 'POST'],
      requestBody: 'streaming',
      fetch: route,
    })
    const shared = connection.createSharedFetchHandler('/api')

    const response = await shared.fetch(new Request(
      'http://host/api/session.export?sessionId=session-1',
    ))
    expect(shared.requestBodyMode({
      method: 'POST', url: new URL('http://host/api/session.export'),
    })).toBe('streaming')
    expect(shared.requestBodyMode({
      method: 'DELETE', url: new URL('http://host/api/session.export'),
    })).toBe('buffered')
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ query: 'session-1' })
    expect(route).toHaveBeenCalledOnce()
    const post = await shared.fetch(new Request('http://host/api/session.export', { method: 'POST' }))
    expect(post.status).toBe(200)
    expect(route).toHaveBeenCalledTimes(2)

    await dispose()
    const withdrawn = await shared.fetch(new Request('http://host/api/session.export'))
    expect(withdrawn.status).toBe(404)
    await disposeFiber()
  })

  it('rejects invalid and duplicate registrations, and a mode that contradicts the methods', async () => {
    const { connection, dispose: disposeFiber } = await mounted()
    const fetch = async (): Promise<Response> => new Response()

    expect(() => connection.fetch.register({ path: '/outside', methods: ['GET'], requestBody: 'none', fetch }))
      .toThrow('invalid exact Fetch route')
    expect(() => connection.fetch.register({ path: '/api/session.export', methods: [], requestBody: 'none', fetch }))
      .toThrow('declares no methods')
    expect(() => connection.fetch.register({
      path: '/api/session.export', methods: ['GET', 'GET'], fetch,
      requestBody: 'none',
    })).toThrow('repeats a method')
    // Fetch forbids a body on GET and HEAD, so a body mode there could only
    // reach the bridge as a TypeError; the reverse pairing is equally invalid.
    expect(() => connection.fetch.register({
      path: '/api/session.export', methods: ['GET', 'HEAD'], fetch,
      requestBody: 'buffered',
    })).toThrow("owns only GET and HEAD and must declare requestBody 'none'")
    expect(() => connection.fetch.register({
      path: '/api/session.export', methods: ['POST'], fetch,
      requestBody: 'none',
    })).toThrow("owns POST and cannot declare requestBody 'none'")
    const dispose = connection.fetch.register({
      path: '/api/session.export', methods: ['GET'], fetch,
      requestBody: 'none',
    })
    expect(() => connection.fetch.register({
      path: '/api/session.export', methods: ['HEAD'], fetch,
      requestBody: 'none',
    })).toThrow('already registered')
    await dispose()
    expect(() => connection.fetch.register({
      path: '/api/session.export', methods: ['HEAD'], fetch,
      requestBody: 'none',
    })).not.toThrow()
    await disposeFiber()
  })
})
