/** Accessible status summary with one primary visual marker. */
import { StateDot, type StateDotState } from './StateDot.tsx'
import css from './StatusDots.module.css'

/** One localized status, ordered by display priority by the caller. */
export interface DotStatus {
  state: StateDotState
  label: string
}

/**
 * Show the primary dot and expose every supplied status to screen readers.
 * @param props.statuses - nonempty statuses in priority order, with unique localized labels.
 * @returns the visual marker and its screen-reader descriptions.
 */
export function StatusDots({ statuses }: { statuses: readonly [DotStatus, ...DotStatus[]] }) {
  return (
    <>
      <StateDot state={statuses[0].state} />
      {statuses.map(status => (
        <span className={css.visuallyHidden} key={status.label}>{status.label}</span>
      ))}
    </>
  )
}
