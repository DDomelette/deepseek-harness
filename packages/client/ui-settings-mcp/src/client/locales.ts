/** Copy dictionaries for the MCP server roster Settings tab. */

/** Simplified Chinese dictionary and key source of truth. */
export const zh = {
  tab: 'MCP',
  search: '搜索 MCP 服务器',
  servers: '服务器',
  empty: '还没有 MCP 服务器，点右上角 + 添加。',
  emptySearch: '没有匹配的服务器。',
  loading: '加载中…',
  error: '加载失败。',
  retry: '重试',
  addServer: '添加 MCP 服务器',
  back: '返回',
  declarativeTag: '由配置文件管理',
  enabledTag: '已启用',
  disabledTag: '已停用',
  connecting: '连接中',
  // Mount lifecycle only: a settled mount is not a proven live connection.
  ready: '运行中',
  failed: '启动失败',
  edit: '编辑',
  settings: '设置',
} satisfies Record<string, string>

/** MCP roster locale key union. */
export type McpLocaleKey = keyof typeof zh

/** English dictionary checked against the Chinese key set. */
export const en = {
  tab: 'MCP',
  search: 'Search MCP servers',
  servers: 'Servers',
  empty: 'No MCP servers yet — use + to add one.',
  emptySearch: 'No matching servers.',
  loading: 'Loading…',
  error: 'Failed to load.',
  retry: 'Retry',
  addServer: 'Add MCP server',
  back: 'Back',
  declarativeTag: 'Managed by config file',
  enabledTag: 'Enabled',
  disabledTag: 'Disabled',
  connecting: 'Connecting',
  ready: 'Running',
  failed: 'Startup failed',
  edit: 'Edit',
  settings: 'Settings',
} satisfies Record<McpLocaleKey, string>
