/**
 * `notes` namespace dictionaries.
 *
 * The refusal lines are the point of this file: the Host reports a stable
 * failure code per reason a notes operation declines, and each one tells the
 * reader something different about what to do next.
 */
import type {} from '@deepseek-ai/dsh-client-ui-slots'

/** Simplified Chinese dictionary and key-set source of truth. */
export const zh = {
  'tab.title': '笔记',
  'header.open': '打开笔记',
  'header.openAria': '打开笔记面板',
  'panel.loading': '正在读取…',
  'panel.refresh': '刷新',
  'panel.empty': '还没有笔记会话。',
  'panel.create': '新建会话',
  'panel.noMaterials': '这个会话还没有素材。',
  'panel.materials': '{count} 条素材',
  'panel.archived': '已归档 {count} 条',
  'source.chat': '对话',
  'source.trajectory': '轨迹',
  'source.image': '截图',
  'error.sessionNotFound': '这个笔记会话已经不存在了。',
  'error.materialNotFound': '这条素材已经不存在了。',
  'error.materialSubmitted': '素材已经进入会话，正文不能再改。',
  'error.workspaceMissing': '还没有配置笔记工作区。',
  'error.lastConversation': '最后一个会话不能归档。',
  'error.sessionNotLive': '这个会话已经不在运行，需要重新打开。',
  'error.unknownAction': '这条素材用的动作已经不在配置里了。',
  'error.remoteUnavailable': '无法连接到宿主：{message}',
} satisfies Record<string, string>

/** Notes dictionary key union. */
export type NotesKey = keyof typeof zh

/** English dictionary, checked against the Chinese key set. */
export const en = {
  'tab.title': 'Notes',
  'header.open': 'Open notes',
  'header.openAria': 'Open the notes panel',
  'panel.loading': 'Reading…',
  'panel.refresh': 'Refresh',
  'panel.empty': 'No notes conversation yet.',
  'panel.create': 'New conversation',
  'panel.noMaterials': 'This conversation has no materials yet.',
  'panel.materials': '{count} materials',
  'panel.archived': '{count} archived',
  'source.chat': 'Chat',
  'source.trajectory': 'Trajectory',
  'source.image': 'Screenshot',
  'error.sessionNotFound': 'That notes conversation no longer exists.',
  'error.materialNotFound': 'That material no longer exists.',
  'error.materialSubmitted': 'The material entered its conversation, so its text is fixed.',
  'error.workspaceMissing': 'No notes workspace is configured yet.',
  'error.lastConversation': 'The last conversation cannot be archived.',
  'error.sessionNotLive': 'That conversation is no longer running and has to be reopened.',
  'error.unknownAction': 'The action this material used is no longer configured.',
  'error.remoteUnavailable': 'The Host is unreachable: {message}',
} satisfies Record<NotesKey, string>

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Notes panel chrome, collection states, and one line per Host refusal. */
    notes: NotesKey
  }
}
