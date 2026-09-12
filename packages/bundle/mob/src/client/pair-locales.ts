/** Copy dictionaries for the phone pairing surface: the pairing screen and the session-required screen. */

/** English strings (the key-set source of truth for this pair). */
export const en = {
  title: 'Connect phone',
  codeLabel: 'Pairing code',
  waiting: 'Confirm this phone on the computer to finish pairing.',
  denied: 'The computer denied this pairing request.',
  expired: 'This code is no longer valid. Create a new one on the computer.',
  locked: 'Too many attempts. Create a new code on the computer and try again.',
  authTitle: 'Signed out',
  authBody: 'This device is no longer paired. On the computer, open Settings → General → Connect phone, create a pairing code, and open its link on this device.',
  authReload: 'Reload',
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
  authTitle: '登录已失效',
  authBody: '本设备已不再处于已配对状态。请在电脑端打开 设置 → 通用设置 → 连接手机，生成配对码后在本设备上打开该链接。',
  authReload: '重新加载',
}
