// Web e2e scenario: the Skills settings panel — the real host serves the
// complete catalog for the current session's composition (`skill.catalog`), grouped by declared
// group with source fallback, and toggling a skill writes the `skills`
// settings namespace through the revision-guarded seam. The effective
// disablement is asserted end-to-end through the composer's slash menu (the
// same host registry override the model catalog reads). No model call is
// issued, so a stray stream fails loud on the open LLM seam.
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import {
  assertFixtureInventory,
  captureStableAria,
  compareOrRefreshGolden,
  launchWebScaffold,
  watchConsole,
  webSnapshotMode,
  type WebScaffold,
} from './scaffold.ts'
import { connectFreshWorkspace, newEnglishPage, saveFailureShot } from './support.ts'

const SNAPSHOT_DIR = fileURLToPath(new URL('./snapshots/skills-settings', import.meta.url))
const GRID_EXPECTED = join(SNAPSHOT_DIR, 'grid.expected.md')
const GROUP_EXPECTED = join(SNAPSHOT_DIR, 'group.expected.md')
const MODE = webSnapshotMode()

interface SeedSkill {
  name: string
  description: string
  frontmatter: string
}

const SKILLS: readonly SeedSkill[] = [
  { name: 'panel-grouped-a', description: 'Panel grouped A', frontmatter: 'group: superpowers\n' },
  {
    name: 'panel-grouped-b',
    description: 'Panel grouped B',
    frontmatter: 'group: superpowers\ndisable-model-invocation: true\n',
  },
  { name: 'panel-solo', description: 'Panel solo', frontmatter: '' },
]

/** The scaffold's user-skill root: `skill.catalog` lists it through the current session's composition. */
async function seedSkills(scaffold: WebScaffold): Promise<void> {
  for (const skill of SKILLS) {
    const directory = join(scaffold.harnessHome, 'skills', skill.name)
    await mkdir(directory, { recursive: true })
    await writeFile(join(directory, 'SKILL.md'), [
      '---',
      `name: ${skill.name}`,
      `description: ${skill.description}`,
      ...skill.frontmatter === '' ? [] : skill.frontmatter.trimEnd().split('\n'),
      '---',
      '',
      `# ${skill.name}`,
      '',
    ].join('\n'))
  }
}

describe('web e2e: skills settings panel', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>

  beforeAll(async () => {
    scaffold = await launchWebScaffold({})
    await seedSkills(scaffold)
    browser = await chromium.launch()
    page = await newEnglishPage(browser)
    tripwire = watchConsole(page)
    await page.goto(scaffold.baseUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
    await connectFreshWorkspace(page, scaffold.workspaceCwd)
  }, 120_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
  })

  it('groups the catalog by declared group with source fallback, and a toggle disables a skill end-to-end', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-skills-settings'))
    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Settings' })
    await dialog.waitFor({ timeout: 10_000 })
    await dialog.getByRole('button', { name: 'Skills' }).click()
    await dialog.getByRole('heading', { name: 'Skills', exact: true }).waitFor({ timeout: 10_000 })

    // One icon per group: the declared superpowers group plus the user-dsh
    // source fallback group, each wearing its count.
    const superpowersIcon = dialog.getByRole('button', { name: /superpowers/ })
    await superpowersIcon.waitFor({ timeout: 10_000 })
    expect(await superpowersIcon.textContent()).toContain('2 skills')
    const userSkillsIcon = dialog.getByRole('button', { name: /User skills/ })
    expect(await userSkillsIcon.textContent()).toContain('1 skill')
    const grid = await captureStableAria(page, '[role="dialog"]', scaffold.workspaceCwd)
    await compareOrRefreshGolden(GRID_EXPECTED, grid, MODE)

    // Drill into the declared group: both skills, the user-only marker, and
    // per-skill switches reflecting the effective disabled state.
    await superpowersIcon.click()
    await dialog.getByRole('heading', { name: 'superpowers' }).waitFor({ timeout: 10_000 })
    await expect.poll(() => dialog.getByText('panel-grouped-a').count(), { timeout: 10_000 }).toBe(1)
    await expect.poll(() => dialog.getByText('panel-grouped-b').count(), { timeout: 10_000 }).toBe(1)
    expect(await dialog.getByText('User-only').count()).toBe(1)
    const group = await captureStableAria(page, '[role="dialog"]', scaffold.workspaceCwd)
    await compareOrRefreshGolden(GROUP_EXPECTED, group, MODE)

    // Toggle panel-grouped-a off: the write lands in settings.yaml and the
    // page reload reflects the new effective state.
    const row = dialog.locator('li', { hasText: 'panel-grouped-a' })
    const toggle = row.getByRole('switch')
    expect(await toggle.getAttribute('aria-checked')).toBe('true')
    await toggle.click()
    // The write reloads the page; the full-suite lane is slow, so the poll
    // waits for the reload to settle rather than racing it.
    await expect.poll(
      () => row.getByRole('switch').getAttribute('aria-checked'),
      { timeout: 30_000 },
    ).toBe('false')
    const document = await readFile(join(scaffold.harnessHome, 'settings.yaml'), 'utf8')
    expect(document).toContain('disabled:')
    expect(document).toContain('panel-grouped-a')

    // The effective disablement reaches the user invocation surface: the
    // composer's slash menu serves the disabled skill no longer, while its
    // enabled sibling and the source-grouped skill stay listed.
    await dialog.getByRole('button', { name: 'Close' }).click()
    await expect.poll(() => page.getByRole('dialog', { name: 'Settings' }).count(), { timeout: 5_000 }).toBe(0)
    const input = page.locator('textarea').first()
    await input.fill('/panel-grouped')
    const menu = page.getByRole('listbox', { name: 'Trigger suggestions' })
    await expect.poll(
      () => menu.getByRole('option', { name: /panel-grouped-b/ }).count(),
      { timeout: 10_000 },
    ).toBe(1)
    expect(await menu.getByRole('option', { name: /panel-grouped-a/ }).count()).toBe(0)
    await input.fill('/panel-solo')
    await expect.poll(
      () => menu.getByRole('option', { name: /panel-solo/ }).count(),
      { timeout: 10_000 },
    ).toBe(1)

    expect(tripwire.pageErrors).toEqual([])
    expect(tripwire.warnings).toEqual([])
    await assertFixtureInventory(SNAPSHOT_DIR, ['grid.expected.md', 'group.expected.md'])
  }, 60_000)
})
