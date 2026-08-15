// Web e2e scenario: the Archived settings page — a seeded archived session is
// grouped under its workspace, restore unarchives and opens an ungrouped
// session, and the confirmed recursive delete removes a parent and its
// subagent child from persistence, the archive set, and the workspace account.
import { readFile } from 'node:fs/promises'
import { basename, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import { SESSION_FORMAT_VERSION, SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-persistence'
import type {} from '@deepseek-ai/dsh-workspace'
import { parseSessionLog } from '@deepseek-ai/dsh-llm-replay'
import {
  launchWebScaffold, realizeSeedFixture, seedSession, watchConsole, type WebScaffold,
} from './scaffold.ts'
import { connectFreshWorkspace, newEnglishPage, saveFailureShot } from './support.ts'

const SEED = fileURLToPath(new URL('./snapshots/seeded-history/seed.jsonl', import.meta.url))
const PARENT_ID = 'archived-settings-parent'
const CHILD_ID = 'archived-settings-child'
const RESTORE_ID = 'archived-settings-restore'

describe('web e2e: archived sessions settings', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>

  beforeAll(async () => {
    scaffold = await launchWebScaffold({})
    browser = await chromium.launch()
    page = await newEnglishPage(browser)
    tripwire = watchConsole(page)
    await page.goto(scaffold.baseUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
    await connectFreshWorkspace(page, dirname(scaffold.workspaceCwd), basename(scaffold.workspaceCwd))

    const seedText = await readFile(SEED, 'utf8')
    const parentId = await seedSession(scaffold, seedText, PARENT_ID)
    const childId = SessionId(CHILD_ID)
    const childEvents = parseSessionLog(realizeSeedFixture(scaffold, seedText, CHILD_ID))
    await scaffold.ctx.sessionPersistence.create({
      version: SESSION_FORMAT_VERSION,
      id: childId,
      createdAt: Date.now() - 30_000,
      cwd: scaffold.workspaceCwd,
      parentSession: parentId,
      origin: 'subagent' as const,
      delegationDepth: 1,
    })
    await scaffold.ctx.sessionPersistence.append(childId, childEvents)

    // An ungrouped archived session for the restore path: its cwd is the
    // scaffold parent, which no workspace owns.
    const restoreId = SessionId(RESTORE_ID)
    const restoreEvents = parseSessionLog(realizeSeedFixture(scaffold, seedText, RESTORE_ID))
    await scaffold.ctx.sessionPersistence.create({
      version: SESSION_FORMAT_VERSION,
      id: restoreId,
      createdAt: Date.now() - 20_000,
      cwd: dirname(scaffold.workspaceCwd),
    })
    await scaffold.ctx.sessionPersistence.append(restoreId, restoreEvents)

    const workspace = await scaffold.ctx.workspaceRegistry.resolveByPath(scaffold.workspaceCwd)
    if (workspace === undefined) throw new Error('workspace was not connected')
    await workspace.attachSession(parentId)
    await workspace.attachSession(childId)
    // Attach prepends, so put the parent before its child in the account;
    // both rows share the cwd fallback title, and order identifies them.
    await workspace.insertSessionBefore(parentId, childId)
    await scaffold.ctx.workspaceRegistry.archiveSession(parentId)
    await scaffold.ctx.workspaceRegistry.archiveSession(childId)
    await scaffold.ctx.workspaceRegistry.archiveSession(restoreId)
    await page.reload({ waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
  }, 120_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
  })

  it('lists, restores, and recursively deletes archived conversations', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-archived-settings'))
    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Settings' })
    await dialog.waitFor({ timeout: 10_000 })
    await dialog.getByRole('button', { name: 'Archived' }).click()
    await dialog.getByRole('heading', { name: 'Archived conversations' }).waitFor({ timeout: 10_000 })

    const parentRow = dialog.locator('li').nth(0)
    const childRow = dialog.locator('li').nth(1)
    await parentRow.waitFor({ timeout: 10_000 })
    await childRow.waitFor({ timeout: 10_000 })
    const ungrouped = dialog.locator('section').filter({ hasText: 'Ungrouped' })
    const restoreRow = ungrouped.locator('li').nth(0)
    await restoreRow.waitFor({ timeout: 10_000 })

    // Restore the ungrouped session: settings closes and it leaves the archive set.
    await restoreRow.getByRole('button', { name: /Restore conversation/ }).click()
    await expect.poll(
      () => scaffold.ctx.workspaceRegistry.archivedSessionIds.includes(SessionId(RESTORE_ID)),
      { timeout: 10_000 },
    ).toBe(false)
    await expect.poll(() => page.getByRole('dialog', { name: 'Settings' }).count(), { timeout: 5_000 }).toBe(0)

    // Reopen the page for the cold parent/child pair, still archived.
    await page.reload({ waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    await dialog.waitFor({ timeout: 10_000 })
    await dialog.getByRole('button', { name: 'Archived' }).click()
    const deleteRow = dialog.locator('li').nth(0)
    await deleteRow.waitFor({ timeout: 10_000 })
    await deleteRow.getByRole('button', { name: /Delete conversation/ }).click()
    const confirm = page.getByRole('dialog', { name: 'Delete conversation?' })
    await confirm.waitFor({ timeout: 10_000 })
    await confirm.getByRole('button', { name: 'Delete', exact: true }).click()
    await expect.poll(() => page.getByRole('dialog', { name: 'Delete conversation?' }).count(), { timeout: 10_000 }).toBe(0)

    const headers = await scaffold.ctx.sessionPersistence.list()
    expect(headers.map(header => header.id)).not.toContain(SessionId(PARENT_ID))
    expect(headers.map(header => header.id)).not.toContain(SessionId(CHILD_ID))
    expect(scaffold.ctx.workspaceRegistry.archivedSessionIds).not.toContain(SessionId(PARENT_ID))
    expect(scaffold.ctx.workspaceRegistry.archivedSessionIds).not.toContain(SessionId(CHILD_ID))
    const workspace = await scaffold.ctx.workspaceRegistry.resolveByPath(scaffold.workspaceCwd)
    expect(workspace?.sessionIds).not.toContain(SessionId(PARENT_ID))
    expect(workspace?.sessionIds).not.toContain(SessionId(CHILD_ID))
    expect(tripwire.pageErrors).toEqual([])
  }, 120_000)
})
