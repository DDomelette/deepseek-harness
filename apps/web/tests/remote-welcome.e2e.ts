// A paired browser cannot call the local-operator-only settings API;
// the notice therefore advances for this browser process and returns on reload.
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  acknowledgeReloadConnectionLoss, launchWebScaffold, watchConsole, webSnapshotMode,
  WELCOME_NOTICE_COPY,
  type WebScaffold,
} from './scaffold.ts'
import { ZH_BROWSER_LOCALE } from './support.ts'

const MODE = webSnapshotMode()
const REMOTE_HOST = 'remote.localhost'

describe.skipIf(MODE === 'record')('web e2e: remote welcome notice', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>

  beforeAll(async () => {
    scaffold = await launchWebScaffold({
      remoteAuthority: REMOTE_HOST,
      welcomeNoticePending: true,
    })
    browser = await chromium.launch()
    page = await browser.newPage({
      viewport: { width: 1440, height: 960 },
      locale: ZH_BROWSER_LOCALE,
    })
    const remoteUrl = new URL(scaffold.baseUrl)
    remoteUrl.hostname = REMOTE_HOST
    const device = await scaffold.ctx.connection.devices.register({ label: 'welcome notice browser' })
    const cookie = scaffold.ctx.connection.devices.issueCookie({ headers: { host: remoteUrl.host } }, device.id)
    if (cookie === undefined) throw new Error('remote welcome fixture did not receive its device cookie')
    const [name, value] = cookie.split(';', 1)[0]!.split('=')
    await page.context().addCookies([{
      name: name!, value: value!, url: remoteUrl.origin, httpOnly: true, sameSite: 'Strict',
    }])
    tripwire = watchConsole(page)
    await page.goto(remoteUrl.href, { waitUntil: 'load' })
    await page.waitForSelector('#root', { timeout: 30_000 })
  }, 120_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
  })

  it('advances process-locally and presents the notice again after reload', async () => {
    const welcome = page.getByRole('dialog', { name: WELCOME_NOTICE_COPY.zh.title })
    await welcome.waitFor({ timeout: 15_000 })
    expect(await page.locator('#root').evaluate(root => (root as HTMLElement).inert)).toBe(true)

    await welcome.getByRole('button', { name: WELCOME_NOTICE_COPY.zh.continueLabel }).click()
    await welcome.waitFor({ state: 'detached', timeout: 15_000 })
    await expect.poll(
      () => page.locator('#root').evaluate(root => (root as HTMLElement).inert),
      { timeout: 15_000 },
    ).toBe(false)

    const reloadWarnings = tripwire.warnings.length
    await page.reload({ waitUntil: 'load' })
    acknowledgeReloadConnectionLoss(tripwire, reloadWarnings)
    await welcome.waitFor({ timeout: 15_000 })
    expect(tripwire.warnings).toEqual([])
    expect(tripwire.pageErrors).toEqual([])
  }, 60_000)
})
