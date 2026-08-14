// Web e2e scenario: the MCP tab in Plugins settings — the settings-managed
// roster with hot enablement switches, the add/edit/remove forms writing
// through to `$DSH_HOME/settings.yaml`, search, and the read-only rows the
// declarative cordis.yml entries produce under an example overlay. Zero model
// calls: everything is client state plus the settings document on a blank
// frame, so there is no fixture and a stray stream would fail loud on the
// open llm seam.
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import { join } from 'node:path'
import {
  assertFixtureInventory, captureStableAria, compareOrRefreshGolden,
  launchWebScaffold, watchConsole, webSnapshotMode, type WebScaffold,
} from './scaffold.ts'
import { ZH_BROWSER_LOCALE, saveFailureShot } from './support.ts'

const SNAPSHOT_DIR = fileURLToPath(new URL('./snapshots/mcp-config', import.meta.url))
const ROSTER_EXPECTED = join(SNAPSHOT_DIR, 'roster.expected.md')
const MODE = webSnapshotMode()

/** The fake stdio command the write-through scenarios add; it never spawns. */
const FAKE_COMMAND = 'dsh-not-a-real-command'

describe('web e2e: MCP settings tab', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>

  beforeAll(async () => {
    scaffold = await launchWebScaffold({})
    browser = await chromium.launch()
    page = await browser.newPage({ viewport: { width: 1680, height: 1000 }, locale: ZH_BROWSER_LOCALE })
    tripwire = watchConsole(page)
    await page.goto(scaffold.baseUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
  }, 120_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
  })

  /** The settings document as the Host has written it so far. */
  async function settingsDocument(): Promise<string> {
    return readFile(join(scaffold.harnessHome, 'settings.yaml'), 'utf8').catch(() => '')
  }

  /**
   * Open the settings dialog on the MCP tab. The scenarios share one page so
   * the settings document accumulates across them, so this leaves any dialog a
   * previous scenario opened closed first — its mask would otherwise swallow
   * the trigger click.
   */
  async function openMcp() {
    if (await page.getByRole('dialog', { name: '设置' }).count() > 0) {
      await page.keyboard.press('Escape')
      await expect.poll(() => page.getByRole('dialog', { name: '设置' }).count(), { timeout: 5_000 }).toBe(0)
    }
    await page.getByRole('button', { name: '设置', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: '设置' })
    await dialog.waitFor({ timeout: 10_000 })
    await dialog.getByRole('button', { name: '插件', exact: true }).click()
    await dialog.getByRole('tab', { name: 'MCP', exact: true }).click()
    await expect
      .poll(() => dialog.getByRole('tab', { name: 'MCP', exact: true }).getAttribute('aria-selected'), { timeout: 5_000 })
      .toBe('true')
    return dialog
  }

  it('renders the empty roster with search and the add entry', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-mcp-config-roster'))
    const dialog = await openMcp()
    await dialog.getByText('还没有 MCP 服务器，点右上角 + 添加。').waitFor({ timeout: 10_000 })
    expect(await dialog.getByRole('searchbox', { name: '搜索 MCP 服务器' }).count()).toBe(1)
    expect(await dialog.getByRole('button', { name: '添加 MCP 服务器' }).count()).toBe(1)

    const snapshot = await captureStableAria(page, '[role="dialog"]', scaffold.workspaceCwd)
    await compareOrRefreshGolden(ROSTER_EXPECTED, snapshot, MODE)
    expect(tripwire.pageErrors).toEqual([])
  }, 60_000)

  it('writes an added stdio server through to settings.yaml', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-mcp-config-add'))
    const dialog = await openMcp()
    await dialog.getByRole('button', { name: '添加 MCP 服务器' }).click()
    await dialog.getByLabel('名称').fill('memory')
    await dialog.getByLabel('命令').fill(FAKE_COMMAND)
    await dialog.getByRole('button', { name: '保存', exact: true }).click()

    await expect
      .poll(async () => (await settingsDocument()).includes('command: ' + FAKE_COMMAND), { timeout: 10_000 })
      .toBe(true)
    await dialog.locator('[data-server-name="memory"]').waitFor({ timeout: 10_000 })
    expect(tripwire.pageErrors).toEqual([])
  }, 60_000)

  it('writes an added http server and filters the roster by name', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-mcp-config-search'))
    const dialog = await openMcp()
    await dialog.getByRole('button', { name: '添加 MCP 服务器' }).click()
    await dialog.getByLabel('名称').fill('web-fetch')
    await dialog.getByRole('radio', { name: 'Streamable HTTP' }).click()
    await dialog.getByLabel('URL').fill('http://localhost:3000/mcp')
    await dialog.getByRole('button', { name: '保存', exact: true }).click()

    await dialog.locator('[data-server-name="web-fetch"]').waitFor({ timeout:10_000 })
    const search = dialog.getByRole('searchbox', { name: '搜索 MCP 服务器' })
    await search.fill('mem')
    await expect.poll(() => dialog.locator('[data-server-name="memory"]').count(), { timeout: 5_000 }).toBe(1)
    expect(await dialog.locator('[data-server-name="web-fetch"]').count()).toBe(0)
    await search.fill('')
    await expect.poll(() => dialog.locator('[data-server-name="web-fetch"]').count(), { timeout: 5_000 }).toBe(1)
    expect(tripwire.pageErrors).toEqual([])
  }, 60_000)

  it('toggles enablement through to settings.yaml', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-mcp-config-toggle'))
    const dialog = await openMcp()
    const toggle = dialog.getByRole('switch', { name: 'memory' })
    await toggle.waitFor({ timeout: 10_000 })

    await toggle.click()
    await expect.poll(async () => (await settingsDocument()).includes('enabled: false'), { timeout: 10_000 })
      .toBe(true)

    await dialog.getByRole('switch', { name: 'memory' }).click()
    await expect.poll(async () => !(await settingsDocument()).includes('enabled: false'), { timeout: 10_000 })
      .toBe(true)
    expect(tripwire.pageErrors).toEqual([])
  }, 60_000)

  it('removes a server through the inline editor down to settings.yaml', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-mcp-config-remove'))
    const dialog = await openMcp()
    const row = dialog.locator('[data-server-name="web-fetch"]')
    await row.waitFor({ timeout: 10_000 })
    await row.getByRole('button', { name: '设置' }).click()
    await dialog.getByRole('button', { name: '删除' }).click()
    await dialog.getByRole('button', { name: '确认删除' }).click()

    await expect.poll(async () => (await settingsDocument()).includes('web-fetch:'), { timeout: 10_000 })
      .toBe(false)
    await expect.poll(() => dialog.locator('[data-server-name="web-fetch"]').count(), { timeout: 10_000 }).toBe(0)
    expect(tripwire.pageErrors).toEqual([])
  }, 60_000)

  it.skipIf(MODE === 'record')('keeps the fixture inventory closed', async () => {
    expect(tripwire.warnings).toEqual([])
    await assertFixtureInventory(SNAPSHOT_DIR, ['roster.expected.md'])
  })
})

describe('web e2e: MCP settings tab declarative rows', () => {
  const MEMORIX_PATCH = fileURLToPath(new URL('../../../examples/mcp-memory/memorix.cordis.yml', import.meta.url))
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>

  beforeAll(async () => {
    scaffold = await launchWebScaffold({ extraOverlayPath: MEMORIX_PATCH })
    browser = await chromium.launch()
    page = await browser.newPage({ viewport: { width: 1680, height: 1000 }, locale: ZH_BROWSER_LOCALE })
    tripwire = watchConsole(page)
    await page.goto(scaffold.baseUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
  }, 120_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
  })

  it('shows the cordis.yml-declared server as a read-only row', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-mcp-config-declarative'))
    await page.getByRole('button', { name: '设置', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: '设置' })
    await dialog.waitFor({ timeout: 10_000 })
    await dialog.getByRole('button', { name: '插件', exact: true }).click()
    await dialog.getByRole('tab', { name: 'MCP', exact: true }).click()

    const row = dialog.locator('[data-server-name="memorix"]')
    await row.waitFor({ timeout: 10_000 })
    expect(await row.getByText('由配置文件管理').count()).toBe(1)
    expect(await row.getByRole('switch', { name: 'memorix' }).isDisabled()).toBe(true)
    expect(await row.getByRole('button', { name: '设置' }).isDisabled()).toBe(true)
    expect(tripwire.pageErrors).toEqual([])
  }, 60_000)
})
