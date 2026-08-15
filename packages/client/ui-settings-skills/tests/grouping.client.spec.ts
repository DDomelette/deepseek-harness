/** Grouping projection: declared groups win, the discovery source is the fallback. */
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
  it('aggregates declared groups and falls back to the discovery source', () => {
    const skills = [
      entry({ name: 'b-skill', group: 'superpowers' }),
      entry({ name: 'a-skill', group: 'superpowers' }),
      entry({ name: 'c-skill' }),
      entry({ name: 'd-skill', source: 'bundled' }),
      entry({ name: 'e-skill', source: 'unknown-source' }),
    ]

    const groups = groupSkills(skills, labelFor)

    // Code-point label order: ASCII labels first, then CJK labels.
    expect(groups).toEqual([
      { key: 'group:superpowers', label: 'superpowers', skills: [skills[0], skills[1]] },
      { key: 'source:unknown-source', label: 'unknown-source', skills: [skills[4]] },
      { key: 'source:bundled', label: '内置', skills: [skills[3]] },
      { key: 'source:user-dsh', label: '用户', skills: [skills[2]] },
    ])
  })

  it('keeps catalog order inside a group and sorts groups by localized label', () => {
    const skills = [
      entry({ name: 'z-skill', group: 'team-b' }),
      entry({ name: 'y-skill', group: 'team-a' }),
      entry({ name: 'x-skill', group: 'team-b' }),
    ]

    const groups = groupSkills(skills, labelFor)

    expect(groups.map(group => group.label)).toEqual(['team-a', 'team-b'])
    expect(groups.find(group => group.label === 'team-b')?.skills.map(skill => skill.name))
      .toEqual(['z-skill', 'x-skill'])
  })

  it('breaks label ties by the group key', () => {
    const skills = [
      entry({ name: 'a-skill', group: 'shared' }),
      entry({ name: 'b-skill', source: 'shared' }),
    ]

    const groups = groupSkills(skills, labelFor)

    expect(groups.map(group => group.key)).toEqual(['group:shared', 'source:shared'])
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
