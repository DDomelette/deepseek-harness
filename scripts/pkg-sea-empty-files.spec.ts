/** Execute the patched SEA reader without mounting its process-global filesystem. */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { runInNewContext } from 'node:vm'
import { brotliCompressSync, brotliDecompressSync, gzipSync, gunzipSync, zstdCompressSync, zstdDecompressSync } from 'node:zlib'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const pkgManifest = require.resolve('@yao-pkg/pkg/package.json')
const prelude = join(dirname(pkgManifest), 'prelude')
const vfs = createRequire(pkgManifest)('@roberts_lando/vfs') as { readonly MemoryProvider: unknown }
const bundled = readFileSync(join(prelude, 'sea-bootstrap.bundle.js'), 'utf8')
const embeddedWorker = workerSource(bundled)
const carriers = [
  { name: 'source', source: readFileSync(join(prelude, 'sea-vfs-setup.js'), 'utf8') },
  { name: 'main bootstrap', source: bundled },
  { name: 'worker bootstrap', source: embeddedWorker },
]

type Inflate = (input: Uint8Array, options: { maxOutputLength: number }) => Buffer
interface Codec {
  readonly name: string
  readonly compression: number
  readonly pack: (input: Uint8Array) => Buffer
  readonly unpack: Inflate | null
}
const codecs: readonly Codec[] = [
  { name: 'uncompressed', compression: 0, pack: input => Buffer.from(input), unpack: null },
  { name: 'gzip', compression: 1, pack: gzipSync, unpack: gunzipSync },
  { name: 'brotli', compression: 2, pack: brotliCompressSync, unpack: brotliDecompressSync },
  { name: 'zstd', compression: 3, pack: zstdCompressSync, unpack: zstdDecompressSync },
]

interface Manifest {
  compression: number
  directories: Record<string, unknown>
  symlinks: Record<string, string>
  offsets: Record<string, [number, number]>
  stats: Record<string, { size: number }>
}
interface Reader {
  readFileSync(path: string): Buffer
  readFileSync(path: string, encoding: 'utf8'): string
}
type ReaderConstructor = new (manifest: Manifest) => Reader
const file = '/fixture/content'

describe.each(carriers)('SEA empty files: $name', ({ source }) => {
  it.each(codecs)('reads an empty $name entry as bytes and text', (codec) => {
    const reader = createReader(source, codec, Buffer.alloc(0), 0)
    expect(reader.readFileSync(file)).toEqual(Buffer.alloc(0))
    expect(reader.readFileSync(file, 'utf8')).toBe('')
  })

  it.each(codecs)('preserves a nonempty $name entry', (codec) => {
    const reader = createReader(source, codec, Buffer.from('abc'), 3)
    expect(reader.readFileSync(file)).toEqual(Buffer.from('abc'))
  })

  it.each(codecs.filter(codec => codec.unpack !== null))('rejects bytes in a declared-empty $name entry', (codec) => {
    const reader = createReader(source, codec, Buffer.from('x'), 0)
    expect(() => reader.readFileSync(file)).toThrow('non-empty data for empty file')
  })
})

function createReader(source: string, codec: Codec, data: Buffer, size: number): Reader {
  const archive = codec.pack(data)
  const expression = providerClass(source)
  const shared = { pickDecompressorSync: () => codec.unpack }
  const perf = { start() {}, end() {}, count() {} }
  // The dependency's private class has no published type; only its read API is used here.
  const Provider = runInNewContext('(' + expression + ')', {
    MemoryProvider: vfs.MemoryProvider,
    Buffer,
    COMPRESS_NONE: 0,
    MAX_SYMLINK_DEPTH: 40,
    shared, shared2: shared,
    sea: { getRawAsset: () => archive },
    perf, perf2: perf,
    toManifestKey: (path: string) => path,
  }) as unknown as ReaderConstructor
  return new Provider({
    compression: codec.compression,
    directories: {}, symlinks: {},
    offsets: { [file]: [0, archive.length] },
    stats: { [file]: { size } },
  })
}

function providerClass(source: string): string {
  const ast = ts.createSourceFile('sea.js', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)
  let found: string | undefined
  const visit = (node: ts.Node): void => {
    if (ts.isClassDeclaration(node) && node.name?.text === 'SEAProvider') found = node.getText(ast)
    else if (ts.isVariableDeclaration(node) && node.name.getText(ast) === 'SEAProvider'
      && node.initializer !== undefined && ts.isClassExpression(node.initializer)) found = node.initializer.getText(ast)
    ts.forEachChild(node, visit)
  }
  visit(ast)
  if (found === undefined) throw new Error('Installed pkg bootstrap has no SEAProvider')
  return found
}

function workerSource(source: string): string {
  const ast = ts.createSourceFile('bundle.js', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)
  let found: string | undefined
  const visit = (node: ts.Node): void => {
    if (ts.isStringLiteral(node) && node.text.includes('class extends MemoryProvider') && node.text.includes('maxOutputLength')) found = node.text
    ts.forEachChild(node, visit)
  }
  visit(ast)
  if (found === undefined) throw new Error('Installed pkg bootstrap has no embedded worker source')
  return found
}
