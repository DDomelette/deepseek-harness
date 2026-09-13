/** Shell chrome and General-nav dictionaries; feature rows own their copy. */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'trigger': '设置',
  'title': '设置',
  'close': '关闭',
  'back': '返回',
  'openDocument': '打开配置文件',
  'openDocument.error': '无法打开配置文件',
  'general.nav': '通用设置',
  'connection.error': '连接异常',
  'connection.retry': '立即重连',
  'connection.connecting': '自动重连中',
  'connection.connected': '连接成功',
  'connection.reconnect': '连接异常，点击立即重连',
  'connection.restart': '连接中断，正在自动重试，点击立即重连',
  'connection.failure.auth': '登录已失效，请在电脑端重新扫码',
  'connection.failure.forbidden': '该地址未被信任，请使用电脑端打印的地址',
  'connection.failure.timeout': '连接超时，正在重试',
  'connection.failure.unreachable': '连不上电脑端，请确认在同一网络',
  'connection.failure.internal': '客户端出错，请刷新页面重试',
} satisfies Record<string, string>

/** The settings namespace key union. */
export type SettingsKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'trigger': 'Settings',
  'title': 'Settings',
  'close': 'Close',
  'back': 'Back',
  'openDocument': 'Open configuration file',
  'openDocument.error': 'Could not open configuration file',
  'general.nav': 'General',
  'connection.error': 'Disconnected',
  'connection.retry': 'Reconnect now',
  'connection.connecting': 'Reconnecting',
  'connection.connected': 'Connected',
  'connection.reconnect': 'Disconnected, reconnect now',
  'connection.restart': 'Reconnecting automatically, reconnect now',
  'connection.failure.auth': 'Sign-in expired; scan the code on the computer again',
  'connection.failure.forbidden': 'This address is not trusted; use the one the computer printed',
  'connection.failure.timeout': 'Connection timed out; retrying',
  'connection.failure.unreachable': 'Cannot reach the computer; check both are on the same network',
  'connection.failure.internal': 'Client error; reload the page',
} satisfies Record<SettingsKey, string>
