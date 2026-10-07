// Handset-viewport coverage for the drawer sidebar, the fitted content width
// axis, and composer usability at 390px: the official roster, one Chromium,
// touch emulation. See sidebar-right.e2e.ts for the scaffold pattern.
import { chromium, type Browser, type Page } from 'playwright'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { launchWebScaffold, watchConsole, type WebScaffold } from './scaffold.ts'
import { connectFreshWorkspace, newMobilePage, requireDist } from './support.ts'

describe('mobile viewport (390×844, touch)', () => {
  let browser: Browser
  let scaffold: WebScaffold
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>

  beforeAll(async () => {
    requireDist()
    browser = await chromium.launch()
    scaffold = await launchWebScaffold()
    page = await newMobilePage(browser)
    tripwire = watchConsole(page)
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
  }, 120_000)

  afterAll(async () => {
    await page?.context().close()
    await scaffold?.close()
    await browser?.close()
  })

  it('keeps the document within the viewport (no horizontal overflow)', async () => {
    await expect.poll(async () => await page.evaluate(() => document.getElementById('root')?.innerHTML.length ?? 0)).toBeGreaterThan(1000)
    const metrics = await page.evaluate(() => ({
      scroll: document.documentElement.scrollWidth,
      inner: window.innerWidth,
    }))
    expect(metrics.scroll).toBeLessThanOrEqual(metrics.inner)
    expect(tripwire.pageErrors).toEqual([])
  })

  it('opens and closes the sidebar as a drawer', async () => {
    const frame = page.locator('[class*="frame"]').first()
    const scrim = page.locator('[data-drawer-scrim]')
    const center = page.locator('[class*="centerCol"]').first()
    // Resting state: the floating brand button, no scrim, no sidebar track.
    await page.getByRole('button', { name: 'Open sidebar' }).waitFor({ state: 'visible' })
    expect(await scrim.count()).toBe(0)
    await expect.poll(async () => await frame.evaluate(el => getComputedStyle(el).gridTemplateColumns.startsWith('0px'))).toBe(true)
    const centerWidth = await center.evaluate(el => el.getBoundingClientRect().width)
    await page.getByRole('button', { name: 'Open sidebar' }).click()
    // Drawer open: the sidebar floats over the center, the center keeps its
    // full-width track (the rail is gone below this breakpoint), and the scrim
    // appears.
    await scrim.waitFor({ state: 'attached' })
    expect(await scrim.count()).toBe(1)
    // Touch has no hover to raise or clear a tooltip with, so the tap must not
    // leave one stuck over the session titles.
    expect(await page.getByRole('tooltip').count()).toBe(0)
    await expect.poll(async () => await frame.getAttribute('data-drawer')).toBe('true')
    await expect.poll(async () => {
      const columns = await frame.evaluate(el => getComputedStyle(el).gridTemplateColumns)
      return columns.startsWith('0px')
    }).toBe(true)
    await expect.poll(() => center.evaluate(el => el.getBoundingClientRect().width)).toBe(centerWidth)
    // Enter slides in on the mount keyframe (0.3s, the track curve; CSS
    // Modules hashes the keyframe name, so match the semantic suffix).
    const drawerCol = page.locator('[class*="sidebarCol"][data-drawer]').first()
    await expect.poll(() => drawerCol.evaluate(el => getComputedStyle(el).animationName)).toContain('drawer-in')
    // No horizontal overflow with the drawer open.
    const metrics = await page.evaluate(() => ({
      scroll: document.documentElement.scrollWidth,
      inner: window.innerWidth,
    }))
    expect(metrics.scroll).toBeLessThanOrEqual(metrics.inner)
    // A scrim tap closes the drawer. The open panel (280px, above the scrim in
    // z-order) covers the scrim's centre, so tap the exposed strip at the
    // right edge like a user would.
    await scrim.tap({ position: { x: 370, y: 422 } })
    // Exit is a delayed unmount: the column slides out under data-closing
    // (mid-flight transform goes negative) before the scrim detaches.
    await expect.poll(() => drawerCol.getAttribute('data-closing')).toBe('true')
    await expect.poll(() => drawerCol.evaluate(el => new DOMMatrixReadOnly(getComputedStyle(el).transform).e)).toBeLessThan(0)
    await scrim.waitFor({ state: 'detached' })
    expect(await center.evaluate(el => el.getBoundingClientRect().width)).toBe(centerWidth)
    // Reopen; Escape closes it.
    await page.getByRole('button', { name: 'Open sidebar' }).click()
    await scrim.waitFor({ state: 'attached' })
    await page.keyboard.press('Escape')
    await scrim.waitFor({ state: 'detached' })
    expect(tripwire.pageErrors).toEqual([])
  })

  it('keeps the composer visible inside the viewport', async () => {
    const composer = page.locator('[class*="composerSeat"]').first()
    await composer.waitFor({ state: 'visible' })
    const box = await composer.boundingBox()
    expect(box).not.toBeNull()
    expect(box!.y + box!.height).toBeLessThanOrEqual(844)
    expect(box!.width).toBeLessThanOrEqual(390)
    expect(tripwire.pageErrors).toEqual([])
  })

  it('keeps the hero composer selectors labeled and the send action tappable on touch', async () => {
    await connectFreshWorkspace(page, scaffold.workspaceCwd, 'workspace-selectors')
    // The hero card is exempt from the docked composer's handset icon row:
    // both selectors keep their labels on a coarse pointer.
    const permission = page.getByRole('button', { name: /Access mode, current: / })
    await permission.waitFor({ timeout: 15_000 })
    expect((await permission.innerText()).trim()).toMatch(/Read Only|Workspace Write|Full access/)
    const model = page.getByRole('button', { name: /Select model/ })
    expect((await model.innerText()).trim()).not.toBe('')
    // Keeping the labels costs row width: the send action must still land
    // inside the viewport and answer a tap at its own center.
    const send = page.getByRole('button', { name: 'Send message' })
    const hitTest = await send.evaluate((el) => {
      const box = el.getBoundingClientRect()
      const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)
      return {
        right: box.x + box.width,
        bottom: box.y + box.height,
        hit: hit !== null && (hit === el || el.contains(hit)),
      }
    })
    expect(hitTest.right).toBeLessThanOrEqual(390)
    expect(hitTest.bottom).toBeLessThanOrEqual(844)
    expect(hitTest.hit).toBe(true)
    expect(tripwire.pageErrors).toEqual([])
  })

  it('keeps unmeasured handset content usable without horizontal overflow', async () => {
    const metrics = await page.evaluate(() => {
      const root = document.querySelector<HTMLElement>('[data-phase]')
      const input = document.querySelector<HTMLElement>('[data-composer-input]')
      if (root === null || input === null) throw new Error('conversation or composer is unavailable')
      const property = '--dsh-conversation-column-width'
      const measured = root.style.getPropertyValue(property)
      try {
        root.style.removeProperty(property)
        return {
          inputWidth: input.getBoundingClientRect().width,
          scroll: document.documentElement.scrollWidth,
          inner: window.innerWidth,
        }
      } finally {
        root.style.setProperty(property, measured)
      }
    })
    expect(metrics.inputWidth).toBeGreaterThan(0)
    expect(metrics.scroll).toBeLessThanOrEqual(metrics.inner)
    expect(tripwire.pageErrors).toEqual([])
  })

  it('reserves no safe-area padding where the viewport reports no insets', async () => {
    // This browser reports no notch or status bar, so every safe-area inset the
    // shell asks for resolves to zero: the mount root must not reserve padding
    // the viewport does not have, and it must still fill the dynamic viewport.
    await expect.poll(async () => await page.evaluate(() => document.getElementById('root')?.innerHTML.length ?? 0)).toBeGreaterThan(1000)
    const metrics = await page.evaluate(() => {
      const root = document.getElementById('root')!
      const style = getComputedStyle(root)
      return {
        padding: [style.paddingTop, style.paddingRight, style.paddingBottom, style.paddingLeft],
        height: root.getBoundingClientRect().height,
        viewport: window.innerHeight,
      }
    })
    expect(metrics.padding).toEqual(['0px', '0px', '0px', '0px'])
    expect(Math.abs(metrics.height - metrics.viewport)).toBeLessThanOrEqual(1)
    expect(tripwire.pageErrors).toEqual([])
  })
})
