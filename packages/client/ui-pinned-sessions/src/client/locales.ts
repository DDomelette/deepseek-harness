/** `sessionPins` namespace dictionaries. */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'pinned': '置顶',
  'pin': '置顶',
  'unpin': '取消置顶',
  'pinnedBadge': '已置顶',
  'projects': '项目',
  'ungrouped': '未分组',
} satisfies Record<string, string>

/** The sessionPins namespace key union. */
export type SessionPinsKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'pinned': 'Pinned',
  'pin': 'Pin',
  'unpin': 'Unpin',
  'pinnedBadge': 'Pinned',
  'projects': 'Projects',
  'ungrouped': 'Ungrouped',
} satisfies Record<SessionPinsKey, string>
