/**
 * The desktop half of the pairing handshake. It speaks the same `/pair*` routes
 * the phone uses, so the loopback-plus-session rule that guards a decision has
 * exactly one enforcement point.
 */

/** One request still waiting for a decision. */
export interface PendingPairingView {
  /** Code the phone claimed. */
  readonly code: string
  /** Epoch milliseconds the request opened. */
  readonly openedAt: number
  /** Epoch milliseconds the code expires. */
  readonly expiresAt: number
  /** Agent of the phone that claimed the code, when one did. */
  readonly userAgent?: string | undefined
}

/** One device approved through the pairing handshake. */
export interface PairedDeviceView {
  /** Opaque device id. */
  readonly id: string
  /** Operator-visible label. */
  readonly label: string
  /** Epoch milliseconds of approval. */
  readonly registeredAt: number
  /** Epoch milliseconds of the last accepted request. */
  readonly lastSeenAt: number
  /** Days the operator set for this device's current window; absent on a legacy entry. */
  readonly lifetimeDays?: number | undefined
  /** Epoch milliseconds this device's window ends; absent on a legacy entry. */
  readonly expiresAt?: number | undefined
}

/** A pairing session the computer opened for one phone. */
export interface PairingSessionView {
  /** Code the phone must claim. */
  readonly code: string
  /** Epoch milliseconds the code stops working. */
  readonly expiresAt: number
}

/** Why a pairing call produced no value. */
export type PairingFailureKind = 'forbidden' | 'gone' | 'expired' | 'failed'

/** Result of one pairing call. */
export type PairingResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly reason: PairingFailureKind }

/** The pairing routes as this page uses them. */
export interface PairingApi {
  /** Open a request for a phone to claim. */
  open(): Promise<PairingResult<PairingSessionView>>
  /** List the requests still waiting. */
  requests(): Promise<PairingResult<readonly PendingPairingView[]>>
  /** Apply a decision, with the label the operator accepted. */
  decide(code: string, label: string, allowed: boolean): Promise<PairingResult<void>>
  /** List the approved devices. */
  devices(): Promise<PairingResult<readonly PairedDeviceView[]>>
  /** Revoke one device. */
  revoke(deviceId: string): Promise<PairingResult<void>>
  /** Set one device's delivery window, in days. */
  setLifetime(deviceId: string, days: number): Promise<PairingResult<void>>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Read a string field from an untrusted answer. */
function stringField(value: Record<string, unknown>, name: string): string | undefined {
  const field = value[name]
  return typeof field === 'string' ? field : undefined
}

/** Read a number field from an untrusted answer. */
function numberField(value: Record<string, unknown>, name: string): number | undefined {
  const field = value[name]
  return typeof field === 'number' && Number.isFinite(field) ? field : undefined
}

function failureOf(status: number): PairingFailureKind {
  if (status === 403) return 'forbidden'
  if (status === 404) return 'gone'
  if (status === 410) return 'expired'
  return 'failed'
}

/** One call against the pairing routes. */
async function call(path: string, init?: { method?: string; body?: unknown }): Promise<PairingResult<unknown>> {
  let response: Response
  try {
    response = await fetch(path, {
      method: init?.method ?? 'GET',
      credentials: 'same-origin',
      headers: {
        accept: 'application/json',
        ...init?.body === undefined ? {} : { 'content-type': 'application/json' },
      },
      ...init?.body === undefined ? {} : { body: JSON.stringify(init.body) },
    })
  } catch {
    // The only statement that can throw here is the request itself.
    return { ok: false, reason: 'failed' }
  }
  if (!response.ok) return { ok: false, reason: failureOf(response.status) }
  let payload: unknown
  try {
    payload = await response.json()
  } catch {
    // The only statement that can throw here is decoding the answer body.
    return { ok: false, reason: 'failed' }
  }
  return { ok: true, value: payload }
}

function pendingOf(value: unknown): PendingPairingView | undefined {
  if (!isRecord(value)) return undefined
  const code = stringField(value, 'code')
  const openedAt = numberField(value, 'openedAt')
  const expiresAt = numberField(value, 'expiresAt')
  if (code === undefined || openedAt === undefined || expiresAt === undefined) return undefined
  const userAgent = stringField(value, 'userAgent')
  return { code, openedAt, expiresAt, userAgent }
}

function deviceOf(value: unknown): PairedDeviceView | undefined {
  if (!isRecord(value)) return undefined
  const id = stringField(value, 'id')
  const label = stringField(value, 'label')
  const registeredAt = numberField(value, 'registeredAt')
  const lastSeenAt = numberField(value, 'lastSeenAt')
  if (id === undefined || label === undefined || registeredAt === undefined || lastSeenAt === undefined) {
    return undefined
  }
  return {
    id,
    label,
    registeredAt,
    lastSeenAt,
    lifetimeDays: numberField(value, 'lifetimeDays'),
    expiresAt: numberField(value, 'expiresAt'),
  }
}

/**
 * Derive the device-name default from the phone's user agent.
 * @param userAgent - the agent the claiming request carried.
 * @returns a short model name, or undefined when the agent names none.
 */
export function deviceLabelFrom(userAgent: string | undefined): string | undefined {
  if (userAgent === undefined) return undefined
  const android = /Android[^;]*;\s*([^;)]+)/u.exec(userAgent)
  if (android?.[1] !== undefined && android[1].trim() !== '') return android[1].trim()
  const apple = /\((iPhone|iPad|iPod)/u.exec(userAgent)
  return apple?.[1]
}

/**
 * Compose the token-free URL a phone opens to claim a code.
 * @param joinUrl - this Host's LAN join URL, which carries the process token.
 * @param code - the code to claim.
 * @returns the `/pair` URL on the same origin, with no process token.
 */
export function pairingUrlOf(joinUrl: string, code: string): string {
  const url = new URL(joinUrl)
  url.pathname = '/pair'
  url.search = ''
  url.hash = ''
  url.searchParams.set('c', code)
  return url.href
}

/**
 * Build the pairing client for the page's own origin.
 * @returns the pairing routes behind a typed result.
 */
export function createPairingApi(): PairingApi {
  return {
    async open() {
      const answer = await call('/pair/session', { method: 'POST' })
      if (!answer.ok) return answer
      if (!isRecord(answer.value)) return { ok: false, reason: 'failed' }
      const code = stringField(answer.value, 'code')
      const expiresAt = numberField(answer.value, 'expiresAt')
      if (code === undefined || expiresAt === undefined) return { ok: false, reason: 'failed' }
      return { ok: true, value: { code, expiresAt } }
    },
    async requests() {
      const answer = await call('/pair/requests')
      if (!answer.ok) return answer
      const listed = isRecord(answer.value) ? answer.value.requests : undefined
      if (!Array.isArray(listed)) return { ok: false, reason: 'failed' }
      const requests: PendingPairingView[] = []
      for (const entry of listed) {
        const request = pendingOf(entry)
        if (request === undefined) return { ok: false, reason: 'failed' }
        requests.push(request)
      }
      return { ok: true, value: requests }
    },
    async decide(code, label, allowed) {
      const answer = await call('/pair/approve', { method: 'POST', body: { code, label, allowed } })
      return answer.ok ? { ok: true, value: undefined } : answer
    },
    async devices() {
      const answer = await call('/pair/devices')
      if (!answer.ok) return answer
      const listed = isRecord(answer.value) ? answer.value.devices : undefined
      if (!Array.isArray(listed)) return { ok: false, reason: 'failed' }
      const devices: PairedDeviceView[] = []
      for (const entry of listed) {
        const device = deviceOf(entry)
        if (device === undefined) return { ok: false, reason: 'failed' }
        devices.push(device)
      }
      return { ok: true, value: devices }
    },
    async revoke(deviceId) {
      const answer = await call('/pair/revoke', { method: 'POST', body: { deviceId } })
      if (!answer.ok) return answer
      const ok = isRecord(answer.value) ? answer.value.ok : undefined
      return ok === true ? { ok: true, value: undefined } : { ok: false, reason: 'failed' }
    },
    async setLifetime(deviceId, days) {
      const answer = await call('/pair/devices/lifetime', { method: 'POST', body: { deviceId, days } })
      if (!answer.ok) return answer
      const ok = isRecord(answer.value) ? answer.value.ok : undefined
      return ok === true ? { ok: true, value: undefined } : { ok: false, reason: 'failed' }
    },
  }
}
