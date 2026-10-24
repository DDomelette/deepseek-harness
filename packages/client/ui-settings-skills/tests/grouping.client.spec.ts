/** Grouping projection: one group per discovery source. */
import { describe, expect, it } from 'vitest'
import type { SkillCatalogEntry } from '@deepseek-ai/dsh-api-remotes/client'
import { groupSkills } from '../src/client/grouping.ts'
import { sourceLabel } from '../src/client/locales.ts'

function entry(over: Partial<SkillCatalogEntry> & { name: string }): SkillCatalogEntry {
  return {
    description: over.name,
    source: 'user-dsh',
    modelInvocable: true,
    userInvocable: true,
    disabled: false,
    ...over,
  }
}

/** Source-label stub: known sources localize, unknown sources fall through verbatim. */
function labelFor(source: string): string {
  return source === 'bundled' ? '内置' : source === 'user-dsh' ? '用户' : source
}

describe('groupSkills', () => {
  it('aggregates one group per discovery source and keeps catalog order inside it', () => {
    const skills = [
      entry({ name: 'b-skill' }),
      entry({ name: 'a-skill' }),
      entry({ name: 'c-skill', source: 'bundled' }),
      entry({ name: 'd-skill', source: 'bundled' }),
      entry({ name: 'e-skill', source: 'unknown-source' }),
    ]

    const groups = groupSkills(skills, labelFor)

    // Code-point label order: ASCII labels first, then CJK labels.
    expect(groups).toEqual([
      { key: 'source:unknown-source', label: 'unknown-source', skills: [skills[4]] },
      { key: 'source:bundled', label: '内置', skills: [skills[2], skills[3]] },
      { key: 'source:user-dsh', label: '用户', skills: [skills[0], skills[1]] },
    ])
  })

  it('sorts groups by localized label, not by source or catalog order', () => {
    const skills = [
      entry({ name: 'z-skill', source: 'user-agents' }),
      entry({ name: 'y-skill', source: 'custom' }),
      entry({ name: 'x-skill', source: 'bundled' }),
    ]

    const groups = groupSkills(skills, (source) => {
      return source === 'bundled' ? 'Z-bundled' : source === 'custom' ? 'A-custom' : 'M-user-agents'
    })

    expect(groups.map(group => group.label)).toEqual(['A-custom', 'M-user-agents', 'Z-bundled'])
  })

  it('breaks label ties by the group key', () => {
    // Two sources localize to the same label; the key keeps them distinct and ordered.
    const skills = [
      entry({ name: 'a-skill', source: 'project-dsh' }),
      entry({ name: 'b-skill', source: 'project-agents' }),
      entry({ name: 'c-skill', source: 'project-dsh' }),
    ]

    const groups = groupSkills(skills, () => 'Project skills')

    expect(groups.map(group => [group.key, group.skills.map(skill => skill.name)])).toEqual([
      ['source:project-agents', ['b-skill']],
      ['source:project-dsh', ['a-skill', 'c-skill']],
    ])
  })

  it('returns no groups for an empty catalog', () => {
    expect(groupSkills([], labelFor)).toEqual([])
  })
})

describe('sourceLabel', () => {
  it('localizes known sources and renders unknown ones verbatim', () => {
    const t = ((key: string): string => `[${key}]`) as (key: import('../src/client/locales.ts').SkillsKey) => string
    expect(sourceLabel('user-dsh', t)).toBe('[source.user-dsh]')
    expect(sourceLabel('unknown-source', t)).toBe('unknown-source')
  })
})
