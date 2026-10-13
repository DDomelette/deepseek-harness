/** Web-localized copy for the four shipped presets and declaration copy for every other row. */

import { describe, expect, it } from 'vitest'
import { en, presetDisplayText, zh } from '../src/client/locales.ts'

const translate = (bundle: typeof en) => (key: keyof typeof en): string => bundle[key]

describe('preset display copy', () => {
  it.each([
    ['standard', 'presetStandardName', 'presetStandardDescription'],
    ['ptc', 'presetPtcName', 'presetPtcDescription'],
    ['minimal', 'presetMinimalName', 'presetMinimalDescription'],
    ['cordis', 'presetCordisName', 'presetCordisDescription'],
  ] as const)('localizes the shipped %s preset in English and Chinese', (id, nameKey, descriptionKey) => {
    // A shipped preset publishes no display metadata: the dictionaries own it.
    const preset = { id }

    expect(presetDisplayText(preset, translate(en)))
      .toEqual({ name: en[nameKey], description: en[descriptionKey] })
    expect(presetDisplayText(preset, translate(zh)))
      .toEqual({ name: zh[nameKey], description: zh[descriptionKey] })
  })

  it('keeps declaration metadata for every preset that names itself', () => {
    const ownCopy = { name: '我的标准', description: '团队自己的 preset。' }

    expect(presetDisplayText({ id: 'standard', ...ownCopy }, translate(en)))
      .toEqual(ownCopy)
    expect(presetDisplayText({ id: 'deployment-extra', ...ownCopy }, translate(en)))
      .toEqual(ownCopy)
    expect(presetDisplayText({ id: 'bare' }, translate(en)))
      .toEqual({ name: 'bare' })
  })
})
