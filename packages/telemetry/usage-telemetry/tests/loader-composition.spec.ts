import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { LOADER_SMOKE_TEST_TIMEOUT_MS, runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'

const driver = fileURLToPath(new URL(
  '../../../../examples/headless-agent/tests/fixtures/telemetry/usage-telemetry/driver.ts',
  import.meta.url,
))
const configPath = fileURLToPath(new URL(
  '../../../../examples/headless-agent/tests/fixtures/telemetry/usage-telemetry/cordis.yml',
  import.meta.url,
))
const repoTsconfig = fileURLToPath(new URL('../../../../tsconfig.json', import.meta.url))

interface UsageRow {
  v: number
  time: number
  sessionId: string
  cwd: string
  model: string
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
}

async function inspectUsage(cwd: string): Promise<UsageRow> {
  const telemetryDir = join(cwd, '.dsh', 'telemetry')
  const files = (await readdir(telemetryDir)).filter(file => /^usage-.*\.jsonl$/.test(file))
  expect(files).toHaveLength(1)

  const lines = (await readFile(join(telemetryDir, files[0] as string), 'utf8'))
    .split(/\r?\n/)
    .filter(line => line.length > 0)
  expect(lines).toHaveLength(1)
  return JSON.parse(lines[0] as string) as UsageRow
}

describe('usage telemetry through a real headless cordis.yml', () => {
  it('writes the streamed usage after the Loader tree has disposed', async () => {
    let row!: UsageRow
    let cwd!: string
    const { stderr } = await runLoaderSmoke({
      label: 'usage telemetry loader smoke',
      tempDirPrefix: 'usage-telemetry-loader-',
      binScript: driver,
      libBinScript: driver,
      configPath,
      tsconfigPath: repoTsconfig,
      inspect: async (fixtureCwd) => {
        cwd = fixtureCwd
        row = await inspectUsage(fixtureCwd)
      },
    })

    expect(stderr).not.toContain('UNHANDLED')
    expect(row).toEqual({
      v: 1,
      time: row.time,
      sessionId: row.sessionId,
      cwd,
      model: 'usage-telemetry-mock-model',
      inputTokens: 11,
      outputTokens: 7,
      cacheReadTokens: 3,
      cacheWriteTokens: 2,
    })
    expect(typeof row.sessionId).toBe('string')
    expect(row.sessionId.length).toBeGreaterThan(0)
    expect(Number.isSafeInteger(row.time)).toBe(true)
    expect(row.time).toBeGreaterThanOrEqual(Date.UTC(2000, 0, 1))
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)
})
