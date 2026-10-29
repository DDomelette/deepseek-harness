/** Archive instant equality compares map contents independently of Session identity lists. */
import { describe, expect, it } from 'vitest'
import { sameArchiveInstants } from '../src/archive-instants.ts'

const first = '2026-10-17T00:00:00.000Z'
const second = '2026-10-18T00:00:00.000Z'
const cases: Array<{ label: string; left: Record<string, string>; right: Record<string, string>; equal: boolean }> = [
  { label: 'empty maps', left: {}, right: {}, equal: true },
  { label: 'removed identity', left: { one: first }, right: {}, equal: false },
  { label: 'added identity', left: {}, right: { one: first }, equal: false },
  { label: 'different identities', left: { one: first }, right: { two: first }, equal: false },
  { label: 'restamped identity', left: { one: first }, right: { one: second }, equal: false },
  { label: 'different insertion order', left: { one: first, two: second }, right: { two: second, one: first }, equal: true },
]

describe('sameArchiveInstants', () => {
  it.each(cases)('compares $label', ({ left, right, equal }) => {
    expect(sameArchiveInstants(left, right)).toBe(equal)
  })
})
