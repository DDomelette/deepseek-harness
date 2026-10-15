/**
 * The paged and complete-byte reads this type performs, bound to the Client Remote.
 *
 * Content is the consumer's business: the `file` resource carries metadata only,
 * so the text arrives here one page of lines at a time and a whole document or
 * one related asset arrives as bytes. The endpoint takes a session and a
 * workspace path while a tab carries a `dsh-resource://file/` session address,
 * so this module also owns that translation.
 */
import type { RemoteResult } from '@deepseek-ai/dsh-api-remotes/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {
  WorkspaceByteReadOptions,
  WorkspaceFileBytes,
  WorkspaceFileRange,
  WorkspaceFileText,
} from '@deepseek-ai/dsh-api-workspace-files/types'
import { parseFileAddress } from '@deepseek-ai/dsh-util-workspace-path'

/** The slice of the Client Remote this package calls. */
export interface WorkspaceFilesReadRemote {
  readonly workspaceFiles: {
    /**
     * Read one page of lines.
     * @param sessionId - the session whose workspace resolves `path`.
     * @param path - workspace path, absolute or relative to the workspace root.
     * @param range - 1-based start line; the Host's page cap applies when `limit` is absent.
     * @param signal - cancels the call.
     * @returns the page, or the failure the Host declares.
     */
    read(
      sessionId: SessionId,
      path: string,
      range: WorkspaceFileRange,
      signal?: AbortSignal,
    ): Promise<RemoteResult<WorkspaceFileText>>
    /**
     * Read a complete file, or one byte window of it, without text decoding.
     * @param sessionId - the session whose workspace resolves `path`.
     * @param path - target path, absolute or workspace-relative; resolved from `options.baseFile`'s directory when provided.
     * @param options - optional base file and byte range; without a range the Host's complete-file cap applies.
     * @param signal - cancels the call.
     * @returns the file's native bytes with its version, byte offset, and EOF marker, or the failure the Host declares.
     */
    readBytes(
      sessionId: SessionId,
      path: string,
      options: WorkspaceByteReadOptions,
      signal?: AbortSignal,
    ): Promise<RemoteResult<WorkspaceFileBytes>>
  }
}

/**
 * The read one page performs, injected so the face stays host-free.
 *
 * The session travels with the call because the endpoint resolves the workspace
 * root from it: the same path means different files in different sessions. A
 * Remote call does not reject: the result carries the failure.
 */
export type ReadWorkspaceFilePage = (
  sessionId: SessionId,
  path: string,
  offset: number,
  signal: AbortSignal,
) => Promise<RemoteResult<WorkspaceFileText>>

/** The file one tab reads: the session the read runs under and the path handed to the Host. */
export interface SessionFile {
  /** The Session whose workspace resolves relative paths. */
  readonly sessionId: SessionId
  /** The path the Host receives, absolute or relative to the addressed Session's workspace. */
  readonly path: string
}

/**
 * The session and path one `dsh-resource://file/…` address names.
 *
 * A `session` address names its own session and a relative or absolute path, so
 * a tab addressed into another session reads from that session. An `absolute`
 * address carries no session and cannot be read here. The registry routes only
 * session-scoped `file` addresses to this type, so an address `parseFileAddress`
 * rejects or that carries no session is a programming error and throws.
 * @param address - a tab's `dsh-resource://file/…` address.
 * @returns the session and the path to hand the endpoint.
 */
export function hostFileOf(address: string): SessionFile {
  const parsed = parseFileAddress(address)
  if (parsed?.scope !== 'session') throw new Error(`ui-sidebar-documentpreview: not a session file address "${address}"`)
  // The address is a string boundary: its id segment is the Session id it names.
  return { sessionId: parsed.sessionId as SessionId, path: parsed.path }
}

/**
 * Bind the paged read to one Remote face. The page length is the Host's
 * configured cap, so no `limit` travels.
 * @param remote - the Client Remote carrying the `workspaceFiles` namespace.
 * @returns the read the face performs.
 */
export function createReadPage(remote: WorkspaceFilesReadRemote): ReadWorkspaceFilePage {
  return (sessionId, path, offset, signal) => remote.workspaceFiles.read(sessionId, path, { offset }, signal)
}

/** Complete document bytes borrowed read-only by renderers; copy before transferring to a Worker. */
export type DocumentFileBytes = WorkspaceFileBytes<Uint8Array<ArrayBuffer>>

/**
 * Read a complete file through the Host endpoint.
 * @param file - Session and path decoded from the tab address.
 * @param signal - owning tab lifetime.
 * @returns complete wire bytes, including declared failures.
 */
export type ReadDocumentBytes = (file: SessionFile, signal: AbortSignal) => Promise<RemoteResult<WorkspaceFileBytes>>

/**
 * Bind the complete-file read to one Remote face. The related-asset reader
 * passes the document as `baseFile`, so the Host resolves a relative reference
 * from that file's own directory.
 * @param remote - the Client Remote carrying the `workspaceFiles` namespace.
 * @returns the read the face performs.
 */
export function createReadBytes(remote: WorkspaceFilesReadRemote): ReadDocumentBytes {
  return (file, signal) => remote.workspaceFiles.readBytes(file.sessionId, file.path, {}, signal)
}

/**
 * Accept one successful Remote byte result for document renderers.
 * @param file - Host byte result carrying the file's native bytes.
 * @returns the same metadata with bytes narrowed to a transferable buffer.
 * @throws TypeError when the wire carried something other than bytes.
 */
export function documentFileBytes(file: WorkspaceFileBytes): DocumentFileBytes {
  // The Remote result is a wire boundary, and a test realm's `Uint8Array` is
  // not this program's: accept any byte view instead of one realm's class.
  if (!ArrayBuffer.isView(file.data)) {
    throw new TypeError('ui-sidebar-documentpreview: remote file result carries no byte array')
  }
  return file as DocumentFileBytes
}
