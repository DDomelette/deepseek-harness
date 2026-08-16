/**
 * The usage-telemetry plugin's card: one staged switch for local recording.
 */

import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { PluginCard } from './PluginCard.tsx'
import type { UsageTelemetryCardFace } from './usage-telemetry-card-controller.ts'
import type {} from './slot-contract.ts'

/** Props the renderer binds for the usage-telemetry card. */
export type UsageTelemetryCardProps =
  PropsRuntime<'settings.plugin.item'>
  & PropsLocale<'settings.plugins'>
  & InjectFace<UsageTelemetryCardFace>

/**
 * Render the usage-telemetry card.
 * @param props - locale copy, the card snapshot, and its form actions.
 * @returns the card.
 */
export function UsageTelemetryCard(props: UsageTelemetryCardProps) {
  const { t } = props
  const state = props.useUsageTelemetryCard(snapshot => snapshot)
  return (
    <PluginCard
      t={t}
      titleKey="usageTelemetryTitle"
      descriptionKey="usageTelemetryDescription"
      state={state}
      onSave={props.save}
      onDiscard={props.discard}
    >
      <label>
        <input
          type="checkbox"
          checked={state.draft}
          disabled={!state.writable}
          onChange={(event) => { props.edit('enabled', String(event.currentTarget.checked)) }}
        />
        <span>{t('usageTelemetryEnabled')}</span>
      </label>
      <p>{t('usageTelemetryEnabledHint')}</p>
    </PluginCard>
  )
}
