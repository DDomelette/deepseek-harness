/** Copy dictionaries for the Skills settings section. */

/** English strings (the key-set source of truth for this pair). */
export const en = {
  nav: 'Skills',
  title: 'Skills',
  intro: 'Skills extend what the agent can do. Grouped by their declared group or their discovery source — open a group to switch individual skills on or off.',
  back: 'Back',
  countOne: '1 skill',
  count: '{count} skills',
  toggle: 'Toggle {name}',
  userOnly: 'User-only',
  readOnly: 'The settings document is read-only in this deployment.',
  loadFailed: 'Loading the skill catalog failed',
  retry: 'Retry',
  empty: 'No skills were discovered. Skills live in .dsh/skills and .agents/skills directories.',
  noSession: 'Open a session to see the skills its composition serves.',
  'source.user-dsh': 'User skills',
  'source.user-agents': 'Agent skills',
  'source.project-dsh': 'Project skills',
  'source.project-agents': 'Project skills',
  'source.custom': 'Custom skills',
  'source.bundled': 'Bundled skills',
  'source.runtime': 'Runtime skills',
} as const

/** Translation keys owned by the Skills settings section. */
export type SkillsKey = keyof typeof en

/** Chinese strings (mirrors the English key set). */
export const zh: Record<SkillsKey, string> = {
  nav: '技能',
  title: '技能',
  intro: '技能扩展智能体的能力。按声明的分组或发现来源聚合——点开一组即可单独开启或关闭每个技能。',
  back: '返回',
  countOne: '1 个技能',
  count: '{count} 个技能',
  toggle: '切换 {name}',
  userOnly: '仅用户可用',
  readOnly: '当前部署的配置文件为只读。',
  loadFailed: '加载技能目录失败',
  retry: '重试',
  empty: '未发现技能。技能位于 .dsh/skills 与 .agents/skills 目录。',
  noSession: '打开一个会话后即可在此查看其组合所服务的技能。',
  'source.user-dsh': '用户技能',
  'source.user-agents': 'Agent 技能',
  'source.project-dsh': '项目技能',
  'source.project-agents': '项目技能',
  'source.custom': '自定义技能',
  'source.bundled': '内置技能',
  'source.runtime': '运行时技能',
}

/** Source keys this package localizes; unknown sources display verbatim. */
const SOURCE_KEYS = new Set([
  'user-dsh', 'user-agents', 'project-dsh', 'project-agents', 'custom', 'bundled', 'runtime',
])

/**
 * Localized label for a discovery source, falling back to the source itself.
 * @param source - the skill's discovery source bucket.
 * @param t - bound dictionary translate.
 * @returns the display label.
 */
export function sourceLabel(source: string, t: (key: SkillsKey) => string): string {
  if (!SOURCE_KEYS.has(source)) return source
  return t(`source.${source}` as SkillsKey)
}
