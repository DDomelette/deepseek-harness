import type { Context } from '@deepseek-ai/cordis'
import { credentialKey } from '@deepseek-ai/dsh-credentials'
import type { CredentialKey, CredentialProvider, CredentialRecord } from '@deepseek-ai/dsh-credentials'

/** Key of the durable signing secret, as BrowserAuth writes it. */
export const BROWSER_SESSION_KEY = credentialKey('client-connection', 'browser-session')
/** Key of the paired-device registry. */
export const PAIRED_DEVICES_KEY = credentialKey('client-connection', 'paired-devices')

/** Mutable credential-record double for Connection authentication tests. */
export class RecordCredentials {
  /** The browser-session secret record, the key this double was built around. */
  record: CredentialRecord | undefined
  /** Records stored under any other key, addressed by their raw key string. */
  readonly keyed = new Map<string, CredentialRecord>()
  discardWrites = false
  reads = 0
  modifies = 0

  readRecord(key: CredentialKey): Promise<CredentialRecord | undefined> {
    this.reads += 1
    return Promise.resolve(this.current(key))
  }

  async modifyRecord(
    key: CredentialKey,
    mutate: (current: CredentialRecord | undefined) => Promise<CredentialRecord | undefined>,
  ): Promise<CredentialRecord | undefined> {
    this.modifies += 1
    const next = await mutate(this.current(key))
    if (this.discardWrites) return undefined
    this.write(key, next)
    return this.current(key)
  }

  deleteRecord(key: CredentialKey = BROWSER_SESSION_KEY): Promise<void> {
    if (String(key) === String(BROWSER_SESSION_KEY)) this.record = undefined
    else this.keyed.delete(String(key))
    return Promise.resolve()
  }

  /** Seed the paired-device registry record with a payload. */
  setPairedDevices(payload: unknown): void {
    this.keyed.set(String(PAIRED_DEVICES_KEY), { kind: 'grant', payload })
  }

  private current(key: CredentialKey): CredentialRecord | undefined {
    return String(key) === String(BROWSER_SESSION_KEY) ? this.record : this.keyed.get(String(key))
  }

  private write(key: CredentialKey, next: CredentialRecord | undefined): void {
    if (next === undefined) return
    if (String(key) === String(BROWSER_SESSION_KEY)) this.record = next
    else this.keyed.set(String(key), next)
  }
}

/** Provide the record operations Connection needs during authentication setup. */
export function provideBrowserCredentials(ctx: Context): void {
  ctx.provide('credentials', new RecordCredentials() as unknown as CredentialProvider)
}
