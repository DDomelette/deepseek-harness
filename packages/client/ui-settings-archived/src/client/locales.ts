/** Copy dictionaries for the Archived settings section. */

/** English strings (the key-set source of truth for this pair). */
export const en = {
  nav: 'Archived',
  title: 'Archived conversations',
  intro: 'Archived conversations do not appear in the sidebar. Restore one to continue it, or permanently delete it.',
  empty: 'No archived conversations yet. Archive a conversation from the sidebar menu to see it here.',
  loading: 'Loading archived conversations…',
  loadFailed: 'Loading archived conversations failed',
  retry: 'Retry',
  'group.ungrouped': 'Ungrouped',
  'row.restore': 'Restore conversation {name}',
  'row.delete': 'Delete conversation {name}',
  'row.running': 'Running',
  'row.runningDeleteDisabled': 'Running conversations cannot be deleted',
  'confirm.title': 'Delete conversation?',
  'confirm.bodyNoDescendants': 'This will permanently delete "{title}". This cannot be undone.',
  'confirm.bodyWithDescendants': 'This will permanently delete "{title}" and {count} subagent conversations. This cannot be undone.',
  'confirm.cancel': 'Cancel',
  'confirm.delete': 'Delete',
  restoreFailed: 'Restore failed',
  deleteFailed: 'Delete failed',
} as const

/** Translation keys owned by the Archived settings section. */
export type ArchivedSettingsKey = keyof typeof en

/** Chinese strings (mirrors the English key set). */
export const zh: Record<ArchivedSettingsKey, string> = {
  nav: '已归档',
  title: '已归档对话',
  intro: '已归档的对话不会出现在侧栏中。你可以恢复某个对话继续使用，或将其永久删除。',
  empty: '还没有已归档的对话。从侧栏菜单归档对话后，它会显示在这里。',
  loading: '正在加载已归档对话…',
  loadFailed: '加载已归档对话失败',
  retry: '重试',
  'group.ungrouped': '未分组',
  'row.restore': '恢复对话 {name}',
  'row.delete': '删除对话 {name}',
  'row.running': '运行中',
  'row.runningDeleteDisabled': '运行中的会话不能删除',
  'confirm.title': '删除对话？',
  'confirm.bodyNoDescendants': '将永久删除“{title}”。此操作无法撤销。',
  'confirm.bodyWithDescendants': '将永久删除“{title}”及其 {count} 个子代理对话。此操作无法撤销。',
  'confirm.cancel': '取消',
  'confirm.delete': '删除',
  restoreFailed: '恢复失败',
  deleteFailed: '删除失败',
}
