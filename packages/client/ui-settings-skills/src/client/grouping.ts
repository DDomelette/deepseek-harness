/** Grouping projection for the skills settings grid. */

import type { SkillCatalogEntry } from '@deepseek-ai/dsh-api-remotes/client'

/** One aggregated group of skills shown as a single icon in the grid. */
export interface SkillGroup {
  /** Stable aggregation key: `group:<name>` for declared groups, `source:<name>` otherwise. */
  readonly key: string
  /** Display label: the declared group name or the localized source label. */
  readonly label: string
  /** Skills in this group, catalog order. */
  readonly skills: readonly SkillCatalogEntry[]
}

/** Mutable aggregation accumulator; the public group view is readonly. */
interface MutableGroup {
  key: string
  label: string
  skills: SkillCatalogEntry[]
}

/**
 * Aggregate the catalog into display groups. A skill's declared `group` wins;
 * skills without one aggregate by discovery source. Groups sort by localized
 * label with the key as tiebreak, and skills keep catalog order inside a group.
 * @param skills - the invocation-neutral catalog rows.
 * @param labelForSource - source→label resolution (see `sourceLabel`).
 * @returns the ordered groups.
 */
export function groupSkills(
  skills: readonly SkillCatalogEntry[],
  labelForSource: (source: string) => string,
): SkillGroup[] {
  const groups = new Map<string, MutableGroup>()
  for (const skill of skills) {
    const key = skill.group === undefined ? `source:${skill.source}` : `group:${skill.group}`
    const existing = groups.get(key)
    if (existing === undefined) {
      groups.set(key, { key, label: skill.group ?? labelForSource(skill.source), skills: [skill] })
    } else {
      existing.skills.push(skill)
    }
  }
  return [...groups.values()].sort((left, right) => compareCodePoints(left.label, right.label) || compareCodePoints(left.key, right.key))
}

function compareCodePoints(left: string, right: string): number {
  if (left < right) return -1
  if (left > right) return 1
  return 0
}
