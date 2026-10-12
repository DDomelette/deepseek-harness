/** Real Web startup, mounted plugin package identities, and delivered Client graph isolation. */

import { FiberState } from '@deepseek-ai/cordis'
import type { WebBootGraph } from '@deepseek-ai/dsh-client-modules/client'
import { expect, it } from 'vitest'
import { modulePackage } from './runtime-roster.ts'
import { experimentalRuntimeReferences } from './runtime-roster-isolation.ts'
import { withDefaultWeb, webGet } from './default-web-process.ts'

const experimentalName = '@deepseek-ai/dsh-experimental-client-ui-agent-team'

it('boots default Web with the disabled Schedule row and no Schedule service, without experimental modules, time context, or an active built-in Browser', async (test) => {
  await withDefaultWeb(test, async ({ url, request }) => {
    const auth = await webGet(url, test.signal)
    const cookie = auth.headers['set-cookie']?.[0]?.split(';', 1)[0]
    expect(cookie).toBeDefined()
    const page = await webGet(new URL('/', url), test.signal, { cookie: cookie! })
    expect(page.status).toBe(200)
    const html = page.text
    const rawBoot = /globalThis\["__DSH_BOOT__"\] = ([\s\S]*?)<\/script>/u.exec(html)?.[1]
    expect(rawBoot, html).toBeDefined()
    const delivered = JSON.parse(rawBoot!) as WebBootGraph
    const roster = await request('roster')
    expect(roster.client).toEqual(delivered)
    expect(roster.entries).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: '@deepseek-ai/dsh-host-webserver', state: FiberState.ACTIVE }),
      expect.objectContaining({ name: '@deepseek-ai/dsh-client-modules', state: FiberState.ACTIVE }),
    ]))
    expect(roster.entries.some(entry => entry.name.endsWith('/runtime-roster-observer.js') && entry.state === FiberState.ACTIVE)).toBe(true)
    expect(roster.plugins.length).toBeGreaterThan(roster.entries.length)
    expect(roster.modules.some(url => modulePackage(url) === '@deepseek-ai/dsh')).toBe(true)
    expect(roster.client.entries.length).toBeGreaterThan(0)
    const browser = roster.entries.find(entry => entry.name === '@deepseek-ai/dsh-client-ui-sidebar-browser')
    expect(browser).toBeDefined()
    expect(browser!.state).toBeUndefined()
    expect(delivered.entries.some(entry => entry.id === '@deepseek-ai/dsh-client-ui-sidebar-browser')).toBe(false)
    // Schedule is opt-in: the shipped composition declares the browser row and
    // leaves it disabled, and mounts no Host Schedule plugin at all.
    const scheduleRow = roster.entries.find(entry => entry.id === 'ui-schedule')
    expect(scheduleRow?.name).toBe('@deepseek-ai/dsh-client-ui-schedule')
    expect(scheduleRow?.state).toBeUndefined()
    expect(roster.entries.some(entry => entry.name === '@deepseek-ai/dsh-schedule')).toBe(false)
    expect(delivered.entries.some(entry => entry.id === 'ui-schedule')).toBe(false)
    expect(roster.entries.some(entry => entry.name === '@deepseek-ai/dsh-time-context')).toBe(false)
    expect(delivered.entries.some(entry => entry.id === '@deepseek-ai/dsh-time-context')).toBe(false)
    expect(experimentalRuntimeReferences(roster)).toEqual([])

    const contaminated = await request('mount-experimental')
    expect(contaminated.entries.some(entry => entry.name === experimentalName)).toBe(false)
    const mounted = contaminated.plugins.filter(plugin => plugin.modules.some(url => modulePackage(url) === experimentalName))
    expect(mounted).toEqual([expect.objectContaining({ state: FiberState.ACTIVE })])
    expect(experimentalRuntimeReferences(contaminated)).toEqual(expect.arrayContaining([
      expect.stringContaining('/packages/experimental/client-ui-agent-team/'),
    ]))
  })
})
