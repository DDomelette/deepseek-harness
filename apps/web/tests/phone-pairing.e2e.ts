/** Operator authentication and paired-device restrictions through the shipped phone plugin. */
import { fileURLToPath } from 'node:url'
import type { Page } from 'playwright'
import { chromium } from 'playwright'
import { describe, expect, it, onTestFinished } from 'vitest'
import { compareOrRefreshGolden, launchWebScaffold, webSnapshotMode, WELCOME_NOTICE_COPY } from './scaffold.ts'
import { saveFailureShot, ZH_BROWSER_LOCALE } from './support.ts'
import { probeNonLoopbackIpv4 } from '../../../scripts/test-non-loopback-address.ts'

const MODE = webSnapshotMode()
// RFC 2544 addresses can be intercepted by a host's fake-IP proxy even when a listener binds them.
const LAN_HOST = await probeNonLoopbackIpv4(address => !/^198\.(?:18|19)\./u.test(address))
const MOB_PATCH = fileURLToPath(new URL('../../../packages/bundle/mob/cordis.patch.yml', import.meta.url))
const MOB_ANCHOR = fileURLToPath(new URL('../../../packages/bundle/mob/package.json', import.meta.url))
const EXPECTED = fileURLToPath(new URL('./expected/phone-pairing/access.expected.md', import.meta.url))
const UNAVAILABLE = fileURLToPath(new URL('./expected/phone-pairing/unavailable.expected.md', import.meta.url))

/** Open the phone settings dialog on either supported viewport. */
async function openPairing(page: Page, welcomePending = false): Promise<void> {
  await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
  if (welcomePending) {
    const welcome = page.getByRole('dialog', { name: WELCOME_NOTICE_COPY.zh.title })
    await welcome.getByRole('button', { name: WELCOME_NOTICE_COPY.zh.continueLabel }).click()
    await welcome.waitFor({ state: 'detached' })
  }
  const drawer = page.getByRole('button', { name: '打开侧边栏' })
  if (await drawer.isVisible()) await drawer.click()
  await page.getByRole('button', { name: '设置', exact: true }).click()
  await page.getByRole('button', { name: '通用设置', exact: true }).click()
  await page.getByRole('button', { name: '显示二维码', exact: true }).click()
}

describe.skipIf(MODE === 'record')('web e2e: phone pairing', () => {
  it.skipIf(LAN_HOST === undefined)('lets an authenticated non-loopback operator approve a phone without granting it management rights', async () => {
    const scaffold = await launchWebScaffold({
      extraOverlayPath: MOB_PATCH,
      extraInstallAnchors: [MOB_ANCHOR],
      bindHost: LAN_HOST,
    })
    onTestFinished(() => scaffold.close())
    const browser = await chromium.launch({ args: ['--no-proxy-server'] })
    let observed: Page | undefined
    const pageErrors: string[] = []
    try {
      const desktop = await browser.newContext({ locale: ZH_BROWSER_LOCALE, viewport: { width: 1440, height: 1000 } })
      const operator = await desktop.newPage()
      observed = operator
      operator.on('pageerror', error => pageErrors.push(error.message))
      const navigation = await operator.goto(scaffold.authenticatedUrl)
      expect(navigation?.status()).toBe(200)
      await openPairing(operator, true)
      const management = operator.getByRole('dialog', { name: '连接手机', exact: true })
      await management.getByRole('button', { name: '生成配对码' }).click()
      const link = management.getByRole('textbox', { name: '加入链接' })
      await link.waitFor()
      const joinUrl = await link.inputValue()
      expect(new URL(joinUrl).hostname).toBe(LAN_HOST)
      expect(new URL(joinUrl).searchParams.has('token')).toBe(false)

      const phone = await browser.newContext({ locale: ZH_BROWSER_LOCALE, viewport: { width: 390, height: 844 }, hasTouch: true })
      const handset = await phone.newPage()
      observed = handset
      handset.on('pageerror', error => pageErrors.push(error.message))
      await handset.goto(joinUrl)
      await handset.getByText('请在电脑端确认这台手机以完成配对。').waitFor()
      await management.getByRole('button', { name: '允许', exact: true }).click()
      await handset.waitForURL(scaffold.baseUrl + '/')
      await openPairing(handset, true)
      const restricted = handset.getByRole('dialog', { name: '连接手机', exact: true })
      await restricted.getByText('请打开启动器提供的认证链接来管理配对。已配对设备不能管理其他设备').waitFor()
      expect(await restricted.getByRole('button', { name: '生成配对码' }).count()).toBe(0)
      expect((await phone.request.get(new URL('/pair/devices', scaffold.baseUrl).href)).status()).toBe(403)
      await compareOrRefreshGolden(EXPECTED, await restricted.ariaSnapshot(), MODE)
      expect(pageErrors).toEqual([])
    } catch (error) {
      console.error('phone pairing browser errors:', pageErrors)
      if (observed !== undefined) {
        await saveFailureShot(observed, 'phone-pairing')
      }
      throw error
    } finally {
      await browser.close()
    }
  })

  it('explains the concrete LAN bind when no phone address is configured', async () => {
    const scaffold = await launchWebScaffold({ extraOverlayPath: MOB_PATCH, extraInstallAnchors: [MOB_ANCHOR] })
    onTestFinished(() => scaffold.close())
    const browser = await chromium.launch({ args: ['--no-proxy-server'] })
    try {
      const page = await browser.newPage({ locale: ZH_BROWSER_LOCALE, viewport: { width: 1440, height: 1000 } })
      await page.goto(scaffold.authenticatedUrl)
      await openPairing(page)
      const panel = page.getByRole('dialog', { name: '连接手机', exact: true })
      await panel.getByRole('button', { name: '生成配对码' }).click()
      await panel.getByRole('alert').waitFor()
      expect(await panel.getByRole('img').count()).toBe(0)
      await compareOrRefreshGolden(UNAVAILABLE, await panel.ariaSnapshot(), MODE)
    } finally {
      await browser.close()
    }
  })
})
