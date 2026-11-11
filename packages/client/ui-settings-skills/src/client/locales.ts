/** Copy dictionaries for the Skills settings section. */

/** English strings (the key-set source of truth for this pair). */
export const en = {
  nav: 'Skills',
  title: 'Skills',
  intro: 'Skills extend what the agent can do. Grouped by their discovery source — open a group to switch individual skills on or off.',
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
  intro: '技能扩展智能体的能力。按发现来源聚合——点开一组即可单独开启或关闭每个技能。',
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

/** Japanese dictionary. */
export const ja = {
  nav: 'スキル',
  title: 'スキル',
  back: '戻る',
  readOnly: 'このデプロイでは設定ドキュメントは読み取り専用です。',
  retry: '再試行',
  intro: 'スキルはエージェントの機能を拡張します。検出元ごとにまとまっているので、グループを開いて各スキルを切り替えてください。',
  countOne: 'スキル 1 件',
  count: 'スキル {count} 件',
  toggle: '{name} を切り替える',
  userOnly: 'ユーザー専用',
  loadFailed: 'スキルカタログを読み込めませんでした',
  empty: 'スキルが見つかりませんでした。スキルは .dsh/skills と .agents/skills に配置します。',
  noSession: 'セッションを開くと、その構成で利用できるスキルが表示されます。',
  'source.user-dsh': 'ユーザーのスキル',
  'source.user-agents': 'エージェントのスキル',
  'source.project-dsh': 'プロジェクトのスキル',
  'source.project-agents': 'プロジェクトのスキル',
  'source.custom': 'カスタムスキル',
  'source.bundled': '同梱スキル',
  'source.runtime': '実行時のスキル',
} satisfies Record<SkillsKey, string>

/** Spanish dictionary. */
export const es = {
  nav: 'Habilidades',
  title: 'Habilidades',
  back: 'Atrás',
  readOnly: 'El documento de configuración es de solo lectura en esta implementación.',
  retry: 'Reintentar',
  intro: 'Las habilidades amplían las funciones del agente. Se agrupan por origen. Abre un grupo para activar o desactivar cada habilidad.',
  countOne: '1 habilidad',
  count: '{count} habilidades',
  toggle: 'Activar o desactivar {name}',
  userOnly: 'Solo para el usuario',
  loadFailed: 'No se pudo cargar el catálogo de habilidades',
  empty: 'No se encontraron habilidades. Se guardan en los directorios .dsh/skills y .agents/skills.',
  noSession: 'Abre una sesión para ver las habilidades disponibles en su configuración.',
  'source.user-dsh': 'Habilidades del usuario',
  'source.user-agents': 'Habilidades del agente',
  'source.project-dsh': 'Habilidades del proyecto',
  'source.project-agents': 'Habilidades del proyecto',
  'source.custom': 'Habilidades personalizadas',
  'source.bundled': 'Habilidades incluidas',
  'source.runtime': 'Habilidades de ejecución',
} satisfies Record<SkillsKey, string>

/** French dictionary. */
export const fr = {
  nav: 'Compétences',
  title: 'Compétences',
  back: 'Retour',
  readOnly: 'Le document de paramètres est en lecture seule dans ce déploiement.',
  retry: 'Réessayer',
  intro: 'Les compétences étendent les capacités de l’agent. Elles sont regroupées par source. Ouvrez un groupe pour activer ou désactiver une compétence.',
  countOne: '1 compétence',
  count: '{count} compétences',
  toggle: 'Activer ou désactiver {name}',
  userOnly: 'Réservé à l’utilisateur',
  loadFailed: 'Impossible de charger le catalogue de compétences',
  empty: 'Aucune compétence trouvée. Les compétences se trouvent dans les répertoires .dsh/skills et .agents/skills.',
  noSession: 'Ouvrez une session pour voir les compétences disponibles dans sa configuration.',
  'source.user-dsh': 'Compétences de l’utilisateur',
  'source.user-agents': 'Compétences de l’agent',
  'source.project-dsh': 'Compétences du projet',
  'source.project-agents': 'Compétences du projet',
  'source.custom': 'Compétences personnalisées',
  'source.bundled': 'Compétences fournies',
  'source.runtime': 'Compétences d’exécution',
} satisfies Record<SkillsKey, string>

/** German dictionary. */
export const de = {
  nav: 'Fähigkeiten',
  title: 'Fähigkeiten',
  back: 'Zurück',
  readOnly: 'Das Einstellungsdokument ist in dieser Bereitstellung schreibgeschützt.',
  retry: 'Erneut versuchen',
  intro: 'Skills erweitern die Möglichkeiten des Agenten. Sie sind nach Herkunft gruppiert. Öffnen Sie eine Gruppe, um einzelne Skills ein- oder auszuschalten.',
  countOne: '1 Skill',
  count: '{count} Skills',
  toggle: '{name} ein- oder ausschalten',
  userOnly: 'Nur für Benutzer',
  loadFailed: 'Skill-Katalog konnte nicht geladen werden',
  empty: 'Keine Skills gefunden. Skills liegen in den Verzeichnissen .dsh/skills und .agents/skills.',
  noSession: 'Öffnen Sie eine Sitzung, um die Skills ihrer Konfiguration zu sehen.',
  'source.user-dsh': 'Benutzer-Skills',
  'source.user-agents': 'Agenten-Skills',
  'source.project-dsh': 'Projekt-Skills',
  'source.project-agents': 'Projekt-Skills',
  'source.custom': 'Benutzerdefinierte Skills',
  'source.bundled': 'Mitgelieferte Skills',
  'source.runtime': 'Laufzeit-Skills',
} satisfies Record<SkillsKey, string>

/** Russian dictionary. */
export const ru = {
  nav: 'Навыки',
  title: 'Навыки',
  back: 'Назад',
  readOnly: 'В этом развертывании документ настроек доступен только для чтения.',
  retry: 'Повторить',
  intro: 'Навыки расширяют возможности агента и сгруппированы по источникам. Откройте группу, чтобы включить или отключить отдельные навыки.',
  countOne: '1 навык',
  count: 'Навыков: {count}',
  toggle: 'Включить или отключить {name}',
  userOnly: 'Только для пользователя',
  loadFailed: 'Не удалось загрузить каталог навыков',
  empty: 'Навыки не найдены. Навыки размещаются в каталогах .dsh/skills и .agents/skills.',
  noSession: 'Откройте сеанс, чтобы увидеть навыки, доступные в его конфигурации.',
  'source.user-dsh': 'Навыки пользователя',
  'source.user-agents': 'Навыки агента',
  'source.project-dsh': 'Навыки проекта',
  'source.project-agents': 'Навыки проекта',
  'source.custom': 'Пользовательские навыки',
  'source.bundled': 'Встроенные навыки',
  'source.runtime': 'Навыки среды выполнения',
} satisfies Record<SkillsKey, string>

/** Portuguese dictionary. */
export const pt = {
  nav: 'Habilidades',
  title: 'Habilidades',
  back: 'Voltar',
  readOnly: 'O documento de configurações é somente leitura nesta implantação.',
  retry: 'Tentar novamente',
  intro: 'As competências ampliam as capacidades do agente e são agrupadas por origem. Abra um grupo para ativar ou desativar cada competência.',
  countOne: '1 competência',
  count: '{count} competências',
  toggle: 'Ativar ou desativar {name}',
  userOnly: 'Apenas para o utilizador',
  loadFailed: 'Não foi possível carregar o catálogo de competências',
  empty: 'Não foram encontradas competências. As competências ficam nos diretórios .dsh/skills e .agents/skills.',
  noSession: 'Abra uma sessão para ver as competências disponíveis na sua configuração.',
  'source.user-dsh': 'Competências do utilizador',
  'source.user-agents': 'Competências do agente',
  'source.project-dsh': 'Competências do projeto',
  'source.project-agents': 'Competências do projeto',
  'source.custom': 'Competências personalizadas',
  'source.bundled': 'Competências incluídas',
  'source.runtime': 'Competências de execução',
} satisfies Record<SkillsKey, string>
