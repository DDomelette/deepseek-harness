/**
 * Guard the Web e2e welcome-notice mirror against drift.
 *
 * `apps/web/tests/scaffold.ts` cannot import the browser package that owns the
 * notice (that would pull its TS project into the Host test graph), so it
 * copies the acknowledgement namespace, field, version, and zh copy. A stale
 * copy silently stops pre-acknowledging the notice, and every browser scenario
 * then waits behind the overlay; this spec turns that failure into one fast,
 * named assertion.
 */

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  WELCOME_NOTICE_ACK_FIELD,
  WELCOME_NOTICE_COPY,
  WELCOME_NOTICE_SETTINGS_NAMESPACE,
  WELCOME_NOTICE_VERSION,
} from '../apps/web/tests/scaffold.ts'

const SOURCE = new URL('../packages/client/ui-settings-models/src/onboarding-copy.ts', import.meta.url)
const LOCALES = new URL('../packages/client/ui-settings-models/src/client/locales.ts', import.meta.url)

/** Decode the backslash escapes a single-quoted TS string literal may carry. */
function decodeEscapes(value: string): string {
  let output = ''
  for (let index = 0; index < value.length; index += 1) {
    const character = value.charAt(index)
    if (character !== '\\') {
      output += character
      continue
    }
    index += 1
    const escaped = value.charAt(index)
    if (escaped === 'n') output += '\n'
    else if (escaped === 't') output += '\t'
    else output += escaped
  }
  return output
}

/** Read one `export const NAME = '<value>'` string literal out of a source file. */
function exportedString(source: string, name: string): string {
  const match = new RegExp(`export const ${name} = '((?:[^'\\\\]|\\\\.)*)'`).exec(source)
  if (match?.[1] === undefined) throw new Error(`no string export ${name}`)
  return decodeEscapes(match[1])
}

/**
 * Read one `key: '<value>'` entry of the zh locale object. The zh block follows
 * the en block in that module, so the search starts at `export const zh`.
 */
function zhLocaleString(source: string, key: string): string {
  const start = source.indexOf('export const zh')
  if (start < 0) throw new Error('no zh locale export')
  const match = new RegExp(`\\n  ${key}: '((?:[^'\\\\]|\\\\.)*)'`).exec(source.slice(start))
  if (match?.[1] === undefined) throw new Error(`no zh locale entry ${key}`)
  return decodeEscapes(match[1])
}

describe('web e2e welcome-notice mirror', () => {
  it('matches the acknowledgement constants and the zh notice copy', () => {
    const source = readFileSync(SOURCE, 'utf8')
    const locales = readFileSync(LOCALES, 'utf8')
    expect(WELCOME_NOTICE_SETTINGS_NAMESPACE).toBe(exportedString(source, 'WELCOME_NOTICE_SETTINGS_NAMESPACE'))
    expect(WELCOME_NOTICE_ACK_FIELD).toBe(exportedString(source, 'WELCOME_NOTICE_ACK_FIELD'))
    expect(WELCOME_NOTICE_VERSION).toBe(exportedString(source, 'WELCOME_NOTICE_VERSION'))
    expect(WELCOME_NOTICE_COPY.zh.title).toBe(zhLocaleString(locales, 'welcomeTitle'))
    expect(WELCOME_NOTICE_COPY.zh.body).toBe(zhLocaleString(locales, 'welcomeBody'))
    expect(WELCOME_NOTICE_COPY.zh.continueLabel).toBe(zhLocaleString(locales, 'welcomeContinue'))
  })
})
