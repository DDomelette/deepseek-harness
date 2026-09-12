/** Copy dictionaries for the phone pairing screen. */

/** English strings (the key-set source of truth for this pair). */
export const en = {
  title: 'Connect phone',
  codeLabel: 'Pairing code',
  waiting: 'Confirm this phone on the computer to finish pairing.',
  denied: 'The computer denied this pairing request.',
  expired: 'This code is no longer valid. Create a new one on the computer.',
  locked: 'Too many attempts. Create a new code on the computer and try again.',
} as const

/** Translation keys owned by the pairing screen. */
export type PairScreenKey = keyof typeof en

/** Chinese strings (mirrors the English key set). */
export const zh: Record<PairScreenKey, string> = {
  title: '连接手机',
  codeLabel: '配对码',
  waiting: '请在电脑端确认这台手机以完成配对。',
  denied: '电脑端拒绝了这次配对请求。',
  expired: '该配对码已失效，请在电脑端重新生成。',
  locked: '尝试次数过多，请在电脑端重新生成配对码后再试。',
}
