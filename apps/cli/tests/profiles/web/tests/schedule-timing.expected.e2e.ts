/** Built CLI, the fork's opt-in Host Schedule plugin, and its session-local after/at/every timing. */

import { randomUUID } from 'node:crypto'
import { readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { zstdDecompressSync } from 'node:zlib'
import { expect, it } from 'vitest'
import { withDefaultWeb, webGet, webRequest } from './default-web-process.ts'

/** Schedule is opt-in: the shipped Web graph mounts neither half, so this spec inserts the Host row. */
const SCHEDULE_PLUGIN_ROW = { insert: [{ id: 'schedule', name: '@deepseek-ai/dsh-schedule' }] }

/** Refused loopback endpoint: reminder delivery re-enters the agent, and this case asserts the durable delivery, not a reply. */
const NO_MODEL_ENDPOINT = 'http://127.0.0.1:1'

/** Zone whose offset is stable, so one local wall clock names exactly one instant. */
const ZONE = 'Asia/Shanghai'

const AFTER_PROMPT = 'Check the deployment log'
const AT_PROMPT = 'Review the release window'
const EVERY_PROMPT = 'Check the primary metrics'

/** Write this case's Schedule patch into the root the owned process boots from. */
async function prepare(root: string): Promise<void> {
  await writeFile(join(root, 'schedule.patch.json'), `${JSON.stringify([SCHEDULE_PLUGIN_ROW], null, 2)}\n`)
}

/** One public Remote call bound to the owned process's authenticated loopback session. */
async function connect(url: string, signal: AbortSignal) {
  const auth = await webGet(url, signal)
  const cookie = auth.headers['set-cookie']?.[0]?.split(';', 1)[0]
  if (cookie === undefined) throw new Error('Owned Web process did not issue its authentication cookie')
  return async (method: string, args: Record<string, unknown>): Promise<unknown> => {
    const rpcId = randomUUID()
    const response = await webRequest(new URL(`/api/${method}`, url), signal, {
      method: 'POST', headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'client-request', rpcId, method, payload: { args } }),
    })
    expect(response.status, response.text).toBe(200)
    const envelope = JSON.parse(response.text) as { type?: unknown; rpcId?: unknown; result?: unknown }
    expect(envelope).toMatchObject({ type: 'server-response', rpcId })
    return envelope.result
  }
}

/** Render one epoch as exact local calendar fields in an explicit zone. */
function localAt(epoch: number, timeZone: string): { date: string; time: string; time_zone: string } {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(epoch).map(part => [part.type, part.value])) as Record<string, string>
  return {
    date: `${parts['year']}-${parts['month']}-${parts['day']}`,
    time: `${parts['hour']}:${parts['minute']}:${parts['second']}`,
    time_zone: timeZone,
  }
}

/** One durable Session log row the owned process wrote below its DSH home. */
interface DurableRow {
  readonly type: string
  readonly data: Record<string, unknown>
}

/**
 * Read every durable Session log record under the owned home.
 * @param home - the owned process's isolated DSH home.
 * @returns records in file order, decompressing the backend's default Zstandard artifact.
 */
async function durableRows(home: string): Promise<DurableRow[]> {
  const artifacts: string[] = []
  const walk = async (directory: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) await walk(path)
      else if (entry.name.endsWith('.jsonl') || entry.name.endsWith('.jsonl.zstd')) artifacts.push(path)
    }
  }
  await walk(join(home, 'sessions'))
  const rows: DurableRow[] = []
  for (const artifact of artifacts) {
    const bytes = await readFile(artifact)
    const text = (artifact.endsWith('.zstd') ? zstdDecompressSync(bytes) : bytes).toString('utf8')
    for (const line of text.split('\n')) {
      if (line.length === 0) continue
      const parsed = JSON.parse(line) as { type?: unknown; data?: unknown }
      if (typeof parsed.type === 'string' && typeof parsed.data === 'object' && parsed.data !== null) {
        rows.push({ type: parsed.type, data: parsed.data as Record<string, unknown> })
      }
    }
  }
  return rows
}

it('creates after and at reminders through the built Remote bindings and delivers each on its own deadline', async (test) => {
  const sessionId = 'schedule-timing-delivery'
  await withDefaultWeb(test, async ({ root, url, probe }) => {
    const rpc = await connect(url, test.signal)
    expect(await rpc('session/create', { request: { sessionId, cwd: root } }))
      .toMatchObject({ ok: true, value: { sessionId } })

    // The real plugin published its three tools into this Session's own agent scope.
    const opened = await probe({ sessionId, action: 'inspect' })
    expect(opened.tools).toEqual(['schedule_create', 'schedule_list', 'schedule_delete'])
    expect(opened.projection).toEqual([])
    expect(opened.changes).toEqual([])

    // `after` targets one wall-clock instant the requested delay ahead of creation.
    const createdAfter = Date.now()
    const after = await probe({ sessionId, action: 'create', args: { prompt: AFTER_PROMPT, after_seconds: 3 } })
    const createdAfterAt = Date.now()
    expect(after.result?.isError).toBe(false)
    expect(after.result?.value).toMatchObject({
      id: 'schedule-1',
      kind: 'after',
      prompt: AFTER_PROMPT,
      afterSeconds: 3,
      state: 'scheduled',
      deliveryMode: 'session-local',
    })
    const target = Date.parse((after.result?.value as { scheduledAt: string }).scheduledAt)
    expect(target).toBeGreaterThanOrEqual(createdAfter + 3_000)
    expect(target).toBeLessThanOrEqual(createdAfterAt + 3_000)
    const scheduledAt = new Date(target).toISOString()
    const afterRecord = {
      id: 'schedule-1', kind: 'after', prompt: AFTER_PROMPT, afterSeconds: 3, scheduledAt,
    }
    expect(after.projection).toEqual([afterRecord])
    expect(after.changes).toEqual([{ version: 1, operation: 'create', schedule: afterRecord }])
    expect(after.durable).toBe(true)

    // Delivery is a durable dispatch the live runtime appends only once the target passes.
    await expect.poll(async () => (await probe({ sessionId, action: 'inspect' })).changes.length, { timeout: 30_000 })
      .toBe(2)
    const deliveredAfter = await probe({ sessionId, action: 'inspect' })
    expect(deliveredAfter.changes).toEqual([
      { version: 1, operation: 'create', schedule: afterRecord },
      { version: 1, operation: 'dispatch', id: 'schedule-1' },
    ])
    expect(deliveredAfter.projection).toEqual([])
    expect(deliveredAfter.framings).toHaveLength(1)
    expect(deliveredAfter.framings[0]).toContain('[SCHEDULE REMINDER]')
    expect(deliveredAfter.framings[0]).toContain(`reminder_prompt_json: ${JSON.stringify(AFTER_PROMPT)}`)

    // `at` resolves one explicit local wall clock in its own zone to the same UTC instant.
    const instant = Math.ceil((Date.now() + 3_000) / 1_000) * 1_000
    const local = localAt(instant, ZONE)
    const at = await probe({ sessionId, action: 'create', args: { prompt: AT_PROMPT, at: local } })
    expect(at.result?.isError).toBe(false)
    expect(at.result?.value).toEqual({
      id: 'schedule-2',
      kind: 'at',
      prompt: AT_PROMPT,
      scheduledAt: new Date(instant).toISOString(),
      state: 'scheduled',
      deliveryMode: 'session-local',
    })
    await expect.poll(async () => (await probe({ sessionId, action: 'inspect' })).changes.length, { timeout: 30_000 })
      .toBe(4)
    const deliveredAt = await probe({ sessionId, action: 'inspect' })
    expect(deliveredAt.changes.slice(2)).toEqual([
      { version: 1, operation: 'dispatch', id: 'schedule-2' },
    ])
    expect(deliveredAt.framings).toHaveLength(2)

    // The same state survives as the durable Session log this owned process wrote.
    const rows = await durableRows(join(root, 'home'))
    const atRecord = {
      id: 'schedule-2', kind: 'at', prompt: AT_PROMPT, scheduledAt: new Date(instant).toISOString(),
    }
    expect(rows.filter(row => row.type === 'schedule/change').map(row => row.data)).toEqual([
      { version: 1, operation: 'create', schedule: afterRecord },
      { version: 1, operation: 'dispatch', id: 'schedule-1' },
      { version: 1, operation: 'create', schedule: atRecord },
      { version: 1, operation: 'dispatch', id: 'schedule-2' },
    ])
  }, {
    prepare,
    patches: ['schedule.patch.json'],
    env: { DEEPSEEK_BASE_URL: NO_MODEL_ENDPOINT },
  })
})

it('accepts, lists, and deletes fixed-rate reminders and answers unsupported rules with stable input codes', async (test) => {
  const sessionId = 'schedule-timing-rules'
  await withDefaultWeb(test, async ({ root, url, probe }) => {
    const rpc = await connect(url, test.signal)
    expect(await rpc('session/create', { request: { sessionId, cwd: root } }))
      .toMatchObject({ ok: true, value: { sessionId } })

    const every = await probe({
      sessionId,
      action: 'create',
      args: { prompt: EVERY_PROMPT, every_seconds: 300 },
    })
    expect(every.result?.isError).toBe(false)
    expect(every.result?.value).toMatchObject({
      id: 'schedule-1',
      kind: 'every',
      prompt: EVERY_PROMPT,
      everySeconds: 300,
      state: 'scheduled',
      deliveryMode: 'session-local',
    })
    expect(await probe({ sessionId, action: 'list' })).toMatchObject({
      result: { isError: false, value: [{ id: 'schedule-1', kind: 'every', everySeconds: 300 }] },
    })

    // Each rejected rule returns its own stable code instead of an exception.
    const rejected: Array<[Record<string, unknown>, string]> = [
      [{ prompt: '   ', after_seconds: 60 }, 'invalid_prompt'],
      [{ prompt: 'both', after_seconds: 60, every_seconds: 300 }, 'invalid_selector'],
      [{ prompt: 'no selector' }, 'invalid_selector'],
      [{ prompt: 'zero delay', after_seconds: 0 }, 'invalid_rule'],
      [{ prompt: 'too frequent', every_seconds: 299 }, 'frequency_too_high'],
      [{ prompt: 'bad zone', at: { date: '2099-01-01', time: '09:00:00', time_zone: 'Nowhere/Fake' } }, 'invalid_time_zone'],
      [{ prompt: 'past', at: '2000-01-01T00:00:00Z' }, 'not_future'],
    ]
    for (const [args, code] of rejected) {
      const outcome = await probe({ sessionId, action: 'create', args })
      expect(outcome.result?.isError, JSON.stringify(args)).toBe(false)
      expect(outcome.result?.value, JSON.stringify(args)).toMatchObject({ code })
    }

    // Rejected rules changed nothing durable, and a delete names exactly what it removed.
    const everyScheduledAt = (every.result?.value as { scheduledAt: string }).scheduledAt
    const everyRecord = {
      id: 'schedule-1',
      kind: 'every',
      prompt: EVERY_PROMPT,
      everySeconds: 300,
      scheduledAt: everyScheduledAt,
    }
    const unchanged = await probe({ sessionId, action: 'list' })
    expect(unchanged.result?.value).toEqual([everyRecord])
    expect(await probe({ sessionId, action: 'delete', args: { id: 'schedule-404' } })).toMatchObject({
      result: { isError: false, value: { id: 'schedule-404', deleted: false, code: 'schedule_not_found' } },
    })
    expect(await probe({ sessionId, action: 'delete', args: { id: 'schedule-1' } })).toMatchObject({
      result: { isError: false, value: { id: 'schedule-1', deleted: true } },
    })
    const emptied = await probe({ sessionId, action: 'list' })
    expect(emptied.result?.value).toEqual([])
    expect(emptied.projection).toEqual([])
    expect(emptied.changes).toEqual([
      { version: 1, operation: 'create', schedule: everyRecord },
      { version: 1, operation: 'delete', id: 'schedule-1' },
    ])
  }, { prepare, patches: ['schedule.patch.json'] })
})
