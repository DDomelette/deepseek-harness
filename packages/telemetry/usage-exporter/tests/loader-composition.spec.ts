import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parse as parseYaml } from 'yaml'

const patchPath = fileURLToPath(new URL('../../../bundle/web-app/cordis.patch.yml', import.meta.url))

describe('usage-exporter shipped composition', () => {
  it('ships as a disabled web-app entry', async () => {
    const patch = parseYaml(await readFile(patchPath, 'utf8')) as Array<{
      id?: string
      name?: string
      disabled?: boolean
      insert?: Array<{ id?: string; name?: string; disabled?: boolean }>
    }>
    const rows = patch.flatMap(row => row.insert ?? [row])
    const entry = rows.find(row => row.id === 'usage-exporter')
    expect(entry).toEqual({
      id: 'usage-exporter',
      name: '@deepseek-ai/dsh-usage-exporter',
      disabled: true,
    })
  })
})
