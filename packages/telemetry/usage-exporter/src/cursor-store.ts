/** Durable tail cursor for the usage telemetry files. */

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

export interface FileCursor { offset: number }
interface CursorState { version: 1; files: Record<string, FileCursor> }
interface RawCursorState { version?: unknown; files?: unknown }

export class CursorStore {
  private state: CursorState = { version: 1, files: {} }

  constructor(private readonly path: string) {}

  async load(): Promise<void> {
    try {
      const parsed = JSON.parse(await readFile(this.path, 'utf8')) as RawCursorState
      if (parsed.version !== 1 || typeof parsed.files !== 'object' || parsed.files === null) return
      const files: Record<string, FileCursor> = {}
      for (const [file, value] of Object.entries(parsed.files as Record<string, unknown>)) {
        if (typeof file !== 'string' || file.length === 0) continue
        if (typeof value !== 'object' || value === null) continue
        const offset = (value as { offset?: unknown }).offset
        if (typeof offset !== 'number' || !Number.isSafeInteger(offset) || offset < 0) continue
        files[file] = { offset }
      }
      this.state = { version: 1, files }
    } catch {
      // A malformed cursor is recoverable state: start from an empty cursor
      // rather than letting one damaged file strand the exporter.
      this.state = { version: 1, files: {} }
    }
  }

  get(file: string): FileCursor | undefined {
    return this.state.files[file]
  }

  set(file: string, cursor: FileCursor): void {
    this.state.files[file] = cursor
  }

  prune(files: ReadonlySet<string>): void {
    const kept: Record<string, FileCursor> = {}
    for (const file of Object.keys(this.state.files)) {
      const cursor = this.state.files[file]
      if (files.has(file) && cursor !== undefined) kept[file] = cursor
    }
    this.state = { ...this.state, files: kept }
  }

  async save(): Promise<void> {
    const temp = `${this.path}.tmp`
    await mkdir(dirname(this.path), { recursive: true })
    await writeFile(temp, JSON.stringify(this.state), 'utf8')
    await rename(temp, this.path)
  }
}
