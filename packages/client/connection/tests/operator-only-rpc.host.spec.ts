/**
 * Operator-only shared-channel endpoints: the transport admits a paired device,
 * but an endpoint the deployment reserved for the operator refuses that device's
 * Peer, so Host administration never rides a phone's credential.
 */

import { Context } from '@deepseek-ai/cordis'
import type { PeerScope } from '@deepseek-ai/dsh-typert-protocol'
import { describe, expect, it } from 'vitest'
import type { BrowserAuth } from '../src/browser-auth.ts'
import type { ConnectionRpcHandlerResult } from '../src/rpc.ts'
import { HostConnectionService } from '../src/rpc-host.ts'

interface Bench {
  readonly ctx: Context
  readonly connection: HostConnectionService
  /** Endpoints the interceptor actually invoked. */
  readonly calls: string[]
}

/**
 * Mount a Connection over a hand-built tree with one shared-channel interceptor.
 * @returns the service, the operator Peer, and the recorded handler calls.
 */
function bench(): Bench {
  const ctx = new Context()
  const calls: string[] = []
  new HostConnectionService(ctx, [], {} as BrowserAuth, 1_048_576)
  const connection = ctx.get('connection') as HostConnectionService
  const handler = async (endpoint: string): Promise<ConnectionRpcHandlerResult> => {
    calls.push(endpoint)
    return { ok: true, value: { endpoint } }
  }
  connection.rpc.intercept('/api', () => true, handler)
  return { ctx, connection, calls }
}

/** A Peer that is not the operator's: the identity a paired device is admitted as. */
function devicePeer(): PeerScope {
  return { id: 'device-peer' } as unknown as PeerScope
}

/**
 * Call one endpoint through the shared channel.
 * @param connection - the service under test.
 * @param peer - admitted Peer the request speaks for.
 * @param endpoint - endpoint text after `/api/`.
 * @returns the response status.
 */
async function call(connection: HostConnectionService, peer: PeerScope, endpoint: string): Promise<number> {
  const handler = connection.createSharedFetchHandler('/api', peer)
  return (await handler.fetch(new Request(`http://host/api/${endpoint}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'client-request', rpcId: 'rpc-1', method: endpoint, payload: {} }),
  }))).status
}

describe('operator-only shared-channel endpoints', () => {
  it('refuses a paired device on a reserved endpoint and leaves the rest of the surface open', async () => {
    const { connection, calls } = bench()
    const release = connection.reserveOperatorOnly('settings/mutate')

    expect(await call(connection, devicePeer(), 'settings/mutate')).toBe(403)
    expect(calls).toEqual([])

    // The same device keeps every unreserved endpoint: pairing authenticates
    // using the agent, and only administration is reserved.
    expect(await call(connection, devicePeer(), 'session/list')).toBe(200)
    expect(calls).toEqual(['session/list'])

    // The operator's own Peer keeps the reserved endpoint.
    expect(await call(connection, connection.operator, 'settings/mutate')).toBe(200)
    expect(calls).toEqual(['session/list', 'settings/mutate'])

    release()
    expect(await call(connection, devicePeer(), 'settings/mutate')).toBe(200)
  })

  it('releases every reservation on disposal and rejects malformed endpoint names', () => {
    const { connection } = bench()
    const release = connection.reserveOperatorOnly('settings/mutate')
    expect(() => connection.reserveOperatorOnly('')).toThrow('is not a shared-channel endpoint')
    expect(() => connection.reserveOperatorOnly('settings/mutate?x=1')).toThrow('is not a shared-channel endpoint')
    release()
    return expect(call(connection, devicePeer(), 'settings/mutate')).resolves.toBe(200)
  })
})
