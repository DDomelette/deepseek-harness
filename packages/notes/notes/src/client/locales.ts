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
  'panel.archivedItem': '已归档 · {title}',
  'panel.archive': '归档',
  'panel.archiveSession': '归档这个会话',
  'panel.restore': '取出置顶',
  'detail.title': '素材',
  'detail.back': '返回列表',
  'detail.body': '素材正文',
  'detail.save': '保存',
  'detail.analyze': '分析',
  'detail.archive': '归档',
  'detail.remove': '删除',
  'detail.threadLoading': '正在读取回答…',
  'detail.threadEmpty': '还没有提交给模型。',
  'detail.ask': '追问',
  'status.draft': '待处理',
  'status.analyzing': '分析中',
  'status.analyzed': '已分析',
  'status.failed': '失败',
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
  'panel.archivedItem': 'Archived · {title}',
  'panel.archive': 'Archive',
  'panel.archiveSession': 'Archive this conversation',
  'panel.restore': 'Restore to top',
  'detail.title': 'Material',
  'detail.back': 'Back to the list',
  'detail.body': 'Material text',
  'detail.save': 'Save',
  'detail.analyze': 'Analyze',
  'detail.archive': 'Archive',
  'detail.remove': 'Delete',
  'detail.threadLoading': 'Reading the answer…',
  'detail.threadEmpty': 'Not submitted to the model yet.',
  'detail.ask': 'Ask',
  'status.draft': 'Draft',
  'status.analyzing': 'Analyzing',
  'status.analyzed': 'Analyzed',
  'status.failed': 'Failed',
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
