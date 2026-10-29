/** Composer coarse-pointer floor contract: the InputBar 44px minimum must not
 *  inflate the attachment chrome's drawn badge sizes; touch targets move to
 *  transparent hit zones instead. */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const composerCss = readFileSync(fileURLToPath(new URL('../src/client/ComposerAttachments.module.css', import.meta.url)), 'utf8')
const fileCardCss = readFileSync(fileURLToPath(new URL('../src/FileCard.module.css', import.meta.url)), 'utf8')
const railCss = readFileSync(fileURLToPath(new URL('../src/AttachmentRail.module.css', import.meta.url)), 'utf8')

describe('composer touch-floor opt-outs', () => {
  it('keeps the image remove badge at its drawn 18px under the composer floor', () => {
    // InputBar's floor is `.root button` (one class + one element); the
    // exemption must carry two class selectors to outrank it.
    expect(composerCss).toMatch(/@media \(pointer: coarse\) \{\s*\.rail \.remove\s*\{\s*min-width: 18px;\s*min-height: 18px;\s*}/)
  })

  it('carries a 44px transparent hit zone on the image remove badge', () => {
    expect(composerCss).toMatch(/\.rail \.remove::after\s*\{\s*content: '';\s*position: absolute;\s*inset: -13px;\s*}/)
  })

  it('keeps the file-card remove badge at its drawn 18px', () => {
    expect(fileCardCss).toMatch(/@media \(pointer: coarse\) \{\s*\.card \.remove\s*\{\s*min-width: 18px;\s*min-height: 18px;\s*}/)
  })

  it('carries a 44px transparent hit zone on the file-card remove badge', () => {
    expect(fileCardCss).toMatch(/\.card \.remove::after\s*\{\s*content: '';\s*position: absolute;\s*inset: -13px;\s*}/)
  })

  it('restores the inline retry text button to its natural size', () => {
    // A 44px minimum on the 15px-tall inline retry text would overflow the
    // 64px-tall card.
    expect(fileCardCss).toMatch(/\.card \.retry\s*\{\s*min-width: 0;\s*min-height: 0;\s*}/)
  })

  it('keeps the rail paging arrows at their drawn 24px', () => {
    expect(railCss).toMatch(/@media \(pointer: coarse\) \{\s*\.root \.arrow\s*\{\s*min-width: 24px;\s*min-height: 24px;\s*}/)
  })

  it('carries a 44px transparent hit zone on each paging arrow', () => {
    expect(railCss).toMatch(/\.root \.arrow::after\s*\{\s*content: '';\s*position: absolute;\s*inset: -10px;\s*}/)
  })
})
