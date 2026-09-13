# LAN Exposure and Device Lifetime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the paired-device registry the authority for how long each phone's cookie lives, let the operator see and re-schedule that lifetime per device in the pairing panel, and give the LAN warning and the READMEs an actionable narrowing recipe.

**Architecture:** `@deepseek-ai/dsh-client-connection` gains two optional fields on each `client-connection/paired-devices` entry (`lifetimeDays`, `expiresAt`); `BrowserAuth` stops holding a device-cookie policy and instead accepts a device cookie only while the registry still lists that device and the current time is before that entry's `expiresAt` (an entry without one keeps running on the expiry its signed payload carries). An index request carrying a cookie whose payload expiry lags the registry window stages an aligned replacement cookie through a new `ConnectionIndexResponse.setHeader`, so days added on the computer reach the phone on its next page load while a shortened window applies to its next request. `@deepseek-ai/dsh-mob` exposes the per-device control as `POST /pair/devices/lifetime` behind the existing loopback-plus-session guard and renders the lifetime column, its presets, and the revoke guidance from the typed `settings.mobile` dictionary.

**Tech Stack:** TypeScript ESM, Cordis plugins and Context services, `@deepseek-ai/schemastery` Config, `@deepseek-ai/dsh-credentials` (`$DSH_HOME/.credentials.yaml`), vitest (`pnpm exec vitest run`) with `@testing-library/react` for the panel, typed zh/en locale dictionaries in `@deepseek-ai/dsh-mob`.

**Spec:** [docs/superpowers/specs/2026-09-13-lan-exposure-and-device-lifetime-design.md](../specs/2026-09-13-lan-exposure-and-device-lifetime-design.md)

## Global Constraints

- Default per-device lifetime is **30 days**; the legal range is an integer **1–365 days** for `deviceLifetimeDays` and for every per-device value; **there is no never-expires option**.
- `deviceCookieMaxAgeDays` is deleted. No web-profile override of it exists, and nothing replaces it: the registry decides each device's window. `cookieMaxAgeDays` (default 30) and the launch-token cookie are untouched.
- The device-cookie envelope and payload are unchanged: `v2.<base64url payload>.<signature>` with `{version: 2, authority, deviceId, issuedAt, expiresAt}`. No renaming, no new field on the wire, no `Secure` attribute.
- Cookie refresh happens on index requests only; `/api` request paths never renew anything.
- `POST /pair/devices/lifetime` is loopback-authority **and** browser-session guarded, like `/pair/approve`, `/pair/revoke`, and `GET /pair/devices`.
- An entry that predates the lifetime fields is **never written back**: it keeps running on the expiry its cookie payload carries and shows `—` until the operator sets days for it.
- TDD: write the failing test first, run it and see it fail, implement, run it and see it pass, then commit. One single-line conventional commit per task.
- Every code comment is English. Every client-visible string goes through the typed `settings.mobile` dictionary (`src/client/locales.ts`), never a literal in a component.
- Run focused specs with `pnpm exec vitest run <path>`; `packages/*/*/src` carries a per-file 100% coverage gate, so no unreachable branch may be added.
- Docs are bilingual and paired: edit `X.md` and `X.zh.md`, then re-record with `pnpm run verify-translation-pairing --write X.md`. Every Markdown file ends with exactly one trailing newline and holds one physical line per paragraph.

---

### Task 1: Registry lifetime fields

**Files:**
- Modify: `packages/client/connection/src/device-types.ts`
- Modify: `packages/client/connection/src/devices.ts`
- Test: `packages/client/connection/tests/devices.host.spec.ts`

**Interfaces:**
- Consumes: `CredentialRecord` payload `{version: 1, devices: PairedDevice[]}` as `devicesOf` parses it today.
- Produces: `PairedDevice.lifetimeDays?: number` (days the operator chose) and `PairedDevice.expiresAt?: number` (epoch milliseconds this window ends).

- [ ] **Step 1: Write the failing tests**

In `packages/client/connection/tests/devices.host.spec.ts`, add the round-trip test inside `describe('listDevices')` after the existing 'reads the registered devices in stored order' case:

```ts
  it('round-trips the lifetime fields and leaves a legacy entry unchanged', async () => {
    const store = new RecordCredentials()
    const windowed = { ...device, lifetimeDays: 30, expiresAt: 1_702_592_000_000 }
    store.setPairedDevices({ version: 1, devices: [device, windowed] })

    await expect(listDevices(credentials(store))).resolves.toEqual([device, windowed])
  })
```

Then add these payloads to the `payloads` array of the existing 'fails loud on a record it cannot interpret' case:

```ts
      { version: 1, devices: [{ ...device, lifetimeDays: 0 }] },
      { version: 1, devices: [{ ...device, lifetimeDays: 1.5 }] },
      { version: 1, devices: [{ ...device, lifetimeDays: '30' }] },
      { version: 1, devices: [{ ...device, expiresAt: 'soon' }] },
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm exec vitest run packages/client/connection/tests/devices.host.spec.ts`

Expected: FAIL — the round-trip case loses `lifetimeDays`/`expiresAt` (the parsed entry is `{id, label, registeredAt, lastSeenAt}`), and the four new malformed payloads resolve instead of rejecting.

- [ ] **Step 3: Extend the declaration**

In `packages/client/connection/src/device-types.ts`, replace the `PairedDevice` interface with:

```ts
/** One device approved through the pairing handshake. */
export interface PairedDevice {
  /** Opaque id minted at approval and carried by that device's cookie. */
  readonly id: PairedDeviceId
  /** Operator-visible label; the approve dialog prefills it and may edit it. */
  readonly label: string
  /** Epoch milliseconds of approval. */
  readonly registeredAt: number
  /** Epoch milliseconds of the last accepted request, written back with throttling. */
  readonly lastSeenAt: number
  /** Days this device's current window lasts, as the operator set it; absent on a legacy entry. */
  readonly lifetimeDays?: number
  /**
   * Epoch milliseconds this device's current window ends, written with
   * {@link PairedDevice.lifetimeDays}. Absent on a legacy entry, which keeps
   * running on the expiry its cookie payload carries.
   */
  readonly expiresAt?: number
}
```

- [ ] **Step 4: Parse and validate the fields**

In `packages/client/connection/src/devices.ts`, replace `deviceOf` with:

```ts
function deviceOf(value: unknown): PairedDevice {
  if (!isRecord(value)) throw malformed('has a non-object entry')
  const { id, label, registeredAt, lastSeenAt, lifetimeDays, expiresAt } = value
  if (typeof id !== 'string' || id === '') throw malformed('has an entry without an id')
  if (typeof label !== 'string') throw malformed(`entry ${id} has a non-string label`)
  if (!Number.isSafeInteger(registeredAt)) throw malformed(`entry ${id} has an invalid registration time`)
  if (!Number.isSafeInteger(lastSeenAt)) throw malformed(`entry ${id} has an invalid last-seen time`)
  // The stored window is record integrity, not policy: the 1–365 day range is
  // enforced where an operator value enters, in the config schema and the route.
  if (lifetimeDays !== undefined && !(Number.isSafeInteger(lifetimeDays) && lifetimeDays >= 1)) {
    throw malformed(`entry ${id} has an invalid lifetime`)
  }
  if (expiresAt !== undefined && !Number.isSafeInteger(expiresAt)) {
    throw malformed(`entry ${id} has an invalid expiry`)
  }
  const device: PairedDevice = {
    id: PairedDeviceId(id),
    label,
    registeredAt: registeredAt as number,
    lastSeenAt: lastSeenAt as number,
  }
  if (lifetimeDays === undefined && expiresAt === undefined) return device
  return {
    ...device,
    ...lifetimeDays === undefined ? {} : { lifetimeDays: lifetimeDays as number },
    ...expiresAt === undefined ? {} : { expiresAt: expiresAt as number },
  }
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm exec vitest run packages/client/connection/tests/devices.host.spec.ts`

Expected: PASS — 6 cases green, including the four new malformed payloads.

- [ ] **Step 6: Commit**

```bash
git add packages/client/connection/src/device-types.ts packages/client/connection/src/devices.ts packages/client/connection/tests/devices.host.spec.ts
git commit -m "feat(client-connection): store a lifetime window on paired devices"
```

### Task 2: Re-schedule one device

**Files:**
- Modify: `packages/client/connection/src/devices.ts`
- Test: `packages/client/connection/tests/devices.host.spec.ts`

**Interfaces:**
- Consumes: `PairedDevice.lifetimeDays`/`expiresAt` from Task 1; `writeDevices`, `listDevices`, `malformed`.
- Produces: `setDeviceLifetime(credentials: CredentialProvider, deviceId: PairedDeviceId, days: number): Promise<boolean>` — writes `lifetimeDays: days` and `expiresAt: Date.now() + days * DAY_MILLISECONDS` on the named entry, restarting that device's countdown, and returns false without writing for an unknown id.

- [ ] **Step 1: Write the failing test**

In `packages/client/connection/tests/devices.host.spec.ts`, extend the import from `../src/devices.ts` with `setDeviceLifetime`, then add this case inside `describe('paired-device registry writes')` after the revoke case:

```ts
  it('re-schedules one device and restarts its countdown', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-12T12:00:00.000Z'))
    const store = new RecordCredentials()
    store.setPairedDevices({ version: 1, devices: [device, { ...device, id: 'dev-2', label: 'iPad' }] })
    const provider = credentials(store)

    await expect(setDeviceLifetime(provider, PairedDeviceId('dev-1'), 30)).resolves.toBe(true)
    vi.setSystemTime(new Date('2026-09-12T12:05:00.000Z'))
    await expect(setDeviceLifetime(provider, PairedDeviceId('dev-1'), 7)).resolves.toBe(true)

    const listed = await listDevices(provider)
    expect(listed[0]).toEqual({
      ...device,
      lifetimeDays: 7,
      expiresAt: Date.parse('2026-09-12T12:05:00.000Z') + 7 * 24 * 60 * 60 * 1000,
    })
    expect(listed[1]).toEqual({ ...device, id: 'dev-2', label: 'iPad' })
    expect(store).toMatchObject({ writes: 2 })

    await expect(setDeviceLifetime(provider, PairedDeviceId('ghost'), 30)).resolves.toBe(false)
    expect(store).toMatchObject({ writes: 2 })
  })
```

Then add `setDeviceLifetime` to the existing 'fails loud instead of overwriting a registry it cannot read' case:

```ts
    await expect(setDeviceLifetime(provider, PairedDeviceId('dev-1'), 30)).rejects.toThrow(/paired-devices/u)
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run packages/client/connection/tests/devices.host.spec.ts`

Expected: FAIL — `setDeviceLifetime` is not exported (`TypeError: setDeviceLifetime is not a function`) and the malformed-registry case rejects with that same TypeError instead of `/paired-devices/u`.

- [ ] **Step 3: Implement the write**

In `packages/client/connection/src/devices.ts`, add the day constant next to `TOUCH_THROTTLE_MILLISECONDS`:

```ts
const DAY_MILLISECONDS = 24 * 60 * 60 * 1000
```

and insert this function after `revokeDevice`:

```ts
/**
 * Set one device's delivery window, restarting its countdown: a shorter window
 * applies to that device's next request, a longer one on its next index request.
 * @param credentials - persistent credential provider for the Web profile.
 * @param deviceId - id of the device to re-schedule.
 * @param days - window in days, written together with the expiry it implies.
 * @returns true when a registered device was re-scheduled.
 */
export async function setDeviceLifetime(
  credentials: CredentialProvider,
  deviceId: PairedDeviceId,
  days: number,
): Promise<boolean> {
  const devices = await listDevices(credentials)
  if (!devices.some(device => device.id === deviceId)) return false
  const expiresAt = Date.now() + days * DAY_MILLISECONDS
  await writeDevices(credentials, current => current.map(device =>
    (device.id === deviceId ? { ...device, lifetimeDays: days, expiresAt } : device)))
  return true
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm exec vitest run packages/client/connection/tests/devices.host.spec.ts`

Expected: PASS — 8 cases green.

- [ ] **Step 5: Commit**

```bash
git add packages/client/connection/src/devices.ts packages/client/connection/tests/devices.host.spec.ts
git commit -m "feat(client-connection): re-schedule one paired device"
```

### Task 3: The registry is the device-lifetime authority

**Files:**
- Modify: `packages/client/connection/src/browser-auth.ts`
- Modify: `packages/client/connection/src/devices.ts`
- Modify: `packages/client/connection/src/rpc-host.ts`
- Modify: `packages/client/connection/src/index.ts`
- Modify: `docs/config-catalog.md`
- Modify: `docs/config-catalog.zh.md`
- Modify: `docs/config-catalog.i18n.yaml`
- Test: `packages/client/connection/tests/browser-auth.host.spec.ts`
- Test: `packages/client/connection/tests/devices.host.spec.ts`
- Test: `packages/client/connection/tests/node-half.host.spec.ts`

**Interfaces:**
- Consumes: `PairedDevice` from Task 1, `setDeviceLifetime` from Task 2.
- Produces: `registerDevice(credentials: CredentialProvider, request: RegisterDeviceRequest, lifetimeDays: number): Promise<PairedDevice>` (writes `lifetimeDays` + `expiresAt`); `BrowserAuth.create(processOwner: object, credentials: CredentialProvider, maxAgeDays: number, deviceLifetimeDays: number): Promise<BrowserAuth>`; `BrowserAuth.deviceLifetimeDays: number` (readonly, the window a newly registered device receives); `ConnectionConfig.deviceLifetimeDays?: number` (schema `z.natural().min(1).max(365).default(30)`) replacing `deviceCookieMaxAgeDays`.

- [ ] **Step 1: Write the failing tests**

In `packages/client/connection/tests/browser-auth.host.spec.ts`, add the day constant under the imports:

```ts
const DAY_MILLISECONDS = 24 * 60 * 60 * 1000
```

replace the `createAuth` helper's fourth parameter name and default:

```ts
function createAuth(
  store: RecordCredentials,
  maxAgeDays = 30,
  processOwner: object = {},
  deviceLifetimeDays = 30,
): Promise<BrowserAuth> {
  return BrowserAuth.create(processOwner, credentials(store), maxAgeDays, deviceLifetimeDays)
}
```

replace the `deviceEntry` helper with a version that can carry a window:

```ts
/** One stored paired-device entry, as the browser-auth tests seed it. */
function deviceEntry(
  id: string,
  label = id,
  window?: { readonly lifetimeDays: number; readonly expiresAt: number },
): Record<string, unknown> {
  return {
    id,
    label,
    registeredAt: 1_700_000_000_000,
    lastSeenAt: 1_700_000_000_000,
    ...window ?? {},
  }
}
```

then replace the existing 'mints a v2 cookie bound to the authority and the configured device lifetime' and 'enforces the device lifetime of this activation' cases with these three:

```ts
    it('mints a v2 cookie bound to the authority and the registry window of its device', async () => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2026-09-12T12:00:00.000Z'))
      const store = new RecordCredentials()
      const expiresAt = Date.now() + 30 * DAY_MILLISECONDS
      store.setPairedDevices({
        version: 1,
        devices: [deviceEntry('phone-1', 'HUAWEI JAD-AL50', { lifetimeDays: 30, expiresAt })],
      })
      const auth = await createAuth(store)
      const setCookie = auth.issueDeviceCookie('192.168.0.126:3080', PHONE)

      expect(setCookie).toMatch(/; Max-Age=2592000; Path=\/; Expires=.*; HttpOnly; SameSite=Strict$/u)
      const pair = cookiePair(setCookie)
      expect(pair.startsWith('dsh-auth-')).toBe(true)
      expect(pair.split('=')[1]?.startsWith('v2.')).toBe(true)
      expect(auth.isAuthenticated(request('/', '192.168.0.126:3080', { cookie: pair }))).toBe(true)
      expect(auth.isAuthenticated(request('/', '192.168.0.127:3080', { cookie: pair }))).toBe(false)
      expect(auth.isAuthenticated(request('/', '192.168.0.126:3080', { cookie: `${pair}x` }))).toBe(false)
      expect(auth.isAuthenticated({ headers: { host: '192.168.0.126:3080' } })).toBe(false)

      vi.setSystemTime(expiresAt + 1)
      expect(auth.isAuthenticated(request('/', '192.168.0.126:3080', { cookie: pair }))).toBe(false)
    })

    it('gives a device the registry does not hold the configured default window', async () => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2026-09-12T12:00:00.000Z'))
      const auth = await createAuth(new RecordCredentials(), 30, {}, 14)

      expect(auth.deviceLifetimeDays).toBe(14)
      expect(auth.issueDeviceCookie('127.0.0.1:3080', PHONE)).toMatch(/; Max-Age=1209600;/u)
    })

    it('takes the registry window as the authority and shortens on the next request', async () => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2026-08-24T00:00:00.000Z'))
      const store = new RecordCredentials()
      store.setPairedDevices({
        version: 1,
        devices: [deviceEntry('phone-1', 'phone-1', {
          lifetimeDays: 30,
          expiresAt: Date.parse('2026-09-23T00:00:00.000Z'),
        })],
      })
      const auth = await createAuth(store)
      const cookie = cookiePair(auth.issueDeviceCookie('127.0.0.1:3080', PHONE))
      expect(auth.isAuthenticated(request('/', '127.0.0.1:3080', { cookie }))).toBe(true)

      store.setPairedDevices({
        version: 1,
        devices: [deviceEntry('phone-1', 'phone-1', {
          lifetimeDays: 1,
          expiresAt: Date.parse('2026-08-25T00:00:00.000Z'),
        })],
      })
      await auth.refreshPairedDevices()
      vi.setSystemTime(new Date('2026-08-25T00:00:01.000Z'))
      expect(auth.isAuthenticated(request('/', '127.0.0.1:3080', { cookie }))).toBe(false)
    })

    it('keeps a legacy entry on the expiry its cookie payload carries', async () => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2026-08-24T00:00:00.000Z'))
      const store = new RecordCredentials()
      store.setPairedDevices({ version: 1, devices: [deviceEntry('phone-1')] })
      const auth = await createAuth(store, 30, {}, 180)
      const cookie = cookiePair(auth.issueDeviceCookie('127.0.0.1:3080', PHONE))

      vi.setSystemTime(new Date('2027-02-01T00:00:00.000Z'))
      expect(auth.isAuthenticated(request('/', '127.0.0.1:3080', { cookie }))).toBe(true)
      vi.setSystemTime(new Date('2027-02-21T00:00:00.000Z'))
      expect(auth.isAuthenticated(request('/', '127.0.0.1:3080', { cookie }))).toBe(false)
    })
```

In `packages/client/connection/tests/devices.host.spec.ts`, give `registerDevice` its window argument in the registration case:

```ts
    const first = await registerDevice(credentials(store), { label: 'HUAWEI JAD-AL50' }, 30)
    vi.setSystemTime(new Date('2026-09-12T10:05:00.000Z'))
    const second = await registerDevice(credentials(store), { label: 'iPad' }, 7)
```

and assert the written window there, right after the existing `expect(first).toEqual({...})`:

```ts
    expect(first.lifetimeDays).toBe(30)
    expect(first.expiresAt).toBe(Date.parse('2026-09-12T10:00:00.000Z') + 30 * 24 * 60 * 60 * 1000)
    expect(second.lifetimeDays).toBe(7)
```

and in 'fails loud instead of overwriting a registry it cannot read':

```ts
    await expect(registerDevice(provider, { label: 'phone' }, 30)).rejects.toThrow(/paired-devices/u)
```

In `packages/client/connection/tests/node-half.host.spec.ts`, extend the `../src/index.ts` import with `Config`, then add these two cases at the end of `describe('connection device registry handle')`:

```ts
  it('gives a newly registered device the configured default window', async () => {
    const fallback = await mounted()
    try {
      const device = await fallback.connection.devices.register({ label: 'HUAWEI JAD-AL50' })
      expect(device.lifetimeDays).toBe(30)
      expect(device.expiresAt).toBeGreaterThan(Date.now())
    } finally {
      await fallback.dispose()
    }

    const configured = await mounted({ deviceLifetimeDays: 60 })
    try {
      const device = await configured.connection.devices.register({ label: 'HUAWEI JAD-AL50' })
      expect(device.lifetimeDays).toBe(60)
      const [listed] = await configured.connection.devices.list()
      expect(listed).toEqual(device)
    } finally {
      await configured.dispose()
    }
  })

  it('resolves the 30-day device lifetime default and refuses a window outside 1–365 days', () => {
    expect(Config({}).deviceLifetimeDays).toBe(30)
    expect(() => Config({ deviceLifetimeDays: 0 })).toThrow()
    expect(() => Config({ deviceLifetimeDays: 366 })).toThrow()
    expect(Config({ deviceLifetimeDays: 365 }).deviceLifetimeDays).toBe(365)
  })
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm exec vitest run packages/client/connection/tests/browser-auth.host.spec.ts packages/client/connection/tests/devices.host.spec.ts packages/client/connection/tests/node-half.host.spec.ts`

Expected: FAIL — the registry-window cookie case gets `Max-Age=15552000` (the 180-day policy) instead of `2592000`, `auth.deviceLifetimeDays` is `undefined`, the shortening case still authenticates, `registerDevice` drops its third argument, `device.lifetimeDays` is `undefined`, and `Config({}).deviceLifetimeDays` is `undefined` while `Config({deviceLifetimeDays: 0})` resolves.

- [ ] **Step 3: Write the registry window at registration**

In `packages/client/connection/src/devices.ts`, replace `registerDevice` with:

```ts
/**
 * Register a newly approved device and mint its opaque id.
 * @param credentials - persistent credential provider for the Web profile.
 * @param request - the label the operator approved the device under.
 * @param lifetimeDays - delivery window in days this device starts with.
 * @returns the stored device entry.
 */
export async function registerDevice(
  credentials: CredentialProvider,
  request: RegisterDeviceRequest,
  lifetimeDays: number,
): Promise<PairedDevice> {
  const now = Date.now()
  const device: PairedDevice = {
    id: PairedDeviceId(randomBytes(DEVICE_ID_BYTES).toString('base64url')),
    label: request.label,
    registeredAt: now,
    lastSeenAt: now,
    lifetimeDays,
    expiresAt: now + lifetimeDays * DAY_MILLISECONDS,
  }
  await writeDevices(credentials, devices => [...devices, device])
  return device
}
```

In `packages/client/connection/src/rpc-host.ts`, pass the configured window in `devices.register`:

```ts
      register: async (request) => {
        const device = await registerDevice(credentials, request, this.browserAuth.deviceLifetimeDays)
        await this.browserAuth.refreshPairedDevices()
        return device
      },
```

- [ ] **Step 4: Make the registry the authority in `BrowserAuth`**

In `packages/client/connection/src/browser-auth.ts`, change the imports to:

```ts
import { PairedDeviceId } from './device-brand.ts'
import { listDevices } from './devices.ts'
import type { PairedDevice } from './device-types.ts'
```

replace the `BrowserCookiePayload` interface with the discriminated union:

```ts
interface LaunchCookiePayload {
  readonly version: typeof COOKIE_PAYLOAD_VERSION
  readonly authority: string
  readonly issuedAt: number
  readonly expiresAt: number
}

interface DeviceCookiePayload {
  readonly version: typeof DEVICE_COOKIE_PAYLOAD_VERSION
  readonly authority: string
  readonly issuedAt: number
  readonly expiresAt: number
  /** Registry id of the device this cookie authenticates. */
  readonly deviceId: PairedDeviceId
}

/** Signed payload of either cookie form this Host issues. */
type BrowserCookiePayload = LaunchCookiePayload | DeviceCookiePayload

/** Index one device list by the id its cookie carries. */
function devicesById(devices: readonly PairedDevice[]): ReadonlyMap<PairedDeviceId, PairedDevice> {
  return new Map(devices.map(device => [device.id, device]))
}
```

replace the tail of `decodeCookie` (from the `if (!isRecord(decoded)` check) with a version-discriminated construction:

```ts
  if (!isRecord(decoded)
    || decoded.version !== version
    || typeof decoded.authority !== 'string'
    || !Number.isSafeInteger(decoded.issuedAt)
    || !Number.isSafeInteger(decoded.expiresAt)) return undefined
  const authority = decoded.authority
  const issuedAt = decoded.issuedAt as number
  const expiresAt = decoded.expiresAt as number
  if (version === DEVICE_COOKIE_PAYLOAD_VERSION) {
    if (typeof decoded.deviceId !== 'string' || decoded.deviceId === '') return undefined
    return {
      version: DEVICE_COOKIE_PAYLOAD_VERSION,
      authority,
      deviceId: PairedDeviceId(decoded.deviceId),
      issuedAt,
      expiresAt,
    }
  }
  return { version: COOKIE_PAYLOAD_VERSION, authority, issuedAt, expiresAt }
```

replace the class fields, constructor, and `create` with:

```ts
export class BrowserAuth {
  private readonly launchToken: string
  private readonly maxAgeMilliseconds: number
  /**
   * Window in days a newly registered device receives. A device whose registry
   * entry carries no `expiresAt` — a legacy entry, or one this activation does
   * not hold yet — mints its cookie with this window.
   */
  readonly deviceLifetimeDays: number
  private pairedDevices: ReadonlyMap<PairedDeviceId, PairedDevice>

  private constructor(
    processOwner: object,
    private readonly credentials: CredentialProvider,
    private readonly secret: Buffer,
    maxAgeDays: number,
    deviceLifetimeDays: number,
    pairedDevices: ReadonlyMap<PairedDeviceId, PairedDevice>,
  ) {
    this.launchToken = processLaunchToken(processOwner)
    this.maxAgeMilliseconds = maxAgeDays * DAY_MILLISECONDS
    this.deviceLifetimeDays = deviceLifetimeDays
    this.pairedDevices = pairedDevices
    for (const milliseconds of [this.maxAgeMilliseconds, deviceLifetimeDays * DAY_MILLISECONDS]) {
      if (!Number.isSafeInteger(milliseconds) || !Number.isSafeInteger(Date.now() + milliseconds)) {
        throw new Error('client-connection: cookie lifetimes exceed the safe timestamp range')
      }
    }
  }

  /**
   * Initialize browser authentication, create its durable signing secret when
   * this Harness home has none, and load the paired-device registry.
   * @param processOwner - root application context retaining one token across Connection reloads.
   * @param credentials - persistent credential provider for the Web profile.
   * @param maxAgeDays - positive absolute launch-token cookie lifetime in days.
   * @param deviceLifetimeDays - window in days a newly registered device receives.
   * @returns initialized authentication owner with the process owner's launch token.
   */
  static async create(
    processOwner: object,
    credentials: CredentialProvider,
    maxAgeDays: number,
    deviceLifetimeDays: number,
  ): Promise<BrowserAuth> {
    const secret = await initializeSecret(credentials)
    return new BrowserAuth(
      processOwner,
      credentials,
      secret,
      maxAgeDays,
      deviceLifetimeDays,
      devicesById(await listDevices(credentials)),
    )
  }
```

replace `issueDeviceCookie` and `refreshPairedDevices` with:

```ts
  /**
   * Mint the cookie a phone receives once its pairing request is approved. The
   * cookie expires with the registry window of that device; a device whose entry
   * carries no window gets the configured default.
   * @param authority - canonical `host:port` the cookie is bound to.
   * @param deviceId - registry id of the approved device.
   * @returns the complete `Set-Cookie` value.
   */
  issueDeviceCookie(authority: string, deviceId: PairedDeviceId): string {
    const issuedAt = Date.now()
    return this.mintDeviceCookie(authority, deviceId, issuedAt, this.deviceWindowEnd(deviceId, issuedAt))
  }

  /**
   * Re-read the paired-device registry, so a registration, revocation, or
   * re-scheduled window reaches the request path without restarting the Host.
   * @returns nothing; the refreshed registry is installed before it resolves.
   */
  async refreshPairedDevices(): Promise<void> {
    this.pairedDevices = devicesById(await listDevices(this.credentials))
  }

  /** End of one device's delivery window, defaulting for a device whose entry carries none. */
  private deviceWindowEnd(deviceId: PairedDeviceId, issuedAt: number): number {
    return this.pairedDevices.get(deviceId)?.expiresAt
      ?? issuedAt + this.deviceLifetimeDays * DAY_MILLISECONDS
  }

  /** One device-cookie `Set-Cookie` value whose payload and attributes end at `expiresAt`. */
  private mintDeviceCookie(
    authority: string,
    deviceId: PairedDeviceId,
    issuedAt: number,
    expiresAt: number,
  ): string {
    const value = encodeCookie({
      version: DEVICE_COOKIE_PAYLOAD_VERSION,
      authority,
      deviceId,
      issuedAt,
      expiresAt,
    }, this.secret)
    return sessionCookie(
      cookieName(authority), value, expiresAt, Math.max(0, Math.floor((expiresAt - issuedAt) / 1000)),
    )
  }

  /** The decoded payload of the authority-bound cookie this request carries, when it has one. */
  private cookiePayload(request: ConnectionTrustRequest): BrowserCookiePayload | undefined {
    const authority = requestAuthority(request.headers)
    const rawCookie = header(request.headers, 'cookie')
    if (authority === undefined || rawCookie === undefined) return undefined
    const value = cookieValue(rawCookie, cookieName(authority))
    if (value === undefined) return undefined
    const payload = decodeCookie(value, this.secret)
    if (payload === undefined || payload.authority !== authority) return undefined
    return payload
  }
```

replace `isAuthenticated` and add `accepts` after it:

```ts
  /**
   * Verify the authority-bound browser cookie on a Host request. A device cookie
   * must name a device the registry still holds, on the authority it was issued
   * for, and counts only until that device's window ends — the registry's
   * `expiresAt` when the entry carries one, otherwise the expiry the payload
   * carries; a launch-token cookie is the computer's own and counts only on a
   * loopback authority, so revoking a device is the whole story for every phone.
   * @param request - request headers carrying Host and Cookie.
   * @returns true only for a cookie this activation still accepts.
   */
  isAuthenticated(request: ConnectionTrustRequest): boolean {
    const payload = this.cookiePayload(request)
    return payload !== undefined && this.accepts(payload, request)
  }

  /** Whether one decoded cookie payload is still inside its lifetime for this request. */
  private accepts(payload: BrowserCookiePayload, request: ConnectionTrustRequest): boolean {
    const now = Date.now()
    if (!(payload.issuedAt <= now
      && payload.expiresAt > now
      && payload.expiresAt > payload.issuedAt)) return false
    if (payload.version === DEVICE_COOKIE_PAYLOAD_VERSION) {
      const device = this.pairedDevices.get(payload.deviceId)
      return device !== undefined && now < (device.expiresAt ?? payload.expiresAt)
    }
    const hostname = requestHostname(request.headers)
    return hostname !== undefined && isLoopbackHostname(hostname)
      && payload.expiresAt - payload.issuedAt <= this.maxAgeMilliseconds
  }
```

- [ ] **Step 5: Replace the config field**

In `packages/client/connection/src/index.ts`, replace the `deviceCookieMaxAgeDays` declaration in `ConnectionConfig` with:

```ts
  /**
   * Delivery window in days a newly registered device receives. Each paired
   * device's own window is set in the Connect-phone panel and stored in the
   * `client-connection/paired-devices` record; this value only decides what a
   * device starts with. Integer 1–365; there is no never-expires option.
   * Default: 30.
   */
  deviceLifetimeDays?: number
```

replace the schema line with:

```ts
  deviceLifetimeDays: z.natural().min(1).max(365).default(30),
```

and in `apply` replace the resolution and the `BrowserAuth.create` call with:

```ts
  const deviceLifetimeDays = config?.deviceLifetimeDays ?? 30
```

```ts
    await BrowserAuth.create(ctx.root, ctx.credentials, cookieMaxAgeDays, deviceLifetimeDays),
```

- [ ] **Step 6: Regenerate the config catalog and its pairing record**

Run: `pnpm run gen-config-catalog`

Expected: `docs/config-catalog.md` loses the `deviceCookieMaxAgeDays` block and gains the `deviceLifetimeDays` block in the `@deepseek-ai/dsh-client-connection` section.

Edit `docs/config-catalog.zh.md` by hand so the same section's `ts config-catalog` block matches the regenerated English block exactly (the fenced declaration is identical in both languages; only the surrounding prose differs), then run:

```bash
pnpm run verify-translation-pairing --write docs/config-catalog.md
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `pnpm exec vitest run packages/client/connection/tests/browser-auth.host.spec.ts packages/client/connection/tests/devices.host.spec.ts packages/client/connection/tests/node-half.host.spec.ts`

Expected: PASS — every case green, including the two new `node-half` cases.

- [ ] **Step 8: Typecheck the changed package faces**

Run: `pnpm run typecheck`

Expected: PASS — `deviceCookieMaxAgeDays` no longer appears anywhere in `packages/client/connection/src`.

- [ ] **Step 9: Commit**

```bash
git add packages/client/connection/src packages/client/connection/tests docs/config-catalog.md docs/config-catalog.zh.md docs/config-catalog.i18n.yaml
git commit -m "feat(client-connection): make the paired-device registry the lifetime authority"
```

### Task 4: Refresh an aligned device cookie on index requests

**Files:**
- Modify: `packages/client/connection/src/browser-auth.ts`
- Modify: `packages/client/connection/src/rpc.ts`
- Test: `packages/client/connection/tests/browser-auth.host.spec.ts`
- Test: `packages/api/gateway/tests/gateway.host.spec.ts`
- Test: `packages/api/gateway/tests/gateway-stream.host.spec.ts`

**Interfaces:**
- Consumes: `BrowserAuth.cookiePayload`, `BrowserAuth.accepts`, `mintDeviceCookie`, `deviceWindowEnd`, `DeviceCookiePayload` from Task 3.
- Produces: `ConnectionIndexResponse.setHeader(name: string, value: string): unknown`, which `authorizeIndex` uses to stage the replacement `Set-Cookie` alongside a `serve` verdict.

- [ ] **Step 1: Write the failing tests**

In `packages/client/connection/tests/browser-auth.host.spec.ts`, replace the `response()` helper with a recorder that also stages headers, the way node merges them into `writeHead`:

```ts
function response(): { value: ConnectionIndexResponse; state: ResponseState } {
  const state: ResponseState = {}
  return {
    value: {
      setHeader(name, value) {
        state.headers = { ...state.headers, [name]: value }
      },
      writeHead(status, headers) {
        state.status = status
        state.headers = { ...state.headers, ...headers }
      },
      end(body) {
        if (body !== undefined) state.body = body
      },
    },
    state,
  }
}
```

then add these two cases at the end of `describe('device cookies')`:

```ts
    it('refreshes an aligned cookie on the index request that follows an extension', async () => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2026-09-12T12:00:00.000Z'))
      const authority = '192.168.0.126:3080'
      const store = new RecordCredentials()
      store.setPairedDevices({
        version: 1,
        devices: [deviceEntry('phone-1', 'phone-1', {
          lifetimeDays: 30,
          expiresAt: Date.now() + 30 * DAY_MILLISECONDS,
        })],
      })
      const auth = await createAuth(store)
      const cookie = cookiePair(auth.issueDeviceCookie(authority, PHONE))

      // The operator extends this device's window on the computer.
      store.setPairedDevices({
        version: 1,
        devices: [deviceEntry('phone-1', 'phone-1', {
          lifetimeDays: 60,
          expiresAt: Date.now() + 60 * DAY_MILLISECONDS,
        })],
      })
      await auth.refreshPairedDevices()

      const served = response()
      expect(auth.authorizeIndex(request('/', authority, { cookie }), served.value)).toBe('serve')
      const refreshed = served.state.headers?.['set-cookie']
      expect(refreshed).toMatch(/; Max-Age=5184000; Path=\/; Expires=.*; HttpOnly; SameSite=Strict$/u)

      // Until the phone loads the page, /api stays bounded by the old payload;
      // the refreshed cookie carries the extended window from then on.
      vi.setSystemTime(Date.now() + 31 * DAY_MILLISECONDS)
      expect(auth.isAuthenticated(request('/', authority, { cookie }))).toBe(false)
      expect(auth.isAuthenticated(request('/', authority, { cookie: cookiePair(refreshed!) }))).toBe(true)

      // An already-aligned cookie is not re-issued.
      const again = response()
      expect(auth.authorizeIndex(
        request('/', authority, { cookie: cookiePair(refreshed!) }),
        again.value,
      )).toBe('serve')
      expect(again.state).toEqual({})
    })

    it('stages no refresh for an index request whose device cookie is refused', async () => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2026-09-12T12:00:00.000Z'))
      const store = new RecordCredentials()
      store.setPairedDevices({
        version: 1,
        devices: [deviceEntry('phone-1', 'phone-1', {
          lifetimeDays: 1,
          expiresAt: Date.now() + DAY_MILLISECONDS,
        })],
      })
      const auth = await createAuth(store)
      const cookie = cookiePair(auth.issueDeviceCookie('127.0.0.1:3080', PHONE))

      vi.setSystemTime(Date.now() + 2 * DAY_MILLISECONDS)
      const refused = response()
      expect(auth.authorizeIndex(request('/', '127.0.0.1:3080', { cookie }), refused.value)).toBe('answered')
      expect(refused.state.status).toBe(401)
      expect(refused.state.headers?.['set-cookie']).toBeUndefined()
    })
```

In `packages/api/gateway/tests/gateway.host.spec.ts` and `packages/api/gateway/tests/gateway-stream.host.spec.ts`, give each hand-built `ConnectionIndexResponse` literal the new member (it sits beside `writeHead`):

```ts
  }, {
    setHeader() {},
    writeHead(_status, headers) { setCookie = headers?.['set-cookie'] },
    end() {},
  })
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm exec vitest run packages/client/connection/tests/browser-auth.host.spec.ts`

Expected: FAIL — the extension case gets `'serve'` but `state.headers` holds no `set-cookie`, so `refreshed` is `undefined` and `toMatch` throws on it.

- [ ] **Step 3: Add the staging member to the response interface**

In `packages/client/connection/src/rpc.ts`, replace `ConnectionIndexResponse` with:

```ts
/** Root/index response operations owned by the browser-token exchange. */
export interface ConnectionIndexResponse {
  /**
   * Stage a header written with the caller's status, such as the replacement
   * `Set-Cookie` that aligns a device cookie with its registry window.
   * @param name - header name.
   * @param value - header value.
   */
  setHeader(name: string, value: string): unknown
  writeHead(status: number, headers?: Readonly<Record<string, string>>): unknown
  end(body?: string): unknown
}
```

- [ ] **Step 4: Refresh on the index path**

In `packages/client/connection/src/browser-auth.ts`, replace the no-token tail of `authorizeIndex` (the `if (this.isAuthenticated(req)) return 'serve'` line) with:

```ts
    if (this.authorizeIndexCookie(req, res)) return 'serve'
    return this.refuseIndex(req, res)
```

and add these two methods after `isAuthenticated`:

```ts
  /**
   * Authenticate one index request and stage the aligned device cookie when the
   * registry window outlives the payload's expiry. Only an index request
   * refreshes, so ordinary `/api` calls never renew a device cookie.
   */
  private authorizeIndexCookie(req: ConnectionIndexRequest, res: ConnectionIndexResponse): boolean {
    const payload = this.cookiePayload(req)
    if (payload === undefined || !this.accepts(payload, req)) return false
    if (payload.version === DEVICE_COOKIE_PAYLOAD_VERSION) this.refreshDeviceCookie(payload, res)
    return true
  }

  /** Stage the replacement cookie for a device cookie whose payload lags its registry window. */
  private refreshDeviceCookie(payload: DeviceCookiePayload, res: ConnectionIndexResponse): void {
    const issuedAt = Date.now()
    const expiresAt = this.pairedDevices.get(payload.deviceId)?.expiresAt
    if (expiresAt === undefined || expiresAt <= payload.expiresAt) return
    res.setHeader('set-cookie', this.mintDeviceCookie(payload.authority, payload.deviceId, issuedAt, expiresAt))
  }
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm exec vitest run packages/client/connection/tests/browser-auth.host.spec.ts packages/api/gateway/tests/gateway.host.spec.ts packages/api/gateway/tests/gateway-stream.host.spec.ts`

Expected: PASS — the refresh case sees `Max-Age=5184000`, the refused case stages nothing, and both gateway suites compile and pass with their staged-header stub.

- [ ] **Step 6: Commit**

```bash
git add packages/client/connection/src/browser-auth.ts packages/client/connection/src/rpc.ts packages/client/connection/tests/browser-auth.host.spec.ts packages/api/gateway/tests/gateway.host.spec.ts packages/api/gateway/tests/gateway-stream.host.spec.ts
git commit -m "feat(client-connection): refresh a device cookie on index requests"
```

### Task 5: The `/pair/devices/lifetime` route

**Files:**
- Modify: `packages/client/connection/src/rpc.ts`
- Modify: `packages/client/connection/src/rpc-host.ts`
- Modify: `packages/bundle/mob/src/routes.ts`
- Test: `packages/bundle/mob/tests/routes.host.spec.ts`
- Test: `apps/cli/tests/pairing.e2e.ts`

**Interfaces:**
- Consumes: `setDeviceLifetime` from Task 2, `BrowserAuth.refreshPairedDevices` from Task 3, the `refused(req, res, ctx, 'loopback')` guard and `readJsonBody`/`sendJson` in `routes.ts`, and the `/pair/revoke` route as the shape to mirror.
- Produces: `HostConnectionDevices.setLifetime(deviceId: PairedDeviceId, days: number): Promise<boolean>`; `PAIR_PATHS.lifetime === '/pair/devices/lifetime'`; `GET /pair/devices` answers each device with its stored `lifetimeDays` and `expiresAt`.

- [ ] **Step 1: Write the failing tests**

In `packages/bundle/mob/tests/routes.host.spec.ts`, extend the `Bench` interface and the `bench()` fixture. Add to `Bench`:

```ts
  /** Per-device windows the route tests set through `/pair/devices/lifetime`. */
  readonly windows: ReadonlyMap<string, { readonly lifetimeDays: number; readonly expiresAt: number }>
```

add beside the other fixture arrays inside `bench()`:

```ts
  const windows = new Map<string, { lifetimeDays: number; expiresAt: number }>()
```

replace the fake `list` and add `setLifetime` in `ctx.provide('connection', {...})`:

```ts
      list: async () => registered.map((request, index) => {
        const id = `device-${String(index + 1)}`
        return { id, label: request.label, registeredAt: 1, lastSeenAt: 1, ...windows.get(id) ?? {} }
      }),
```

```ts
      setLifetime: async (deviceId: string, days: number) => {
        const known = registered.some((_request, index) => `device-${String(index + 1)}` === deviceId)
        if (!known) return false
        windows.set(deviceId, { lifetimeDays: days, expiresAt: days * 86_400_000 })
        return true
      },
```

return `windows` from `bench()`, and add `setLifetime: async () => true` to the inline `connection.devices` fake in the 'registers one route per handshake step' case. Then add this case before the closing `})` of `describe('pairing routes')`:

```ts
  it('re-schedules one device under the loopback-and-session guard within 1–365 days', async () => {
    const subject = bench()
    const { code } = subject.pairing.openSession()
    await approve(subject, code)

    const accepted = await subject.call(PAIR_PATHS.lifetime, {
      method: 'POST',
      cookie: 'dsh-auth-test=session',
      body: { deviceId: 'device-1', days: 7 },
    })
    expect(accepted.status).toBe(200)
    expect(JSON.parse(accepted.body)).toEqual({ ok: true })
    expect(JSON.parse((await subject.call(PAIR_PATHS.devices)).body)).toEqual({
      devices: [{
        id: 'device-1',
        label: 'HUAWEI JAD-AL50',
        registeredAt: 1,
        lastSeenAt: 1,
        lifetimeDays: 7,
        expiresAt: 7 * 86_400_000,
      }],
    })

    for (const body of [
      { deviceId: 'device-1', days: 0 },
      { deviceId: 'device-1', days: 366 },
      { deviceId: 'device-1', days: 1.5 },
      { deviceId: 'device-1', days: '30' },
      { deviceId: 'device-1' },
      { days: 7 },
    ]) {
      const rejected = await subject.call(PAIR_PATHS.lifetime, {
        method: 'POST',
        cookie: 'dsh-auth-test=session',
        body,
      })
      expect(rejected.status).toBe(400)
    }
    expect(subject.windows.get('device-1')).toEqual({ lifetimeDays: 7, expiresAt: 7 * 86_400_000 })

    const unknown = await subject.call(PAIR_PATHS.lifetime, {
      method: 'POST',
      cookie: 'dsh-auth-test=session',
      body: { deviceId: 'ghost', days: 7 },
    })
    expect(unknown.status).toBe(200)
    expect(JSON.parse(unknown.body)).toEqual({ ok: false })

    expect((await subject.call(PAIR_PATHS.lifetime, { method: 'GET' })).status).toBe(405)
    const remote = bench({ rejection: 401 })
    expect((await remote.call(PAIR_PATHS.lifetime, { method: 'POST' })).status).toBe(401)
    const lan = bench({ loopback: false })
    expect((await lan.call(PAIR_PATHS.lifetime, {
      method: 'POST',
      body: { deviceId: 'device-1', days: 7 },
    })).status).toBe(403)
  })
```

In `apps/cli/tests/pairing.e2e.ts`, add the new route to the phone's refused-decision list, after the `/pair/devices` entry:

```ts
        { path: '/pair/devices/lifetime', method: 'POST', body: JSON.stringify({ deviceId: 'x', days: 7 }) },
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm exec vitest run packages/bundle/mob/tests/routes.host.spec.ts`

Expected: FAIL — `PAIR_PATHS.lifetime` is `undefined`, so `subject.call` throws `no route registered for undefined`.

- [ ] **Step 3: Extend the Host handle**

In `packages/client/connection/src/rpc.ts`, add to `HostConnectionDevices` after `revoke`:

```ts
  /**
   * Set one device's delivery window, restarting its countdown.
   * @param deviceId - id of the device to re-schedule.
   * @param days - window in days, an integer from 1 to 365.
   * @returns true when a stored device was re-scheduled.
   */
  setLifetime(deviceId: PairedDeviceId, days: number): Promise<boolean>
```

In `packages/client/connection/src/rpc-host.ts`, extend the `./devices.ts` import with `setDeviceLifetime`, then add the implementation after `revoke` inside the `devices` getter:

```ts
      setLifetime: async (deviceId, days) => {
        const updated = await setDeviceLifetime(credentials, deviceId, days)
        if (updated) await this.browserAuth.refreshPairedDevices()
        return updated
      },
```

- [ ] **Step 4: Register the route**

In `packages/bundle/mob/src/routes.ts`, add the two bounds beside `PAIR_BODY_LIMIT_BYTES`:

```ts
/** Legal per-device lifetime in days, matching the Connection config schema. */
const MIN_DEVICE_LIFETIME_DAYS = 1
const MAX_DEVICE_LIFETIME_DAYS = 365
```

add the path to `PAIR_PATHS` after `devices`:

```ts
  lifetime: '/pair/devices/lifetime',
```

update the registration JSDoc to `Register the eight pairing routes on the Host web server.`, and register the eighth route after the `PAIR_PATHS.devices` route:

```ts
    ctx.webServer.register({
      kind: 'exact',
      path: PAIR_PATHS.lifetime,
      handler: async (req, res) => {
        if (req.method !== 'POST') {
          sendMethodNotAllowed(res, 'POST')
          return
        }
        if (refused(req, res, ctx, 'loopback')) return
        const body = await readJsonBody(req)
        const { deviceId, days } = body ?? {}
        if (typeof deviceId !== 'string' || typeof days !== 'number'
          || !Number.isSafeInteger(days) || days < MIN_DEVICE_LIFETIME_DAYS || days > MAX_DEVICE_LIFETIME_DAYS) {
          sendJson(res, 400, { error: 'expected a device id and a lifetime of 1 to 365 days' })
          return
        }
        // Wire boundary: the body carries the id as JSON text, and this is where
        // the validated string earns the registry's brand.
        const target = deviceId as PairedDeviceId
        sendJson(res, 200, { ok: await ctx.connection.devices.setLifetime(target, days) })
      },
    }),
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm exec vitest run packages/bundle/mob/tests/routes.host.spec.ts`

Expected: PASS — the route-registration case now lists eight paths, the new case is green, and the `/pair/devices` payload carries `lifetimeDays` and `expiresAt`.

- [ ] **Step 6: Run the real-CLI guard case**

Run: `pnpm exec vitest run --config vitest.e2e.config.ts apps/cli/tests/pairing.e2e.ts`

Expected: PASS — a paired phone is refused 403 on `/pair/devices/lifetime` like every other decision route.

- [ ] **Step 7: Commit**

```bash
git add packages/client/connection/src/rpc.ts packages/client/connection/src/rpc-host.ts packages/bundle/mob/src/routes.ts packages/bundle/mob/tests/routes.host.spec.ts apps/cli/tests/pairing.e2e.ts
git commit -m "feat(mob): add the per-device lifetime route"
```

### Task 6: The panel's lifetime column, presets, and revoke guidance

**Files:**
- Modify: `packages/bundle/mob/src/client/pairing-api.ts`
- Modify: `packages/bundle/mob/src/client/locales.ts`
- Modify: `packages/bundle/mob/src/client/PairingPanel.tsx`
- Test: `packages/bundle/mob/tests/pairing-api.client.spec.ts`
- Test: `packages/bundle/mob/tests/panel.client.spec.tsx`
- Test: `packages/bundle/mob/tests/row.client.spec.tsx`

**Interfaces:**
- Consumes: the `/pair/devices/lifetime` route and the `/pair/devices` payload from Task 5.
- Produces: `PairedDeviceView.lifetimeDays?: number` and `PairedDeviceView.expiresAt?: number`; `PairingApi.setLifetime(deviceId: string, days: number): Promise<PairingResult<void>>`; the `settings.mobile` keys `panel.lifetimeUnknown`, `panel.lifetimeExpired`, `panel.lifetimeWindow`, `panel.lifetimePreset`, `panel.lifetimeCustom`, `panel.lifetimeApply`, `panel.lifetimeNote`, `panel.revokeHint`.

- [ ] **Step 1: Write the failing tests**

In `packages/bundle/mob/tests/pairing-api.client.spec.ts`, replace the first `stub` and expectation of 'lists devices and rejects entries it cannot read' with:

```ts
    stub(json({ devices: [
      { id: 'device-1', label: 'iPad', registeredAt: 1, lastSeenAt: 2, lifetimeDays: 7, expiresAt: 3 },
      { id: 'device-2', label: '旧手机', registeredAt: 1, lastSeenAt: 2 },
    ] }))
    await expect(api.devices()).resolves.toEqual({
      ok: true,
      value: [
        { id: 'device-1', label: 'iPad', registeredAt: 1, lastSeenAt: 2, lifetimeDays: 7, expiresAt: 3 },
        { id: 'device-2', label: '旧手机', registeredAt: 1, lastSeenAt: 2, lifetimeDays: undefined, expiresAt: undefined },
      ],
    })
```

and add this case after 'revokes a device and reports a refusal the Host answered':

```ts
  it('sets one device lifetime and reports the Host answer', async () => {
    const fetchMock = stub(json({ ok: true }))
    await expect(createPairingApi().setLifetime('device-1', 7)).resolves.toEqual({ ok: true, value: undefined })
    expect(fetchMock).toHaveBeenCalledWith('/pair/devices/lifetime', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { accept: 'application/json', 'content-type': 'application/json' },
      body: JSON.stringify({ deviceId: 'device-1', days: 7 }),
    })

    stub(json({ ok: false }))
    await expect(createPairingApi().setLifetime('device-1', 7)).resolves.toEqual({ ok: false, reason: 'failed' })

    stub(json({ error: 'no' }, 403))
    await expect(createPairingApi().setLifetime('device-1', 7)).resolves.toEqual({ ok: false, reason: 'forbidden' })
  })
```

In `packages/bundle/mob/tests/panel.client.spec.tsx`, add to `Script`:

```ts
  setLifetime?: PairingResult<void>
```

add to `FakeApi`:

```ts
  readonly setLifetime: ReturnType<typeof vi.fn>
```

add to `fakeApi` beside the other spies:

```ts
  const setLifetime = vi.fn(async (): Promise<PairingResult<void>> => script.setLifetime ?? { ok: true, value: undefined })
```

return it (`return { api: { open, requests, decide, devices, revoke, setLifetime }, open, requests, decide, devices, revoke, setLifetime }`), add the fixture constants under `START`:

```ts
const DAY_MILLISECONDS = 24 * 60 * 60 * 1000
/** A windowed device row: 30 days from `START`. */
const WINDOWED = {
  id: 'device-1',
  label: '客厅的手机',
  registeredAt: START,
  lastSeenAt: START,
  lifetimeDays: 30,
  expiresAt: START + 30 * DAY_MILLISECONDS,
} as const
```

and add these three cases:

```ts
  it('shows each device window, an expired device, and an unknown legacy entry', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(START))
    mount({ api: fakeApi({ devices: { ok: true, value: [
      WINDOWED,
      { id: 'device-2', label: 'iPad', registeredAt: START, lastSeenAt: START, lifetimeDays: 7, expiresAt: START - 1 },
      { id: 'device-3', label: '旧手机', registeredAt: START, lastSeenAt: START },
    ] } }) })

    const first = (await waitFor(() => screen.getAllByText('客厅的手机')))[0]!
    expect(within(first.closest('li')!).getByText(/30 天（剩余 30 天）/u)).toBeTruthy()
    await waitFor(() => { expect(within(screen.getByText('iPad').closest('li')!).getByText('已过期')).toBeTruthy() })
    expect(within(screen.getByText('旧手机').closest('li')!).getByText('—')).toBeTruthy()
  })

  it('re-schedules a device from a preset and from an arbitrary day count', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(START))
    const subject = mount({ api: fakeApi({ devices: { ok: true, value: [WINDOWED] } }) })

    const label = await waitFor(() => screen.getByText('客厅的手机'))
    const row = label.closest('li')!
    fireEvent.click(within(row).getByRole('button', { name: '7 天' }))
    await waitFor(() => { expect(subject.setLifetime).toHaveBeenCalledWith('device-1', 7) })

    const days = within(row).getByLabelText('天数') as HTMLInputElement
    fireEvent.change(days, { target: { value: '45' } })
    fireEvent.click(within(row).getByRole('button', { name: '设为' }))
    await waitFor(() => { expect(subject.setLifetime).toHaveBeenCalledWith('device-1', 45) })

    fireEvent.change(days, { target: { value: '366' } })
    expect((within(row).getByRole('button', { name: '设为' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.change(days, { target: { value: '0' } })
    expect((within(row).getByRole('button', { name: '设为' }) as HTMLButtonElement).disabled).toBe(true)
    expect(subject.setLifetime).toHaveBeenCalledTimes(2)
  })

  it('states the revoke guidance and reports a refused re-schedule', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(START))
    const subject = mount({ api: fakeApi({
      devices: { ok: true, value: [WINDOWED] },
      setLifetime: { ok: false, reason: 'failed' },
    }) })

    expect(screen.getByText('不再使用的设备请立即吊销；在不受信任的网络上用过之后也建议吊销。')).toBeTruthy()
    expect(screen.getByText('延长后，手机下一次打开页面时生效。')).toBeTruthy()

    const row = (await waitFor(() => screen.getByText('客厅的手机'))).closest('li')!
    fireEvent.click(within(row).getByRole('button', { name: '1 天' }))
    await waitFor(() => { expect(screen.getByRole('alert').textContent).toBe('操作失败，请重试。') })
    expect(screen.getByText('客厅的手机')).toBeTruthy()
  })
```

In `packages/bundle/mob/tests/row.client.spec.tsx`, add the new member to the `api` fixture:

```ts
  setLifetime: async () => ({ ok: true, value: undefined }),
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm exec vitest run packages/bundle/mob/tests/pairing-api.client.spec.ts packages/bundle/mob/tests/panel.client.spec.tsx`

Expected: FAIL — `createPairingApi().setLifetime` is not a function, the parsed device view carries no `lifetimeDays`/`expiresAt`, and the panel renders no lifetime text because the dictionary keys do not exist yet.

- [ ] **Step 3: Extend the route client**

In `packages/bundle/mob/src/client/pairing-api.ts`, extend `PairedDeviceView`:

```ts
  /** Days the operator set for this device's current window; absent on a legacy entry. */
  readonly lifetimeDays?: number
  /** Epoch milliseconds this device's window ends; absent on a legacy entry. */
  readonly expiresAt?: number
```

add to `PairingApi` after `revoke`:

```ts
  /** Set one device's delivery window, in days. */
  setLifetime(deviceId: string, days: number): Promise<PairingResult<void>>
```

replace `deviceOf` with:

```ts
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
```

and add the client half after `revoke` in the object `createPairingApi()` returns:

```ts
    async setLifetime(deviceId, days) {
      const answer = await call('/pair/devices/lifetime', { method: 'POST', body: { deviceId, days } })
      if (!answer.ok) return answer
      const ok = isRecord(answer.value) ? answer.value.ok : undefined
      return ok === true ? { ok: true, value: undefined } : { ok: false, reason: 'failed' }
    },
```

- [ ] **Step 4: Add the dictionary keys**

In `packages/bundle/mob/src/client/locales.ts`, add to the English dictionary after `'panel.revoke'`:

```ts
  'panel.lifetimeUnknown': '—',
  'panel.lifetimeExpired': 'Expired',
  'panel.lifetimeWindow': '{days} days ({remaining} days left)',
  'panel.lifetimePreset': '{days} d',
  'panel.lifetimeCustom': 'Days',
  'panel.lifetimeApply': 'Set lifetime',
  'panel.lifetimeNote': 'A longer window reaches the phone the next time it loads the page.',
  'panel.revokeHint': 'Revoke a device you no longer use; after using an untrusted network, revoke it too.',
```

and to the Chinese dictionary at the same position:

```ts
  'panel.lifetimeUnknown': '—',
  'panel.lifetimeExpired': '已过期',
  'panel.lifetimeWindow': '{days} 天（剩余 {remaining} 天）',
  'panel.lifetimePreset': '{days} 天',
  'panel.lifetimeCustom': '天数',
  'panel.lifetimeApply': '设为',
  'panel.lifetimeNote': '延长后，手机下一次打开页面时生效。',
  'panel.revokeHint': '不再使用的设备请立即吊销；在不受信任的网络上用过之后也建议吊销。',
```

- [ ] **Step 5: Render the column and the controls**

In `packages/bundle/mob/src/client/PairingPanel.tsx`, add the constants under `COUNTDOWN_TICK_MILLISECONDS`:

```ts
/** Day counts the lifetime controls offer as one-click presets. */
const LIFETIME_PRESETS = [1, 7, 30, 90] as const
/** Milliseconds in one day, for the remaining-days column. */
const DAY_MILLISECONDS = 24 * 60 * 60 * 1000
/** Legal device lifetime in days, matching the route's acceptance rule. */
const MIN_LIFETIME_DAYS = 1
const MAX_LIFETIME_DAYS = 365
```

add the input state beside the other `useState` calls:

```ts
  const [customDays, setCustomDays] = useState<Readonly<Record<string, string>>>({})
```

and add these three functions after the `revoke` function:

```ts
  /** Lifetime cell of one device row: its window, `expired`, or unknown for a legacy entry. */
  const lifetimeOf = (device: PairedDeviceView): string => {
    if (device.lifetimeDays === undefined || device.expiresAt === undefined) return t('panel.lifetimeUnknown')
    if (device.expiresAt <= now) return t('panel.lifetimeExpired')
    const remaining = Math.max(0, Math.ceil((device.expiresAt - now) / DAY_MILLISECONDS))
    return t('panel.lifetimeWindow', { days: device.lifetimeDays, remaining })
  }

  /** The day count typed for one device, when it is inside the legal range. */
  const customDaysOf = (deviceId: string): number | undefined => {
    const entered = customDays[deviceId]
    if (entered === undefined || entered.trim() === '') return undefined
    const days = Number(entered)
    return Number.isSafeInteger(days) && days >= MIN_LIFETIME_DAYS && days <= MAX_LIFETIME_DAYS ? days : undefined
  }

  const setLifetime = async (deviceId: string, days: number): Promise<void> => {
    const answer = await api.setLifetime(deviceId, days)
    if (!answer.ok) {
      setNotice('failed')
      return
    }
    const listed = await api.devices()
    if (listed.ok) setDevices(listed.value)
  }
```

add `lifetimeOf` to the device row's status line, so the block reads:

```tsx
                  <div className={css.device}>
                    <div className={css.deviceLabel}>{device.label}</div>
                    <div className={css.status}>
                      {t('panel.registered', { time: formatStamp(device.registeredAt) })}
                      {' · '}
                      {t('panel.lastSeen', { time: formatStamp(device.lastSeenAt) })}
                      {' · '}
                      {lifetimeOf(device)}
                    </div>
                  </div>
```

and add the controls before the revoke button in the same list item:

```tsx
                  <div className={css.actions}>
                    {LIFETIME_PRESETS.map(days => (
                      <button
                        key={days}
                        type="button"
                        className={css.action}
                        onClick={() => { void setLifetime(device.id, days) }}
                      >
                        {t('panel.lifetimePreset', { days })}
                      </button>
                    ))}
                    <label className={css.field}>
                      {t('panel.lifetimeCustom')}
                      <input
                        className={css.input}
                        type="number"
                        min={MIN_LIFETIME_DAYS}
                        max={MAX_LIFETIME_DAYS}
                        value={customDays[device.id] ?? ''}
                        onChange={(event) => {
                          const value = event.currentTarget.value
                          setCustomDays(current => ({ ...current, [device.id]: value }))
                        }}
                      />
                    </label>
                    <button
                      type="button"
                      className={css.action}
                      disabled={customDaysOf(device.id) === undefined}
                      onClick={() => {
                        const days = customDaysOf(device.id)
                        if (days !== undefined) void setLifetime(device.id, days)
                      }}
                    >
                      {t('panel.lifetimeApply')}
                    </button>
                  </div>
```

finally add the two guidance lines to the devices section, before its list:

```tsx
        <p className={css.status}>{t('panel.revokeHint')}</p>
        <p className={css.status}>{t('panel.lifetimeNote')}</p>
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `pnpm exec vitest run packages/bundle/mob/tests/pairing-api.client.spec.ts packages/bundle/mob/tests/panel.client.spec.tsx packages/bundle/mob/tests/row.client.spec.tsx`

Expected: PASS — the three new panel cases, the new client case, and the unchanged row case are green.

- [ ] **Step 7: Run the client-copy gate**

Run: `pnpm run verify-client-ui-i18n`

Expected: PASS — every new string is owned by the `settings.mobile` dictionary.

- [ ] **Step 8: Commit**

```bash
git add packages/bundle/mob/src/client packages/bundle/mob/tests
git commit -m "feat(mob): manage device lifetime in the pairing panel"
```

### Task 7: The LAN warning names the narrowing

**Files:**
- Modify: `packages/bundle/web-app/src/index.ts`
- Test: `packages/bundle/web-app/tests/web-app.spec.ts`

**Interfaces:**
- Consumes: the existing all-interfaces warning at the `console.error` call in `apply`.
- Produces: the same warning with one appended actionable sentence; the existing wording is kept verbatim.

- [ ] **Step 1: Update the pinned test**

In `packages/bundle/web-app/tests/web-app.spec.ts`, replace the expected string in 'warns on stderr when serving all interfaces, and stays silent on loopback' with:

```ts
    expect(diagnostic).toHaveBeenCalledWith('dsh web: WARNING: serving on all network interfaces over plain HTTP; anyone on this network who obtains the session cookie gains full control — use only on a trusted network; allow only the paired phone through the firewall, or pass --host 127.0.0.1 to serve this machine only')
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run packages/bundle/web-app/tests/web-app.spec.ts`

Expected: FAIL — `console.error` received the warning without the appended sentence.

- [ ] **Step 3: Append the mitigation**

In `packages/bundle/web-app/src/index.ts`, replace the warning call with:

```ts
    console.error('dsh web: WARNING: serving on all network interfaces over plain HTTP; anyone on this network who obtains the session cookie gains full control — use only on a trusted network; allow only the paired phone through the firewall, or pass --host 127.0.0.1 to serve this machine only')
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm exec vitest run packages/bundle/web-app/tests/web-app.spec.ts`

Expected: PASS — every case in the file green, including the loopback silence case.

- [ ] **Step 5: Commit**

```bash
git add packages/bundle/web-app/src/index.ts packages/bundle/web-app/tests/web-app.spec.ts
git commit -m "feat(web-app): name the narrowing in the LAN warning"
```

### Task 8: Document the firewall recipe and the lifetime facts

**Files:**
- Modify: `packages/bundle/web-app/README.md`
- Modify: `packages/bundle/web-app/README.zh.md`
- Modify: `packages/bundle/web-app/README.i18n.yaml`
- Modify: `packages/bundle/mob/README.md`
- Modify: `packages/bundle/mob/README.zh.md`
- Modify: `packages/bundle/mob/README.i18n.yaml`
- Modify: `packages/client/connection/README.md`
- Modify: `packages/client/connection/README.zh.md`
- Modify: `packages/client/connection/README.i18n.yaml`

**Interfaces:**
- Consumes: the config field and registry semantics from Task 3, the route from Task 5, the panel copy from Task 6, and the warning from Task 7.
- Produces: current-state prose in three bilingual package READMEs, each re-recorded in its `.i18n.yaml`.

- [ ] **Step 1: Write the English side**

In `packages/bundle/web-app/README.md`, append to the paragraph under `### LAN access and trusted hosts` (the one ending `restart the GUI to re-advertise.`):

```text
To admit one phone instead of the whole subnet, add a per-device firewall rule for the port you serve — on Windows, `netsh advfirewall firewall add rule name="dsh web phone" dir=in action=allow protocol=TCP localport=3080 remoteip=<phone-ip>` — and re-add it when the phone's DHCP address changes (`netsh advfirewall firewall delete rule name="dsh web phone"` removes the old rule). A paired phone holds a device cookie whose window the Connect-phone panel owns: a device starts at `deviceLifetimeDays` (30 by default, legal 1–365), the panel shows the days left and restarts that countdown when you set a new value, and revoking a device ends its access on the next request.
```

replace the bullet `- **LAN serving is plain HTTP, and it is the default** — …` with:

```markdown
- **LAN serving is plain HTTP, and it is the default** — every interface is bound unless `--host 127.0.0.1` is passed, and traffic stays unencrypted; a stolen device cookie grants full control until that device's window ends or you revoke it, so serve only on a trusted network and narrow the firewall to the phone you paired.
- **A per-device firewall rule follows the phone's address** — the recipe above admits one IP literal, so a phone whose DHCP lease changes needs the rule re-added, and a device you no longer use stays admitted to the port until you revoke it and delete the rule.
```

In `packages/bundle/mob/README.md`, append to the paragraph under `### Handing off from a desktop session` (the one ending `has one enforcement point.`):

```text
Each paired device row also carries its lifetime: `{days} days ({remaining} days left)`, `Expired` once the window has passed, or `—` for an entry that predates per-device lifetimes and still runs on the expiry its cookie carries. The row's `1`/`7`/`30`/`90` day presets and its arbitrary-days box restart that device's countdown, a shorter window applies to that phone's next request, and a longer one reaches the phone the next time it loads the page. A line above the list says to revoke a device you no longer use, and to revoke after using an untrusted network.
```

append to the paragraph under `### Pairing a phone` (the one ending `a phone on the LAN cannot approve itself.`):

```text
`POST /pair/devices/lifetime` carries `{deviceId, days}` and is the third computer-only decision route, so a phone cannot extend or shorten its own window or another device's; `GET /pair/devices` answers each device with its stored `lifetimeDays` and `expiresAt`, which is what the panel's lifetime column renders.
```

replace `the seven \`/pair*\` named routes` with `the eight \`/pair*\` named routes` in the `### Source map` intro paragraph of the same file.

In `packages/client/connection/README.md`, replace the tail of the browser-authentication paragraph — from `` with a lifetime of `deviceCookieMaxAgeDays` (default 180) fixed at issue time and never renewed by use. `` — with:

```text
whose window the registry decides instead: a newly registered device starts at `deviceLifetimeDays` (default 30, legal 1–365) and an entry that predates the lifetime fields keeps running on the expiry its payload carries. A device cookie is accepted while the current time is before that device's `expiresAt`, so a shortened window applies to the next request while a longer one reaches the phone on its next index request, which re-issues an aligned cookie; `/api` requests never renew anything.
```

and append to the paragraph beginning `` `src/devices.ts` owns that registry. ``:

```text
`setDeviceLifetime` writes one device's `lifetimeDays` together with the `expiresAt` it implies, so setting a window restarts that device's countdown.
```

- [ ] **Step 2: Run the documentation gates to see the pairs stale**

Run: `pnpm exec tsx scripts/verify-translation-pairing.ts`

Expected: FAIL — `packages/bundle/web-app/README.md`, `packages/bundle/mob/README.md`, and `packages/client/connection/README.md` report a hash mismatch against their recorded `.i18n.yaml`.

- [ ] **Step 3: Bring the Chinese side along**

In `packages/bundle/web-app/README.zh.md`, append to the `### LAN 访问与可信主机` paragraph (the one ending `重启 GUI 以重新公告。`):

```text
若要只放行一台手机而不是整个网段，就为你提供服务的端口添加按设备防火墙规则——在 Windows 上：`netsh advfirewall firewall add rule name="dsh web phone" dir=in action=allow protocol=TCP localport=3080 remoteip=<手机 IP>`——手机 DHCP 地址变化后需重新添加（`netsh advfirewall firewall delete rule name="dsh web phone"` 可删除旧规则）。已配对手机的设备 cookie 寿命由「连接手机」面板掌管：新设备从 `deviceLifetimeDays`（默认 30，合法 1–365）开始，面板显示剩余天数，设定新值即重新计时，吊销后该设备的下一次请求即失效。
```

replace the bullet `- **LAN 服务是明文 HTTP，且是默认行为**——…` with the two mirrored bullets:

```markdown
- **LAN 服务是明文 HTTP，且是默认行为**——除非传 `--host 127.0.0.1`，否则绑定所有网卡，流量不加密；被盗的设备 cookie 会在该设备窗口结束或你吊销它之前一直拥有完全控制权，因此只在信任的网络上提供服务，并把防火墙收窄到已配对的那台手机。
- **按设备的防火墙规则跟随手机地址**——上面的配方只放行一个 IP 字面量，DHCP 租约变化后需要重新添加规则；不再使用的设备在你吊销它并删除规则之前，仍然可以访问该端口。
```

In `packages/bundle/mob/README.zh.md`, append to the `### 从桌面会话交接` paragraph (the one ending `只有一个执行点。`):

```text
每条已配对设备还会显示寿命：`{days} 天（剩余 {remaining} 天）`、窗口已过的「已过期」，或旧条目在操作者设定天数之前的 `—`（旧条目仍按 cookie 载荷里的到期时间运行）。该行的 `1`/`7`/`30`/`90` 天档位与任意天数输入会重新开始该设备的倒计时；缩短在手机下一次请求即生效，延长则在手机下一次打开页面时生效。列表上方的一行文案提示：不再使用的设备立即吊销，在不受信任的网络上用过之后也建议吊销。
```

append to the `### 配对手机` paragraph (the one ending `局域网上的手机无法自行批准。`):

```text
`POST /pair/devices/lifetime` 携带 `{deviceId, days}`，是第三条仅电脑可用的决定路由，因此手机无法延长或缩短自己或他人的窗口；`GET /pair/devices` 会为每台设备返回其存储的 `lifetimeDays` 与 `expiresAt`，面板的寿命列据此渲染。
```

replace `七条` with `八条` in the `### 源码地图` intro paragraph of the same file.

In `packages/client/connection/README.zh.md`, replace the tail of the browser-authentication paragraph — from `` 其寿命由 `deviceCookieMaxAgeDays`（默认 180）在签发时固定，不因使用而续期。 `` — with:

```text
其窗口改由登记表决定：新登记的设备从 `deviceLifetimeDays`（默认 30，合法 1–365）开始，早于寿命字段的旧条目仍按载荷里的到期时间运行。只要当前时间早于该设备的 `expiresAt`，设备 cookie 就被接受，因此缩短的窗口在下一次请求即生效，而延长的窗口要等手机下一次索引请求——该响应会重新签发对齐的 cookie；`/api` 请求从不续期。
```

and append to the paragraph beginning `` `src/devices.ts` 拥有该登记表。 ``:

```text
`setDeviceLifetime` 会把某台设备的 `lifetimeDays` 与它对应的 `expiresAt` 一起写入，因此设定窗口即重新开始该设备的倒计时。
```

- [ ] **Step 4: Re-record the three pairs**

```bash
pnpm run verify-translation-pairing --write packages/bundle/web-app/README.md
pnpm run verify-translation-pairing --write packages/bundle/mob/README.md
pnpm run verify-translation-pairing --write packages/client/connection/README.md
```

- [ ] **Step 5: Run the gates to verify they pass**

Run: `pnpm exec tsx scripts/verify-translation-pairing.ts`

Expected: PASS — all pairs consistent.

Run: `pnpm run test:docs`

Expected: PASS — including `verify-md-wrap`, `verify-md-links`, and `verify-doc-budgets`.

- [ ] **Step 6: Commit**

```bash
git add packages/bundle/web-app/README.md packages/bundle/web-app/README.zh.md packages/bundle/web-app/README.i18n.yaml packages/bundle/mob/README.md packages/bundle/mob/README.zh.md packages/bundle/mob/README.i18n.yaml packages/client/connection/README.md packages/client/connection/README.zh.md packages/client/connection/README.i18n.yaml
git commit -m "docs: document the per-device firewall rule and device lifetime"
```

### Task 9: Record the decision and correct the two older notes

**Files:**
- Create: `.agents/notes/implemented/feature/2026-09-13-device-lifetime-authority.md`
- Create: `.agents/notes/implemented/feature/2026-09-13-device-lifetime-authority.zh.md`
- Create: `.agents/notes/implemented/feature/2026-09-13-device-lifetime-authority.i18n.yaml`
- Modify: `.agents/notes/implemented/feature/2026-09-12-phone-device-pairing.md`
- Modify: `.agents/notes/implemented/feature/2026-09-12-phone-device-pairing.zh.md`
- Modify: `.agents/notes/implemented/feature/2026-09-12-phone-device-pairing.i18n.yaml`
- Modify: `.agents/notes/implemented/architecture/2026-08-24-browser-token-authentication.md`
- Modify: `.agents/notes/implemented/architecture/2026-08-24-browser-token-authentication.zh.md`
- Modify: `.agents/notes/implemented/architecture/2026-08-24-browser-token-authentication.i18n.yaml`

**Interfaces:**
- Consumes: `PairedDevice.lifetimeDays`/`expiresAt`, `setDeviceLifetime`, `deviceLifetimeDays`, the index refresh, `/pair/devices/lifetime`, and the panel from Tasks 1–7.
- Produces: one `implemented/feature` Agent Note that owns the lifetime decision, plus in-place factual corrections in the pairing and browser-token notes.

- [ ] **Step 1: Write the note and its counterpart**

Create `.agents/notes/implemented/feature/2026-09-13-device-lifetime-authority.md` with:

```markdown
# Agent Note: Per-device device lifetime

Status: implemented

English | [中文](2026-09-13-device-lifetime-authority.zh.md)

## Problem

A paired phone's access ended when the signed device cookie said so: `issueDeviceCookie` wrote `expiresAt = issue time + deviceCookieMaxAgeDays`, the shipped default was 180 days, and `BrowserAuth` accepted the cookie for as long as its payload allowed and the registry still listed the device. The registry entry carried only `{id, label, registeredAt, lastSeenAt}`, so it answered one question — is this device still allowed — and the only lever over a phone's window was revoking it and pairing again. An operator who wanted a shorter window for a phone that leaves the house, or a longer one for a device that stays on the desk, had no way to say so, and the 180-day default outlived any plausible review of it.

## Decision

The `client-connection/paired-devices` record is the authority for each device's delivery window. An entry gains two optional fields: `lifetimeDays` (the operator's policy) and `expiresAt` (epoch milliseconds the current window ends). A device cookie is accepted when its signature is valid, the registry still lists that device, and the current time is before that device's window end — the registry's `expiresAt` when the entry carries one, otherwise the expiry in the signed payload, which is what an entry approved before this change keeps running on. Registration writes both fields from `deviceLifetimeDays` (default 30, integer 1–365, no never-expires option), so a new device is registry-governed from its first request.

`setDeviceLifetime` writes `lifetimeDays` with `expiresAt = now + days * DAY_MILLISECONDS`, so setting a window restarts that device's countdown. A shortened window needs nothing else: the registry refuses the device on its next request. An extended window reaches the phone through its next index request, which re-issues a device cookie aligned with the registry — payload expiry and `Max-Age`/`Expires` together — because a cookie payload can never outlive the window the registry records. Ordinary `/api` requests never renew anything, so the renewal path stays one route deep instead of spreading across every call.

Legacy entries are never written back. Reading the record does not migrate it, the panel shows `—` for an entry with no window, and the row's lifetime controls are how an operator moves that device onto the registry model; until then the device behaves exactly as it did before this change, so upgrading the Host does not drop a phone that is already paired.

The panel owns the operator surface: a lifetime column per device, `1`/`7`/`30`/`90` day presets plus an arbitrary-days box that restart the countdown, and a guidance line that says to revoke a device that is no longer used and to revoke after using an untrusted network. Its third computer-only route, `POST /pair/devices/lifetime` with `{deviceId, days}`, carries the write behind the same loopback-authority and browser-session guard as `/pair/approve`, `/pair/revoke`, and `GET /pair/devices`, so a phone cannot re-schedule itself or another device. `GET /pair/devices` answers each device with its stored `lifetimeDays` and `expiresAt`.

The startup warning for an all-interfaces bind keeps its wording and names the two narrowings: admit only the paired phone through the firewall, or pass `--host 127.0.0.1`.

## Alternatives considered

- **Keep the cookie payload as the authority and renew it on use.** Rejected: a stolen cookie would extend its own life for as long as it is used, which is the property the fixed 180-day window was chosen for, and it would re-introduce the renewal path on every request.
- **Write `expiresAt` back for legacy entries the first time the record is read.** Rejected: a read that writes makes the credential file change under an operator who only opened the panel, and it would start the clock on devices whose cookies were issued under the old policy — a silent logout for phones that were merely idle.
- **Offer a never-expires option for a device that stays at home.** Rejected: the LAN leg is plain HTTP, so the cookie is readable in transit; a permanent shell-equivalent credential on that leg has no recovery path short of revoking the device, and 365 days already covers the legitimate long-lived case.
- **Refresh the cookie on every authenticated `/api` request instead of the index request.** Rejected: it puts credential-provider and registry work on the RPC hot path, and it would extend a phone's window without the operator's knowledge on any stray request; one page load is the whole cost of the index-only rule.
- **Make the lifetime a per-deployment value instead of a per-device fact.** Rejected: it cannot shorten one phone without shortening every phone, which is the case that motivated the change, and the registry entry already travels with the device it describes.

## Consequences

- A device cookie's maximum life is now the window the operator last set, bounded by 365 days; `deviceCookieMaxAgeDays` is deleted and no configuration value replaces it per device.
- Windows change on the phone's next page load when extended; a phone that holds a stale cookie keeps working until its payload expires, and then it must load a page to pick up the extension.
- A legacy entry keeps its payload-bounded life until an operator sets days for it, at which point that device switches to the registry model; the panel's `—` is the visible marker of that state.
- The per-device window is a fact in `client-connection/paired-devices`, so it travels with the credentials file and is not reproducible from configuration alone.
- The plaintext LAN leg is unchanged. This narrows the value of a stolen cookie rather than removing the exposure; TLS remains the separate phase that closes it.
- [Phone device pairing](2026-09-12-phone-device-pairing.md) remains the authority for who a phone is and how it is admitted; [browser launch-token authentication](../architecture/2026-08-24-browser-token-authentication.md) remains the authority for the launch-token cookie and the signing record.
```

Then write `.agents/notes/implemented/feature/2026-09-13-device-lifetime-authority.zh.md` as the section-for-section Chinese counterpart: keep the machine-checked header tokens `# Agent Note: ` and `Status: implemented` verbatim, mirror the link line as `[English](2026-09-13-device-lifetime-authority.md)`, and translate `## Problem`, `## Decision`, `## Alternatives considered`, and `## Consequences` one paragraph per paragraph under the [translation contract](../../../docs/i18n/README.md) and its terminology guide.

- [ ] **Step 2: Run the format and pairing gates to see them fail**

Run: `pnpm run verify-agent-note-format`

Expected: PASS for the English note (header, `## Problem` opener, mandatory `## Alternatives considered`, no proposal-era headings).

Run: `pnpm exec tsx scripts/verify-translation-pairing.ts`

Expected: FAIL — the new note reports a missing `.zh.md` pairing record, and the two older notes still carry the old device-lifetime wording.

- [ ] **Step 3: Correct the pairing note in place**

In `.agents/notes/implemented/feature/2026-09-12-phone-device-pairing.md`, replace the sentence ``That cookie is the second cookie form: payload `{version: 2, authority, deviceId, issuedAt, expiresAt}`, lifetime `deviceCookieMaxAgeDays` (default 180) fixed at issue and never renewed by use.`` with:

```text
That cookie is the second cookie form: payload `{version: 2, authority, deviceId, issuedAt, expiresAt}`, ending at the delivery window the `client-connection/paired-devices` record holds for that device — `deviceLifetimeDays` (default 30) at registration, then whatever the operator sets — and never renewed by ordinary use ([per-device device lifetime](2026-09-13-device-lifetime-authority.md)).
```

and append to the rejected alternative `` **Sliding renewal of device cookies.** ``:

```text
 The registry window is fixed when the operator sets it and the index-request refresh only aligns the cookie to that window, so use still extends nothing.
```

Mirror both changes in `.agents/notes/implemented/feature/2026-09-12-phone-device-pairing.zh.md`.

- [ ] **Step 4: Correct the browser-token note in place**

In `.agents/notes/implemented/architecture/2026-08-24-browser-token-authentication.md`, replace the sentence ``The persistent secret makes cookies survive restarts but gives a stolen cookie up to the configured absolute lifetime.`` with:

```text
The persistent secret makes cookies survive restarts but gives a stolen launch-token cookie up to `cookieMaxAgeDays`, while a paired device's cookie ends at the window its registry entry records — a value the operator sets per device and can revoke outright ([per-device device lifetime](../feature/2026-09-13-device-lifetime-authority.md)).
```

Mirror the change in `.agents/notes/implemented/architecture/2026-08-24-browser-token-authentication.zh.md`.

- [ ] **Step 5: Re-record the pairs**

```bash
pnpm run verify-translation-pairing --write .agents/notes/implemented/feature/2026-09-13-device-lifetime-authority.md
pnpm run verify-translation-pairing --write .agents/notes/implemented/feature/2026-09-12-phone-device-pairing.md
pnpm run verify-translation-pairing --write .agents/notes/implemented/architecture/2026-08-24-browser-token-authentication.md
```

- [ ] **Step 6: Run the supersession check**

Confirm and record in the handoff: the new note partially supersedes the pairing note's device-lifetime sentence and the browser-token note's stolen-cookie lifetime clause, both corrected in place above; neither implemented note loses its decision, so no triplet moves to `archived/`. Run the calibrated workflow at `.agents/skills/dsh-archive-agent-notes/SKILL.md` only if that check finds a fully superseded triplet.

- [ ] **Step 7: Run the gates to verify they pass**

Run: `pnpm run verify-agent-note-format && pnpm run verify-translation-pairing && pnpm run verify-md-links`

Expected: PASS on all three.

- [ ] **Step 8: Commit**

```bash
git add .agents/notes
git commit -m "docs(agents): record the per-device device lifetime decision"
```

### Task 10: Verification sweep and the owner's real-device check

**Files:**
- Test: `packages/client/connection/tests`, `packages/bundle/mob/tests`, `packages/bundle/web-app/tests`
- Modify: any file a gate re-records below (for example `docs/config-catalog.i18n.yaml`)

**Interfaces:**
- Consumes: every artifact from Tasks 1–9.
- Produces: recorded evidence that the touched packages, the GUI suites, the documentation gates, and the translation pairing are green, plus the manual check only the owner can perform.

- [ ] **Step 1: Run the focused suites for the touched packages**

Run: `pnpm exec vitest run packages/client/connection packages/bundle/mob packages/bundle/web-app`

Expected: PASS.

- [ ] **Step 2: Run the GUI suites**

Run: `pnpm run test:gui`

Expected: PASS — the client and host suites, including the gateway and frontend-static suites that consume `ConnectionIndexResponse`.

- [ ] **Step 3: Run the documentation gates**

Run: `pnpm run test:docs`

Expected: PASS.

Run: `pnpm exec tsx scripts/verify-translation-pairing.ts`

Expected: PASS.

Run: `pnpm run verify-config-catalog`

Expected: PASS — `docs/config-catalog.md` is fresh and no longer mentions `deviceCookieMaxAgeDays`.

Run: `pnpm run verify-client-ui-i18n`

Expected: PASS.

- [ ] **Step 4: Run the real-CLI pairing case**

Run: `pnpm exec vitest run --config vitest.e2e.config.ts apps/cli/tests/pairing.e2e.ts`

Expected: PASS — the handshake, the guard on `/pair/devices/lifetime`, and revocation against a real `dsh web` process.

- [ ] **Step 5: Commit anything a gate re-recorded**

```bash
git add -A
git commit -m "chore: re-record generated catalogs for the device-lifetime change"
```

Skip this commit when `git status --short` is empty; commit only the regenerated files when it is not.

- [ ] **Step 6: Attach the panel GIF to the pull request**

This change alters product-user-visible GUI behavior, so the pull request carries a GIF recorded from its own tree with the workflow in `.agents/skills/record-browser-gif/SKILL.md`: boot `dsh web` from the branch tree, open Settings → General → Connect phone, pair a phone, then show the lifetime column and one re-schedule. State the demonstrated commit SHA, the serving tree, and whether a real model round ran next to the embed.

- [ ] **Step 7: Hand the real-device check to the owner**

The owner performs this on the paired phone and the computer, because it needs both devices on the same network and a real Host process:

1. Open the phone's page again and confirm the GUI still loads with the existing device cookie — the upgrade must not sign a paired phone out.
2. On the computer, open Settings → General → Connect phone; the phone's row shows `30 天（剩余 N 天）` for a device paired after this change, or `—` for one paired before it.
3. Set that device to `1` day, confirm the row shows `1 天（剩余 1 天）`, then use the phone: it still works until the window ends, and once it has ended the phone's next request is refused and its next page load shows the session-required screen.
4. Set the same device to `30` days while the phone still holds the old cookie, then reload the phone's page and confirm the row and the phone's continued access agree on the new window.
5. Change the phone's window with the panel copy in view and confirm the stated behavior matches: a longer window takes effect after the phone loads a page, a shorter one on its next request.
6. Revoke the device and confirm the phone's next request is refused, the row disappears from the panel, and the pairing code flow admits it again.
