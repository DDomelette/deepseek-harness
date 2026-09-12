/** Copy dictionaries for the Connect-phone settings row and its QR dialog. */

/** English strings (the key-set source of truth for this pair). */
export const en = {
  connectPhone: 'Connect phone',
  showQr: 'Show QR code',
  'dialog.title': 'Connect phone',
  'dialog.description': 'Scan with your phone to open dsh on the same network.',
  'dialog.loading': 'Preparing the join link…',
  'dialog.unavailable': 'LAN access is not enabled. Start it with dsh web --host 0.0.0.0 --allow-lan.',
  'dialog.noLanAddress': 'No LAN address found; check this computer\'s network connection',
  'dialog.loadFailed': 'Loading the join link failed',
  'dialog.urlLabel': 'Join link',
  close: 'Close',
} as const

/** Translation keys owned by the Connect-phone settings row. */
export type MobileSettingsKey = keyof typeof en

/** Chinese strings (mirrors the English key set). */
export const zh: Record<MobileSettingsKey, string> = {
  connectPhone: '连接手机',
  showQr: '显示二维码',
  'dialog.title': '连接手机',
  'dialog.description': '用手机扫码，在同一网络中打开 dsh。',
  'dialog.loading': '正在准备加入链接…',
  'dialog.unavailable': '当前未开启内网访问，请用 dsh web --host 0.0.0.0 --allow-lan 启动',
  'dialog.noLanAddress': '未找到局域网地址，请检查本机网络连接',
  'dialog.loadFailed': '加入链接加载失败',
  'dialog.urlLabel': '加入链接',
  close: '关闭',
}
