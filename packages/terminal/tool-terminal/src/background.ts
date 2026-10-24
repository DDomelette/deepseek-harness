/**
 * Generic-job adaptation for one terminal send: the pull source `ctx.jobs`
 * pumps, and the consuming operation read it renders.
 *
 * @module @deepseek-ai/dsh-tool-terminal/background
 */

import type { JobOutputSource } from '@deepseek-ai/dsh-jobs'
import type { TerminalSendOperation } from '@deepseek-ai/dsh-terminal'
import { renderSendRead } from './render.ts'

/**
 * The live send operation's output as one registry pull source. The operation
 * read is consuming, so a read drains it and the returned offset is the
 * source's own running total; the backend reports truncation per read, so the
 * record's cursor stays unconsumed and the dropped-output notice travels in the
 * text exactly as a foreground result renders it.
 * @param operation - the started operation, bound lazily because it is created after admission.
 * @returns one source whose read is the operation's next unread output.
 */
export function sendSources(operation: () => TerminalSendOperation | undefined): JobOutputSource[] {
  let offset = 0
  return [{
    read: (fromByte) => {
      const live = operation()
      if (live === undefined) return { text: '', nextOffset: fromByte, lossy: false }
      const text = renderSendRead(live.readOutput())
      offset += Buffer.byteLength(text)
      return { text, nextOffset: offset, lossy: false }
    },
  }]
}
