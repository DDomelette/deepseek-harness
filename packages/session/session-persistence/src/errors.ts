/**
 * Session-persistence error vocabulary owned by the seam package.
 * @module @deepseek-ai/dsh-session-persistence/errors
 */

import type { SessionId } from '@deepseek-ai/dsh-session'

/** A delete requested an id this backend neither tracks nor has stored. */
export class SessionPersistenceNotFoundError extends Error {
  constructor(readonly sessionId: SessionId) {
    super(`session "${sessionId}" not found`)
    this.name = 'SessionPersistenceNotFoundError'
  }
}
