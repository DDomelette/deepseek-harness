// Web e2e scenario: the settings shell at a handset viewport, touch-emulated so
// the coarse-pointer rules are live. Below the single-pane breakpoint the panel
// fills the screen and shows one pane at a time — the section list first, then
// the chosen section with a way back — so the section content keeps a readable
// column instead of the character-wide strip a phone-width two-column split
// leaves it.
// Zero model calls: the settings shell is pure client state on a blank frame,
// so there is no fixture and a stray stream would fail loud on the open llm
// seam.
import type { Browser, Locator, Page } from 'playwright'
import { chromium, webkit } from 'playwright'
import { afterAll, afterEach, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import { launchWebScaffold, watchConsole, type WebScaffold } from './scaffold.ts'
import { revealNavigationDrawer, ZH_BROWSER_LOCALE, saveFailureShot } from './support.ts'

/** A handset viewport: below the panel's 768px single-pane breakpoint. */
const HANDSET = { width: 390, height: 844 }
/** The viewport the two-column layout is specified for. */
const DESKTOP = { width: 1680, height: 1000 }

/**
 * Open Settings through the account launcher, revealing the handset drawer when needed.
 * @param page - the scenario page.
 */
async function openSettings(page: Page): Promise<void> {
  await revealNavigationDrawer(page, 'zh')
  await page.getByRole('button', { name: '账号菜单', exact: true }).click()
  await page.getByRole('menuitem', { name: '设置', exact: true }).click()
}

/** Open the shipped generic settings fields on the Plugins page.
 * @param page - a page outside the Settings dialog.
 * @returns the plugin panel containing the form.
 */
async function openWebSearchFields(page: Page): Promise<Locator> {
  await revealNavigationDrawer(page, 'zh')
  await page.getByRole('navigation', { name: '全局面板' }).getByRole('button', { name: '插件', exact: true }).click()
  const panel = page.locator('[data-plugin-panel]')
  await panel.getByRole('button', { name: '查看 网页搜索与获取', exact: true }).click()
  await panel.locator('#plugin-config-web-search-count').waitFor({ timeout: 10_000 })
  return panel
}

/**
 * Assert that every native select the open settings dialog renders clears the
 * 44px touch-target floor. A pane that renders none fails here rather than
 * passing without measuring anything.
 * @param dialog - the open settings dialog.
 */
async function expectSelectTouchTargets(dialog: Locator): Promise<void> {
  const selects = dialog.locator('select')
  const count = await selects.count()
  expect(count).toBeGreaterThan(0)
  for (let index = 0; index < count; index += 1) {
    const height = (await selects.nth(index).boundingBox())?.height ?? 0
    expect(height, `select ${String(index)}`).toBeGreaterThanOrEqual(44)
  }
}

describe('web e2e: settings at a handset viewport', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>

  beforeAll(async () => {
    scaffold = await launchWebScaffold({})
    browser = await chromium.launch()
    // Touch emulation is the coarse pointer every 44px target rule is written
    // under, and only a context can set it.
    const context = await browser.newContext({
      viewport: HANDSET,
      hasTouch: true,
      locale: ZH_BROWSER_LOCALE,
      timezoneId: 'Asia/Shanghai',
    })
    page = await context.newPage()
    tripwire = watchConsole(page)
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
  }, 120_000)

  afterEach(async () => {
    await page.setViewportSize(HANDSET)
    await page.emulateMedia({ reducedMotion: 'no-preference', colorScheme: 'light' })
    if (await page.getByRole('menu').count() > 0) await page.keyboard.press('Escape')
    const dialog = page.getByRole('dialog', { name: '设置' })
    if (await dialog.count() > 0) await dialog.getByRole('button', { name: '关闭' }).click()
  })

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
  })

  it('anchors the account menu above its handset drawer trigger', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-account-menu-handset'))
    for (const width of [320, HANDSET.width, 767]) {
      await page.setViewportSize({ width, height: HANDSET.height })
      await page.emulateMedia({ colorScheme: width === 320 ? 'dark' : 'light' })
      await revealNavigationDrawer(page, 'zh')
      const trigger = page.getByRole('button', { name: '账号菜单', exact: true })
      await trigger.click()
      const menu = page.getByRole('menu')
      await menu.waitFor({ state: 'visible' })
      const anchorBox = await trigger.boundingBox()
      const menuBox = await menu.boundingBox()
      expect(anchorBox).not.toBeNull()
      expect(menuBox).not.toBeNull()
      expect(menuBox!.x).toBe(Math.max(12, anchorBox!.x))
      expect(menuBox!.y + menuBox!.height).toBeLessThanOrEqual(anchorBox!.y - 3)
      expect(menuBox!.x).toBeGreaterThanOrEqual(12)
      expect(menuBox!.x + menuBox!.width).toBeLessThanOrEqual(width - 12)

      await page.locator('[data-drawer-scrim]').click({ position: { x: width - 12, y: 300 } })
      await expect.poll(() => menu.count()).toBe(0)
      await revealNavigationDrawer(page, 'zh')
      await trigger.click()
      await menu.waitFor({ state: 'visible' })
      await page.keyboard.press('Escape')
      await expect.poll(() => menu.count()).toBe(0)
      await expect.poll(() => trigger.evaluate(element => element === document.activeElement)).toBe(true)
    }
    expect(tripwire.pageErrors).toEqual([])
  })

  it('anchors the account menu above its handset trigger in WebKit', async () => {
    const webkitBrowser = await webkit.launch()
    try {
      const context = await webkitBrowser.newContext({ viewport: HANDSET, hasTouch: true, locale: ZH_BROWSER_LOCALE })
      const webkitPage = await context.newPage()
      onTestFailed(() => saveFailureShot(webkitPage, 'web-e2e-account-menu-handset-webkit'))
      const errors = watchConsole(webkitPage)
      await webkitPage.goto(scaffold.authenticatedUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 })
      await webkitPage.waitForSelector('[class*="frame"]', { timeout: 30_000 })
      await revealNavigationDrawer(webkitPage, 'zh')
      const trigger = webkitPage.getByRole('button', { name: '账号菜单', exact: true })
      await trigger.click()
      const menu = webkitPage.getByRole('menu')
      await menu.waitFor({ state: 'visible' })
      const anchorBox = await trigger.boundingBox()
      const menuBox = await menu.boundingBox()
      expect(anchorBox).not.toBeNull()
      expect(menuBox).not.toBeNull()
      expect(menuBox!.y + menuBox!.height).toBeLessThanOrEqual(anchorBox!.y - 3)
      expect(menuBox!.x).toBe(Math.max(12, anchorBox!.x))
      await webkitPage.keyboard.press('Escape')
      await expect.poll(() => menu.count()).toBe(0)
      await trigger.click()
      await menu.waitFor({ state: 'visible' })
      await webkitPage.getByRole('menuitem', { name: '设置', exact: true }).click()
      expect(await webkitPage.getByRole('dialog', { name: '设置' }).count()).toBe(1)
      expect(errors.pageErrors).toEqual([])
    } finally {
      await webkitBrowser.close()
    }
  })

  it('keeps general settings selectors beside their triggers without CSS anchor positioning', async () => {
    const legacyBrowser = await chromium.launch()
    try {
      const context = await legacyBrowser.newContext({ viewport: HANDSET, hasTouch: true, locale: ZH_BROWSER_LOCALE })
      const legacyPage = await context.newPage()
      onTestFailed(() => saveFailureShot(legacyPage, 'web-e2e-settings-menu-without-css-anchors'))
      await legacyPage.addInitScript(() => {
        const supports = CSS.supports.bind(CSS)
        CSS.supports = (property: string, value?: string) => {
          const declaration = `${property} ${value ?? ''}`
          if (declaration.includes('position-anchor') || declaration.includes('anchor(') || declaration.includes('anchor-size(')) return false
          return value === undefined ? supports(property) : supports(property, value)
        }
      })
      await legacyPage.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
      // Replace the declarations an engine without CSS Anchor Positioning drops;
      // the component's compatibility placement still applies as inline styles.
      await legacyPage.addStyleTag({ content: `[data-anchor-side][data-anchor-side] {
        top: auto; bottom: 12px; left: 12px; right: 12px;
      }` })
      await legacyPage.waitForSelector('[class*="frame"]', { timeout: 30_000 })
      await openSettings(legacyPage)
      const dialog = legacyPage.getByRole('dialog', { name: '设置' })
      await dialog.getByRole('button', { name: '通用设置' }).click()

      for (const [initial, selected] of [['回答结束后', '下次有新消息时'], ['排队发送', '插话发送']] as const) {
        const trigger = dialog.getByRole('button', { name: initial, exact: true })
        await trigger.click()
        const menu = legacyPage.getByRole('menu')
        await menu.waitFor({ state: 'visible' })
        const triggerBox = await trigger.boundingBox()
        const menuBox = await menu.boundingBox()
        expect(triggerBox).not.toBeNull()
        expect(menuBox).not.toBeNull()
        expect(Math.abs(menuBox!.x + menuBox!.width - triggerBox!.x - triggerBox!.width)).toBeLessThan(1)
        expect(menuBox!.y).toBeGreaterThanOrEqual(triggerBox!.y + triggerBox!.height + 3)
        expect(menuBox!.x).toBeGreaterThanOrEqual(12)
        expect(menuBox!.x + menuBox!.width).toBeLessThanOrEqual(HANDSET.width - 12)
        await menu.getByRole('menuitem', { name: selected, exact: true }).click()
        await expect.poll(() => menu.count()).toBe(0)
        await expect.poll(() => dialog.getByRole('button', { name: selected, exact: true }).isVisible()).toBe(true)
      }
    } finally {
      await legacyBrowser.close()
    }
  })

  it('lists the sections, opens one on its own pane, and returns to the list', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-settings-handset'))
    await openSettings(page)
    const dialog = page.getByRole('dialog', { name: '设置' })
    await dialog.waitFor({ timeout: 10_000 })

    // The panel opens on the list pane, which fills the handset: the row is a
    // full-width target, not the 164px cell of the two-column layout, and the
    // section content is off screen.
    expect(await dialog.getAttribute('data-pane')).toBe('list')
    // The sheet spans the raw viewport: this browser reports no notch, so every
    // safe-area inset the sheet asks for resolves to no padding.
    expect(await dialog.boundingBox()).toEqual({ x: 0, y: 0, ...HANDSET })
    const navigation = dialog.locator('[class*="navList"]')
    expect(await navigation.evaluate(element => getComputedStyle(element).flexDirection)).toBe('column')
    expect(await navigation.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
    const row = dialog.getByRole('button', { name: '通用设置' })
    const rowBox = await row.boundingBox()
    expect(rowBox?.width ?? 0).toBeGreaterThan(HANDSET.width * 0.6)
    expect(rowBox?.x ?? -1).toBeGreaterThanOrEqual(0)
    expect((rowBox?.x ?? 0) + (rowBox?.width ?? HANDSET.width + 1)).toBeLessThanOrEqual(HANDSET.width)
    const lastRow = dialog.getByRole('button', { name: '已归档', exact: true })
    await lastRow.scrollIntoViewIfNeeded()
    expect((await lastRow.boundingBox())?.width ?? 0).toBe(rowBox?.width)
    expect(await dialog.getByText('语言', { exact: true }).isVisible()).toBe(false)
    // Nothing spills sideways out of the viewport.
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth))
      .toBeLessThanOrEqual(0)

    // A row tap opens that section alone, named in the header beside the back
    // control, and the content column keeps most of the handset width.
    await row.click()
    await expect.poll(async () => await dialog.getAttribute('data-pane')).toBe('detail')
    const back = dialog.getByRole('button', { name: '返回' })
    await back.waitFor({ timeout: 5_000 })
    expect(await dialog.locator('[data-detail-title]').textContent()).toBe('通用设置')
    const options = dialog.locator('[class*="options"]')
    expect((await options.boundingBox())?.width ?? 0).toBeGreaterThan(HANDSET.width * 0.7)
    await expect.poll(async () => await options.getByText('语言', { exact: true }).isVisible()).toBe(true)
    const sectionMotion = await options.locator(':scope > [class*="section"]').evaluate(element => ({
      name: getComputedStyle(element).animationName,
      duration: getComputedStyle(element).animationDuration,
    }))
    expect(sectionMotion.name).toContain('settings-pane-enter')
    expect(sectionMotion.duration).toBe('0.16s')

    // Detail header on one bar: back + title + document action + close. The
    // action trades its label for a glyph (accessible name unchanged) so the
    // pill no longer squeezes the section title.
    const docAction = dialog.getByRole('button', { name: '打开配置文件' })
    expect((await docAction.boundingBox())?.width ?? 999).toBeLessThan(60)
    expect((await docAction.innerText()).trim()).toBe('')

    // Appearance: three compact segments on ONE row, not a stack of
    // full-width cards.
    const cubeBoxes = (await Promise.all(
      ['浅色', '深色', '跟随系统'].map(async name => await dialog.getByRole('button', { name }).boundingBox()),
    )).map((box) => {
      if (box === null) throw new Error('appearance cube is unavailable')
      return box
    })
    expect(cubeBoxes).toHaveLength(3)
    const cubeYs = cubeBoxes.map(box => box.y)
    expect(Math.max(...cubeYs) - Math.min(...cubeYs)).toBeLessThan(1)
    for (const box of cubeBoxes) expect(box.height).toBeLessThan(80)

    // Permission: the description and selector share one row without overlap,
    // and the selector remains inside the handset viewport.
    const description = await dialog.getByText('选择新会话的默认权限模式').boundingBox()
    const selector = await dialog.getByRole('button', { name: /仅可查看|工作区内修改|完全权限/ }).boundingBox()
    expect(description).not.toBeNull()
    expect(selector).not.toBeNull()
    expect(selector!.x).toBeGreaterThanOrEqual(description!.x + description!.width - 0.5)
    expect(selector!.x + selector!.width).toBeLessThanOrEqual(HANDSET.width)

    // Back returns to the list without closing the dialog; the close control
    // then leaves both.
    await back.click()
    await expect.poll(async () => await dialog.getAttribute('data-pane')).toBe('list')
    expect(await navigation.evaluate(element => getComputedStyle(element).animationName)).toContain('settings-pane-enter')
    await expect.poll(() => row.evaluate(element => element === document.activeElement)).toBe(true)
    await dialog.getByRole('button', { name: '关闭' }).click()
    await expect.poll(async () => await dialog.count()).toBe(0)
    expect(tripwire.pageErrors).toEqual([])
  })

  it('keeps both columns on a desktop viewport and offers no back control there', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-settings-desktop'))
    await page.setViewportSize(DESKTOP)
    await openSettings(page)
    const dialog = page.getByRole('dialog', { name: '设置' })
    await dialog.waitFor({ timeout: 10_000 })

    // The nav cell is back to its rail width while the section content stays on
    // screen beside it, and the single-pane back control is not offered.
    const row = dialog.getByRole('button', { name: '通用设置' })
    expect((await row.boundingBox())?.width ?? 0).toBeLessThan(200)
    await expect.poll(async () => await dialog.getByText('语言', { exact: true }).isVisible()).toBe(true)
    expect(await dialog.getByRole('button', { name: '返回' }).isVisible()).toBe(false)
    // The two-column header keeps the document action's full label.
    expect((await dialog.getByRole('button', { name: '打开配置文件' }).innerText()).trim()).toBe('打开配置文件')

    await dialog.locator('[class*="navList"]').getByRole('button', { name: '模型' }).click()
    // The section's own controls may carry the same label, so the header names
    // the open section.
    expect(await dialog.locator('[data-detail-title]').textContent()).toBe('模型')
    expect(await dialog.locator('[class*="options"] > [class*="section"]').evaluate(element => getComputedStyle(element).animationName))
      .toContain('settings-pane-enter')
    await dialog.getByRole('button', { name: '关闭' }).click()
    await expect.poll(async () => await dialog.count()).toBe(0)
    expect(tripwire.pageErrors).toEqual([])
  })

  it('switches handset settings immediately when reduced motion is requested', async () => {
    await page.setViewportSize(HANDSET)
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await openSettings(page)
    const dialog = page.getByRole('dialog', { name: '设置' })
    await dialog.getByRole('button', { name: '通用设置' }).click()
    const section = dialog.locator('[class*="options"] > [class*="section"]')
    expect(await section.evaluate(element => getComputedStyle(element).animationName)).toBe('none')
    await dialog.getByRole('button', { name: '返回' }).click()
    expect(await dialog.locator('[class*="navList"]').evaluate(element => getComputedStyle(element).animationName)).toBe('none')
    await dialog.getByRole('button', { name: '关闭' }).click()
    await page.emulateMedia({ reducedMotion: 'no-preference' })
  })

  it('keeps form text compact with a fine pointer', async () => {
    const desktopPage = await browser.newPage({ viewport: DESKTOP, locale: ZH_BROWSER_LOCALE })
    const desktopErrors = watchConsole(desktopPage)
    onTestFailed(() => saveFailureShot(desktopPage, 'web-e2e-settings-desktop-form-text'))
    try {
      await desktopPage.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
      await openSettings(desktopPage)
      const dialog = desktopPage.getByRole('dialog', { name: '设置' })
      await dialog.getByRole('button', { name: '模型', exact: true }).click()
      const add = dialog.getByRole('button', { name: '添加模型提供商' })
      await expect.poll(async () => add.isEnabled(), { timeout: 10_000 }).toBe(true)
      await add.click()
      await dialog.getByLabel('提供商', { exact: true }).selectOption('minimax-cn')
      const key = dialog.getByLabel('API 密钥', { exact: true })
      await key.waitFor({ timeout: 10_000 })
      expect(await key.evaluate(element => getComputedStyle(element).fontSize)).toBe('14px')

      await dialog.getByRole('button', { name: '取消', exact: true }).click()
      await dialog.getByRole('button', { name: 'MCP', exact: true }).click()
      await dialog.getByRole('button', { name: '添加 MCP 服务器', exact: true }).click()
      const command = dialog.getByLabel('命令', { exact: true })
      const args = dialog.getByLabel('参数', { exact: true })
      await command.fill('node')
      await args.fill('server.js')
      expect(await command.evaluate(element => getComputedStyle(element).fontSize)).toBe('14px')
      expect(await args.evaluate(element => getComputedStyle(element).fontSize)).toBe('13px')
      await dialog.getByRole('button', { name: '取消', exact: true }).click()
      await expect.poll(async () => dialog.getByRole('searchbox', { name: '搜索 MCP 服务器', exact: true }).isVisible()).toBe(true)
      await dialog.getByRole('button', { name: '关闭' }).click()
      const panel = await openWebSearchFields(desktopPage)
      const count = panel.locator('#plugin-config-web-search-count')
      await count.fill('12')
      expect(await count.evaluate(element => getComputedStyle(element).fontSize)).toBe('13px')
      expect(desktopErrors.pageErrors).toEqual([])
    } finally {
      await desktopPage.close()
    }
  })

  it('gives the handset settings controls the 44px touch floor', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-settings-touch-targets'))
    await page.setViewportSize(HANDSET)
    await openSettings(page)
    const dialog = page.getByRole('dialog', { name: '设置' })
    await dialog.waitFor({ timeout: 10_000 })

    // Models: the provider picker exists only inside the add card, so the pane
    // is opened the way the Models scenario opens it.
    await dialog.locator('[class*="navList"]').getByRole('button', { name: '模型' }).click()
    const add = dialog.getByRole('button', { name: '添加模型提供商' })
    await add.waitFor({ timeout: 10_000 })
    await expect.poll(async () => add.isEnabled(), { timeout: 10_000 }).toBe(true)
    await add.click()
    await dialog.getByLabel('提供商', { exact: true }).waitFor({ timeout: 10_000 })
    await expectSelectTouchTargets(dialog)

    // The Plugins section carries one tab occupancy, so it renders the inventory
    // directly and draws no tab strip; the preset switcher arrives with the same
    // snapshot the group picker renders from.
    await dialog.getByRole('button', { name: '返回' }).click()
    await dialog.getByRole('button', { name: '内置插件', exact: true }).click()
    await dialog.getByRole('button', { name: '选择要查看的 Agent 预设' }).waitFor({ timeout: 10_000 })
    // The inventory's group picker is a menu trigger, not a native select, so the
    // 44px touch floor is asserted on the control that renders.
    const switcher = await dialog.getByRole('button', { name: '选择要查看的 Agent 预设' }).boundingBox()
    expect(switcher?.height ?? 0, 'preset switcher').toBeGreaterThanOrEqual(44)

    await dialog.getByRole('button', { name: '返回' }).click()
    await dialog.getByRole('button', { name: 'MCP', exact: true }).click()
    const mcpSearch = dialog.getByRole('searchbox', { name: '搜索 MCP 服务器', exact: true })
    await mcpSearch.waitFor({ timeout: 10_000 })
    expect(await mcpSearch.evaluate(element => getComputedStyle(element).fontSize)).toBe('16px')

    await dialog.getByRole('button', { name: '关闭' }).click()
    await expect.poll(async () => await dialog.count()).toBe(0)
    expect(tripwire.pageErrors).toEqual([])
  })

  it('keeps handset form text readable without losing drafts or widening the pane', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-settings-handset-form-text'))
    await page.setViewportSize(HANDSET)
    await openSettings(page)
    const dialog = page.getByRole('dialog', { name: '设置' })
    await dialog.waitFor({ timeout: 10_000 })
    const undersized: { name: string; fontSize: string }[] = []
    const inspectTextFields = async (): Promise<void> => {
      const fields = await dialog.locator('input, textarea').evaluateAll(elements => elements.flatMap((element) => {
        if (element.getClientRects().length === 0) return []
        if (element instanceof HTMLInputElement && !['text', 'search', 'password', 'email', 'url', 'number', 'tel'].includes(element.type)) return []
        return [{
          name: element.getAttribute('aria-label') ?? element.closest('label')?.textContent?.trim() ?? element.id,
          fontSize: getComputedStyle(element).fontSize,
        }]
      }))
      expect(fields.length).toBeGreaterThan(0)
      undersized.push(...fields.filter(field => field.fontSize !== '16px'))
    }

    await dialog.getByRole('button', { name: '模型', exact: true }).click()
    const add = dialog.getByRole('button', { name: '添加模型提供商' })
    await expect.poll(async () => add.isEnabled(), { timeout: 10_000 }).toBe(true)
    await add.click()
    await dialog.getByLabel('提供商', { exact: true }).selectOption('minimax-cn')
    const key = dialog.getByRole('tabpanel', { name: '第三方模型提供商' }).getByLabel('API 密钥', { exact: true })
    await key.fill('handset-draft')
    await inspectTextFields()
    await dialog.getByRole('tab', { name: '自定义模型 API' }).click()
    const custom = dialog.getByRole('tabpanel', { name: '自定义模型 API' })
    await custom.getByLabel('Provider ID').fill('handset-provider')
    await custom.getByLabel('显示名称', { exact: true }).fill('手机模型提供商')
    await inspectTextFields()
    await dialog.getByRole('tab', { name: '第三方模型提供商' }).click()
    expect(await key.inputValue()).toBe('handset-draft')
    await dialog.getByRole('button', { name: '取消', exact: true }).click()
    await expect.poll(async () => add.isVisible()).toBe(true)
    expect(await dialog.getByText('minimax-cn', { exact: true }).count()).toBe(0)
    expect(await dialog.locator('[class*="options"]').evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)

    await dialog.getByRole('button', { name: '返回' }).click()
    await dialog.getByRole('button', { name: 'MCP', exact: true }).click()
    await dialog.getByRole('button', { name: '添加 MCP 服务器', exact: true }).click()
    await dialog.getByLabel('名称', { exact: true }).fill('handset-probe')
    await dialog.getByLabel('命令', { exact: true }).fill('node')
    await dialog.getByLabel('参数', { exact: true }).fill('server.js\n--port 7100')
    await inspectTextFields()
    await expect.poll(async () => dialog.getByRole('button', { name: '保存', exact: true }).isEnabled()).toBe(true)
    for (const width of [320, 768, 769, HANDSET.width]) {
      await page.setViewportSize({ width, height: HANDSET.height })
      expect(await dialog.locator('[class*="options"]').evaluate(element => element.scrollWidth <= element.clientWidth), `MCP form at ${String(width)}px`).toBe(true)
    }
    await dialog.getByRole('button', { name: '取消', exact: true }).click()
    await expect.poll(async () => dialog.getByRole('searchbox', { name: '搜索 MCP 服务器', exact: true }).isVisible()).toBe(true)
    expect(await dialog.getByText('handset-probe', { exact: true }).count()).toBe(0)
    expect(await dialog.locator('[class*="options"]').evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)

    // Collect both forms before failing so one run reports every missed field.
    expect(undersized).toEqual([])
    expect(tripwire.pageErrors).toEqual([])
    await dialog.getByRole('button', { name: '关闭' }).click()
    await expect.poll(async () => await dialog.count()).toBe(0)
    const panel = await openWebSearchFields(page)
    const count = panel.locator('#plugin-config-web-search-count')
    await count.fill('12')
    expect(await count.evaluate(element => getComputedStyle(element).fontSize)).toBe('16px')
    expect(await panel.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
    expect(tripwire.pageErrors).toEqual([])
  })
})
