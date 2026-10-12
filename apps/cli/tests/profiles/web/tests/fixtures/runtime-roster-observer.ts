/** Test-only IPC observer mounted beside the unchanged default Web composition. */

import type { Context } from '@deepseek-ai/cordis'
import { runtimeRoster } from '../runtime-roster.ts'

/** Services whose live state the observer reads. */
export const inject = ['loader', 'clientModules']

/** One test-only probe of the opt-in Schedule plugin against a Session in the live process. */
export interface ScheduleProbe {
  /** Session whose owning root agent carries the reminder. */
  readonly sessionId: string
  /** Real `schedule_*` management call to execute, or `inspect` for a read-only observation. */
  readonly action: 'inspect' | 'create' | 'list' | 'delete'
  /** Exact tool arguments for `create` and `delete`. */
  readonly args?: Record<string, unknown>
}

/** Evidence one probe returns from the real plugin composition. */
export interface ScheduleProbeResult {
  /** `schedule_*` names the Session's own agent scope resolves. */
  readonly tools: readonly string[]
  /** Real tool result; absent for `inspect`. */
  readonly result?: { readonly isError: boolean; readonly value: unknown }
  /** Registered `schedule` Session projection at the current log cut. */
  readonly projection: unknown
  /** Durable `schedule/change` payloads in log order. */
  readonly changes: readonly Record<string, unknown>[]
  /** Model-facing reminder framings this Session recorded, in log order. */
  readonly framings: readonly string[]
  /** Whether the owning `sessions` service confirmed the log reached its backend. */
  readonly durable: boolean
}

/** Structural view of the live services one probe reads. */
interface ProbeServices {
  readonly agents: { get(sessionId: string): ProbeAgent | undefined }
  readonly tools: {
    execute(input: {
      readonly callId: string
      readonly name: string
      readonly arguments: unknown
      readonly agent: ProbeAgent
      readonly signal: AbortSignal
    }): Promise<{ readonly isError: boolean; readonly value: unknown }>
    schemas(scope?: ProbeAgent): readonly { readonly name: string }[]
  }
  readonly sessions: { flush(session: ProbeSession): Promise<boolean> }
  readonly sessionProjections?: {
    snapshot(
      session: ProbeSession,
      keys?: readonly string[],
    ): { readonly values: Readonly<Record<string, unknown>> }
  }
}

/** The live root agent one probe addresses. */
interface ProbeAgent {
  readonly session: ProbeSession
}

/** The Session event log one probe folds and reads. */
interface ProbeSession {
  snapshotEvents(): readonly ProbeEvent[]
}

/** The event fields one probe reads. */
interface ProbeEvent {
  readonly type: string
  readonly data: Record<string, unknown>
}

/** One IPC request from the owning test process. */
interface ObserverRequest {
  readonly command?: string
  readonly probeId?: string
  readonly probe?: ScheduleProbe
}

/** Resolve one live service, failing the probe that names a service this process does not publish. */
function probeService<K extends keyof ProbeServices>(ctx: Context, name: K): ProbeServices[K] {
  const found = ctx.get(name) as ProbeServices[K] | undefined
  if (found === undefined) throw new Error(`Schedule probe requires the ${name} service`)
  return found
}

/** Every text block one recorded plugin message carries. */
function messageText(data: Record<string, unknown>): string[] {
  const content = data['content']
  if (!Array.isArray(content)) return []
  return content.flatMap((block: unknown) => {
    if (typeof block !== 'object' || block === null) return []
    const text = (block as { readonly text?: unknown }).text
    return typeof text === 'string' ? [text] : []
  })
}

/**
 * Execute one test-only Schedule probe through the real plugin, never a hand-built stub.
 * @param ctx - observer context inside the shipped Web profile.
 * @param probe - Session, management call, and exact arguments to exercise.
 * @returns the real tool result plus the projection and durable-log evidence it produced.
 */
async function scheduleProbe(ctx: Context, probe: ScheduleProbe): Promise<ScheduleProbeResult> {
  const agent = probeService(ctx, 'agents').get(probe.sessionId)
  if (agent === undefined) throw new Error(`Schedule probe found no live agent for Session ${probe.sessionId}`)
  const tools = probeService(ctx, 'tools')
  const result = probe.action === 'inspect' ? undefined : await tools.execute({
    callId: `schedule-probe-${probe.action}`,
    name: `schedule_${probe.action}`,
    arguments: probe.args ?? {},
    agent,
    signal: AbortSignal.timeout(10_000),
  })
  const durable = await probeService(ctx, 'sessions').flush(agent.session)
  const projections = ctx.get('sessionProjections') as ProbeServices['sessionProjections']
  const events = agent.session.snapshotEvents()
  return {
    tools: tools.schemas(agent)
      .map(schema => schema.name)
      .filter(name => name.startsWith('schedule_')),
    ...result === undefined ? {} : { result: { isError: result.isError, value: result.value } },
    projection: projections?.snapshot(agent.session, ['schedule']).values['schedule'] ?? null,
    changes: events
      .filter(event => event.type === 'schedule/change')
      .map(event => event.data),
    framings: events
      .filter(event => event.type === 'user/message'
        && (event.data['source'] as { readonly plugin?: unknown } | undefined)?.plugin === 'schedule')
      .flatMap(event => messageText(event.data)),
    durable,
  }
}

/**
 * Observe the shipped process, mount the real negative-control plugin, or probe Schedule.
 * @param ctx - context in the real Loader tree.
 * @param config - absolute module URL used only by the explicit negative-control command.
 */
export function apply(ctx: Context, config: { negativeControl: string }): void {
  if (process.send === undefined) throw new Error('Runtime roster observer requires an IPC channel')
  const receive = (message: unknown): void => {
    if (message === 'stop') {
      process.emit('SIGTERM')
      return
    }
    if (typeof message === 'object' && message !== null && (message as ObserverRequest).command === 'schedule-probe') {
      const request = message as ObserverRequest
      void (async () => {
        try {
          if (request.probe === undefined) throw new Error('schedule-probe requires a probe payload')
          const result = await scheduleProbe(ctx, request.probe)
          process.send!({ command: 'schedule-probe', probeId: request.probeId, result })
        } catch (error: unknown) {
          process.send!({
            command: 'schedule-probe',
            probeId: request.probeId,
            error: error instanceof Error ? error.stack : String(error),
          })
        }
      })()
      return
    }
    if (message !== 'roster' && message !== 'mount-experimental' && message !== 'mount-experimental-entry') return
    void (async () => {
      if (message === 'mount-experimental') {
        const namespace: unknown = await import(config.negativeControl)
        await ctx.plugin(ctx.loader.unwrapExports(namespace))
      }
      if (message === 'mount-experimental-entry') await ctx.loader.create({ name: config.negativeControl })
      await ctx.loader.await()
      process.send!({ command: message, roster: runtimeRoster(ctx) })
    })().catch((error: unknown) => {
      process.send!({ command: message, error: error instanceof Error ? error.stack : String(error) })
    })
  }
  ctx.effect(() => {
    process.on('message', receive)
    return () => { process.off('message', receive) }
  })
}
