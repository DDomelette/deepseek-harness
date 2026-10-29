/** Notes events available to a Remote Event assembly. */
type NotesRemoteEvent = 'notes/material-settled'

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface TypertRemoteEventSelection extends
    Record<NotesRemoteEvent, true> {}
}

export {}
