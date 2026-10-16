/** Copy dictionaries for the Archived settings section. */

/** English strings (the key-set source of truth for this pair). */
export const en = {
  nav: 'Archived',
  title: 'Archived conversations',
  intro: 'Archived conversations do not appear in the sidebar. Restore one to continue it.',
  empty: 'No archived conversations yet. Archive a conversation from the sidebar menu to see it here.',
  loading: 'Loading archived conversations…',
  loadFailed: 'Loading archived conversations failed',
  retry: 'Retry',
  'group.ungrouped': 'Ungrouped',
  'row.details': 'Conversation details {name}',
  'row.restore': 'Restore conversation {name}',
  'row.running': 'Running',
  'date.ymd': '{y}-{m}-{d}',
  'details.title': 'Conversation details',
  'details.close': 'Close',
  'details.group': 'Group',
  'details.cwd': 'Directory',
  'details.agentPreset': 'Agent preset',
  'details.updatedAt': 'Last activity',
  'details.id': 'Session ID',
  'details.status': 'Status',
  'details.statusIdle': 'Idle',
  'details.descendants': 'Subagent conversations',
} as const

/** Translation keys owned by the Archived settings section. */
export type ArchivedSettingsKey = keyof typeof en

/** Chinese strings (mirrors the English key set). */
export const zh: Record<ArchivedSettingsKey, string> = {
  nav: '已归档',
  title: '已归档对话',
  intro: '已归档的对话不会出现在侧栏中。你可以恢复某个对话继续使用。',
  empty: '还没有已归档的对话。从侧栏菜单归档对话后，它会显示在这里。',
  loading: '正在加载已归档对话…',
  loadFailed: '加载已归档对话失败',
  retry: '重试',
  'group.ungrouped': '未分组',
  'row.details': '对话详情 {name}',
  'row.restore': '恢复对话 {name}',
  'row.running': '运行中',
  'date.ymd': '{y}年{m}月{d}日',
  'details.title': '对话详情',
  'details.close': '关闭',
  'details.group': '分组',
  'details.cwd': '目录',
  'details.agentPreset': 'Agent 预设',
  'details.updatedAt': '最后活动',
  'details.id': '会话 ID',
  'details.status': '状态',
  'details.statusIdle': '空闲',
  'details.descendants': '子代理对话数',
}
