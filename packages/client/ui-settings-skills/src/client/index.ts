/**
 * Skills settings plugin, browser half: the Skills page of the settings
 * shell. One icon per display group (declared group or discovery source),
 * drilling into a group's skill list with one toggle per skill; toggles
 * write the `skills` settings namespace through the revision-guarded wire
 * path, and the host registry override makes the change effective for the
 * model catalog, the `skill` tool, and the `/name` gesture.
 *
 * Export discipline: packages/client/AGENTS.md.
 */
import type { ClientContext, ISessions } from '@deepseek-ai/dsh-client-runtime/client'
import type { ConnectionHandle } from '@deepseek-ai/dsh-api-remotes/client'
// Type-only: pulls the shell's SlotMap merge (the 'settings.section' entry).
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the ctx.remote merge and the forwarded-event key face.
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import { SkillsSection } from './SkillsSection.tsx'
import type { SkillsSectionInjected } from './SkillsSection.tsx'
import { SkillsSettingsStore } from './store.ts'
import { en, zh, type SkillsKey } from './locales.ts'

export type { SkillsSectionInjected, SkillsSectionProps } from './SkillsSection.tsx'
export type { SkillsKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The Skills page copy. */
    'settings.skills': SkillsKey
  }
}

/** Dictionary namespace owned by this plugin. */
const NS = 'settings.skills'

/**
 * Refetch the page snapshot only after its first load: an unopened Skills
 * page must not fetch on background invalidations.
 * @param controller - the page store.
 */
function refreshIfLoaded(controller: SkillsSettingsStore): void {
  if (controller.store.getSnapshot().status === 'idle') return
  void controller.load()
}

/**
 * Required services (cordis fiber inject). The target slot is declared by
 * ui-settings' apply, whose activation order relative to this one is NOT
 * constrained; registration depends on each slot through `slots.inject()`.
 */
export const inject = ['slots', 'locale', 'connection', 'sessions', 'remote']

/**
 * Register the Skills section once the `settings.section` declaration is on
 * the ledger, wire its store to the connection and the current session, and
 * keep it fresh on pushed invalidations (settings commits, skill catalog
 * changes) and on active session-composition changes.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-settings-skills: copy dictionaries')

  const connection = ctx.get('connection') as ConnectionHandle
  const sessions = ctx.get('sessions') as ISessions
  let currentSessionId = sessions.list.getSnapshot().current
  const controller = new SkillsSettingsStore(
    connection.api,
    () => sessions.list.getSnapshot().current,
  )
  // Registration-time text follows the locale revision; render-time copy
  // rides the framework's standard locale seat.
  const t = ctx.locale.bind(NS)
  const injected = (): SkillsSectionInjected => ({
    hooks: { skills: controller.store },
    load: () => controller.load(),
    setEnabled: (name, enabled) => controller.setEnabled(name, enabled),
  })

  // Pushed invalidations converge every open surface without polling: a
  // skill catalog change (new skills, committed enablement overrides), a
  // current-session switch, current-session preset selection, or a
  // connection reset refetches once the page loaded. `dsh-skill-settings`
  // emits `skills/change` on every committed change of the `skills`
  // namespace, so one channel covers both registry and override updates.
  ctx.effect(() => {
    const refreshForCurrentSession = (): void => {
      const next = sessions.list.getSnapshot().current
      if (next === currentSessionId) return
      currentSessionId = next
      refreshIfLoaded(controller)
    }
    const disposers = [
      ctx.remote.$on('skills/change', () => { refreshIfLoaded(controller) }),
      ctx.remote.$on('agent-preset/selected', (sessionId) => {
        if (sessionId === currentSessionId) refreshIfLoaded(controller)
      }),
      ctx.on('connection/reset', () => { refreshIfLoaded(controller) }),
      sessions.list.subscribe(refreshForCurrentSession),
    ]
    return () => { for (const dispose of disposers) dispose() }
  }, 'ui-settings-skills: pushed invalidations')

  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'skills',
    order: 30,
    label: () => t('nav'),
    locale: NS,
    inject: injected,
  }, SkillsSection))
}
