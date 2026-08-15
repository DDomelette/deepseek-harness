/**
 * Pre-step admission for canonical session-reference mentions.
 * @module @deepseek-ai/dsh-session-reference-admission
 */

import type { Context } from '@deepseek-ai/cordis'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'session-reference-admission'

/** The resolver whose snapshots this plugin admits into pre-step decisions. */
export const inject = ['sessionReferenceResolver']

/** Host plugin body — the pre-step listener lands in Task 2. */
export function apply(_ctx: Context): void {}
