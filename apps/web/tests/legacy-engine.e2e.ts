// The LAN deployment serves the built shell to whichever engine an operator's
// phone already has, and phone WebViews rarely receive an update. An engine
// without the APIs several bundles call unconditionally — AbortSignal.any
// (Chrome 116), the ES2025 Iterator global (Chrome 117), Promise.withResolvers
// (Chrome 119) — must still boot an application that streams Host data; without
// the shell's browser floor the mux socket dies after its upgrade and the client
// retries forever behind a shell that never fills in.
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { launchWebScaffold, watchConsole, type WebScaffold } from './scaffold.ts'
import { newEnglishPage } from './support.ts'

/** Deletions standing in for the engine an older phone ships. */
const PRE_FLOOR_ENGINE = `
  delete AbortSignal.any;
  delete Promise.withResolvers;
  delete globalThis.Iterator;
`

/** One accepted mux socket and the frames the client managed to read from it. */
interface MuxSocket {
  received: number
}

let scaffold: WebScaffold
let browser: Browser
let page: Page

beforeAll(async () => {
  scaffold = await launchWebScaffold()
  browser = await chromium.launch()
}, 120_000)

afterAll(async () => {
  await page?.close()
  await browser?.close()
  await scaffold?.close()
})

describe('web e2e: engines below the shell browser floor', () => {
  it('streams Host data after the floor fills in the missing APIs', async () => {
    page = await newEnglishPage(browser)
    const tripwire = watchConsole(page)
    const sockets: MuxSocket[] = []
    page.on('websocket', (socket) => {
      if (!socket.url().endsWith('/api/remote.mux')) return
      const record: MuxSocket = { received: 0 }
      sockets.push(record)
      socket.on('framereceived', () => { record.received += 1 })
    })
    await page.addInitScript({ content: PRE_FLOOR_ENGINE })

    await page.goto(scaffold.authenticatedUrl)
    // The workspace picker is data-derived: it renders only after the forwarded
    // Remote event generation is live.
    await page.getByRole('textbox', { name: 'Choose workspace' }).waitFor({ timeout: 30_000 })

    expect(sockets.length, 'the mux socket never opened').toBeGreaterThan(0)
    expect(
      sockets.reduce((total, socket) => total + socket.received, 0),
      'the mux socket opened but delivered no frame',
    ).toBeGreaterThan(0)
    expect(tripwire.pageErrors).toEqual([])
    expect(tripwire.warnings).toEqual([])
  }, 90_000)
})
