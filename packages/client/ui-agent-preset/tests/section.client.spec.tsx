// @vitest-environment jsdom
/**
 * The management section's rendering rules: which group a card lands in, that
 * a shipped composition opens in a read-only viewer, and that picking a card
 * writes the default.
 */

import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-test-runtime'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { AgentPresetSection } from '../src/client/AgentPresetSection.tsx'
import type { AgentPresetSectionProps } from '../src/client/AgentPresetSection.tsx'
import type { AgentPresetSectionState } from '../src/client/section-store.ts'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)

const READY: AgentPresetSectionState = {
  status: 'ready',
  error: null,
  rows: [
    // A shipped preset publishes no display metadata: the dictionaries own it.
    { id: 'standard', isDefault: true },
    { id: 'mine', isDefault: false },
  ],
  view: null,
}

/**
 * Render the section over a fixed snapshot, with every action a spy.
 * @param state - the snapshot to render.
 * @returns the spies, so a test can assert what a click reached.
 */
function renderSection(
  state: Partial<AgentPresetSectionState> = {},
  options: { creator?: boolean } = {},
) {
  const store = createSnapshotStore<AgentPresetSectionState>({ ...READY, ...state })
  const actions = {
    load: vi.fn(() => Promise.resolve()),
    // The shell-owned section affordance (SettingsSectionOwnerProps.close).
    close: vi.fn(),
    ...options.creator === false ? {} : { startCreatorDraft: vi.fn() },
    view: vi.fn(() => Promise.resolve()),
    closeView: vi.fn(),
    makeDefault: vi.fn(() => Promise.resolve()),
  }
  const props = {
    ...actions,
    useAgentPresetSection: bindSnapshotSelector(store),
    t: (key: keyof typeof en) => en[key],
  } as unknown as AgentPresetSectionProps
  render(<AgentPresetSection {...props} />)
  return actions
}

/** Locate a card by the id it prints, not by its display name. */
function rowFor(id: string): HTMLElement {
  const key = screen.getAllByText(id).find(node => node.tagName === 'CODE')
  const row = key?.closest('li') ?? null
  /* v8 ignore next -- every rendered card prints its id */
  if (row === null) throw new Error(`no card for ${id}`)
  return row
}

describe('the preset list', () => {
  it('reads the roster once when it first renders', async () => {
    const actions = renderSection()

    await waitFor(() => { expect(actions.load).toHaveBeenCalledTimes(1) })
  })

  it('shows resolved copy for shipped presets and falls back to declaration copy', () => {
    renderSection()

    // Display copy is what a picker reads; the id stays visible as the key the
    // composition and the session header actually carry.
    expect(screen.getByText(en.presetStandardName)).toBeTruthy()
    expect(screen.getByText(en.presetStandardDescription)).toBeTruthy()
    const mine = rowFor('mine')
    expect(within(mine).getAllByText('mine').length).toBeGreaterThan(0)
    expect(within(mine).getByText(en.noDescription)).toBeTruthy()
  })

  it('marks the group and the one in use, and offers no "set default" on it', () => {
    renderSection()

    const standard = rowFor('standard')
    expect(within(standard).getByText(en.builtIn)).toBeTruthy()
    expect(within(standard).getByText(en.inUse)).toBeTruthy()
    expect(within(standard).queryByText(en.setDefault)).toBeNull()
    expect(within(rowFor('mine')).getByText(en.userTrust)).toBeTruthy()
  })

  it('separates shipped presets from ones that name themselves', () => {
    renderSection()

    // Two different things: one set ships with the deployment, the other is
    // declared by a preset that owns its own copy.
    expect(screen.getByRole('heading', { name: en.builtInGroup })).toBeTruthy()
    expect(screen.getByRole('heading', { name: en.customGroup })).toBeTruthy()
  })

  it('shows no group heading for a set nobody has', () => {
    renderSection({ rows: [{ id: 'standard', isDefault: true }] })

    expect(screen.queryByRole('heading', { name: en.customGroup })).toBeNull()
  })

  it('names the conversational way a preset is authored', () => {
    renderSection()

    // The page has no create button: the intro is what tells a first-time
    // reader that drafting one in Creator mode IS the way to make one.
    expect(screen.getByText(new RegExp('Creator mode'))).toBeTruthy()
  })

  it('picks a preset by clicking its card, and the one in use is inert', () => {
    const actions = renderSection()

    const inUse = within(rowFor('standard')).getByRole('button', { name: `${en.inUse}: ${en.presetStandardName}` })
    expect(inUse).toHaveProperty('disabled', true)
    fireEvent.click(inUse)

    // Clicking the card IS the choice; the preset already in use cannot be
    // re-picked, so the click reaches nothing.
    expect(actions.makeDefault).not.toHaveBeenCalled()
  })

  it('offers View on a shipped row and none on one that names itself', () => {
    renderSection()

    // The deployment's own preset is the composition this page can show; a
    // preset that names itself is declared outside it, and there is no editor
    // for either.
    const standard = rowFor('standard')
    expect(within(standard).getByRole('button', { name: `${en.view}: ${en.presetStandardName}` })).toBeTruthy()
    const mine = rowFor('mine')
    expect(within(mine).queryByRole('button', { name: `${en.view}: mine` })).toBeNull()
  })

  it('marks a broken preset: unselectable, with its reason on the badge and an alert', () => {
    const actions = renderSection({
      rows: [
        { id: 'standard', isDefault: true },
        {
          id: 'ghost', isDefault: false, name: '幽灵预设', description: '我自己写的',
          broken: 'the composition file agent.cordis.yml is missing',
        },
      ],
    })

    const ghost = rowFor('ghost')
    // The badge carries the reason for a pointer, and the body cannot pick
    // what cannot mount.
    expect(within(ghost).getByText(en.brokenBadge).textContent)
      .toBe(`${en.brokenBadge}the composition file agent.cordis.yml is missing`)
    // A picker card keeps showing what the preset is; a package specifier in
    // its place would tell a chooser nothing they can act on there.
    expect(within(ghost).getByText('我自己写的')).toBeTruthy()
    // Reachable without a pointer: the disabled body leaves the tab order, so
    // this node is the only reading assistive technology gets.
    expect(within(ghost).getByRole('alert').textContent).toContain('is missing')
    // `aria-disabled`, not `disabled`: the card stays in the tab order so a
    // keyboard reaches the reason the face no longer shows, and refuses the
    // pick itself rather than by being unreachable.
    const body = within(ghost).getByRole('button', { name: `${en.brokenBadge}: 幽灵预设` })
    expect(body).toHaveProperty('disabled', false)
    expect(body.getAttribute('aria-disabled')).toBe('true')
    fireEvent.click(body)
    expect(actions.makeDefault).not.toHaveBeenCalled()
  })

  it('withholds the viewer on a broken shipped preset', () => {
    renderSection({
      rows: [{ id: 'standard', isDefault: false, broken: 'the composition is not valid YAML' }],
    })

    // There is no readable composition to offer; the reason on the card is
    // the whole story a shipped row can tell.
    const standard = rowFor('standard')
    expect(within(standard).queryByRole('button', { name: `${en.view}: ${en.presetStandardName}` })).toBeNull()
    expect(within(standard).getByRole('alert').textContent).toContain('not valid YAML')
  })

  it('routes the row actions to the controller', () => {
    const actions = renderSection()

    // The card body is the control that picks a preset.
    fireEvent.click(within(rowFor('mine')).getByRole('button', { name: `${en.setDefault}: mine` }))
    fireEvent.click(within(rowFor('standard')).getByRole('button', { name: `${en.view}: ${en.presetStandardName}` }))

    expect(actions.makeDefault).toHaveBeenCalledWith('mine')
    expect(actions.view).toHaveBeenCalledWith('standard')
  })

  it('starts a creator-mode draft session and leaves settings', () => {
    const actions = renderSection({
      rows: [...READY.rows, { id: 'cordis', isDefault: false }],
    })

    fireEvent.click(screen.getByRole('button', { name: en.creatorDraft }))

    expect(actions.startCreatorDraft).toHaveBeenCalledTimes(1)
    // Leaving settings is part of the gesture: the flow lands in the new
    // session, not behind the modal.
    expect(actions.close).toHaveBeenCalledTimes(1)
  })

  it('keeps the empty custom group on screen: heading plus the creator entry', () => {
    renderSection({
      rows: [
        { id: 'standard', isDefault: true },
        { id: 'cordis', isDefault: false },
      ],
    })

    // No member yet, but the place where one's own preset will appear stays.
    expect(screen.getByRole('heading', { name: en.customGroup })).toBeTruthy()
    expect(screen.getByRole('button', { name: en.creatorDraft })).toBeTruthy()
    expect(screen.queryByText(`· ${en.userTrust}`)).toBeNull()
  })

  it('hides the creator entry without the flow or the preset', () => {
    renderSection()
    expect(screen.queryByRole('button', { name: en.creatorDraft })).toBeNull()
    cleanup()

    renderSection({
      rows: [...READY.rows, { id: 'cordis', isDefault: false }],
    }, { creator: false })
    expect(screen.queryByRole('button', { name: en.creatorDraft })).toBeNull()
  })

  it('shows a page-level failure without hiding the list', () => {
    renderSection({ error: 'settings are read-only' })

    expect(screen.getByRole('alert').textContent).toBe('settings are read-only')
    expect(rowFor('mine')).toBeTruthy()
  })

  it('renders nothing when the deployment composes no presets', () => {
    const { container } = render(<AgentPresetSection {...({
      useAgentPresetSection: bindSnapshotSelector(
        createSnapshotStore<AgentPresetSectionState>({ ...READY, status: 'unavailable', rows: [] })),
      t: (key: keyof typeof en) => en[key],
      load: vi.fn(() => Promise.resolve()),
    } as unknown as AgentPresetSectionProps)} />)

    expect(container.firstChild).toBeNull()
  })

  it('offers a retry when the roster could not be read', () => {
    const actions = renderSection({ status: 'error', error: 'roster unavailable' })

    expect(screen.getByRole('alert').textContent).toContain('roster unavailable')
    fireEvent.click(screen.getByText(en.retry))

    expect(actions.load).toHaveBeenCalledTimes(2)
  })
})

describe('the read-only viewer', () => {
  it('shows the composition text under the preset\'s name', () => {
    renderSection({ view: { id: 'standard', title: '标准模式', content: '- id: tool-bash\n' } })

    const dialog = screen.getByRole('dialog')
    expect(dialog.getAttribute('aria-label')).toBe(`${en.view} · ${en.presetStandardName}`)
    expect(within(dialog).getByText(en.composition)).toBeTruthy()
    expect(within(dialog).getByText(/tool-bash/).textContent).toBe('- id: tool-bash\n')
  })

  it('keeps the loaded title when the viewed row leaves the roster', () => {
    renderSection({ view: { id: 'retired', title: 'Retired mode', content: '- id: tool-bash\n' } })

    expect(screen.getByRole('dialog').getAttribute('aria-label')).toBe(`${en.view} · Retired mode`)
  })

  it('closes through the controller', () => {
    const actions = renderSection({ view: { id: 'standard', title: '标准模式', content: '- id: x\n' } })

    fireEvent.click(within(screen.getByRole('dialog')).getByText(en.close))

    expect(actions.closeView).toHaveBeenCalledTimes(1)
  })

  it('dismisses on Escape', () => {
    const actions = renderSection({ view: { id: 'standard', title: '标准模式', content: '- id: x\n' } })

    fireEvent.keyDown(document, { key: 'Escape' })

    expect(actions.closeView).toHaveBeenCalledTimes(1)
  })
})

describe('a long card description', () => {
  /** jsdom has no ResizeObserver; the description watches its own box through one. */
  class ResizeObserverStub {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }

  const LONG = '始终用简体中文交流的友好通用助手，提供持久 bash 与文件编辑能力。'.repeat(8)

  /** Force the clamp to report an overflow: jsdom lays nothing out, so both heights are 0. */
  function clamp(overflowing: boolean): void {
    vi.spyOn(Element.prototype, 'scrollHeight', 'get').mockReturnValue(overflowing ? 400 : 80)
    vi.spyOn(Element.prototype, 'clientHeight', 'get').mockReturnValue(80)
  }

  beforeEach(() => { vi.stubGlobal('ResizeObserver', ResizeObserverStub) })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('offers the whole description on hover once the card cuts it off', () => {
    clamp(true)
    vi.useFakeTimers()
    try {
      renderSection({ rows: [{ id: 'zh', isDefault: false, name: '中文助手', description: LONG }] })

      fireEvent.mouseEnter(within(rowFor('zh')).getByText(LONG))
      act(() => { vi.advanceTimersByTime(400) })

      expect(screen.getByRole('tooltip').textContent).toBe(LONG)
    } finally {
      vi.useRealTimers()
    }
  })

  it('stays quiet when the description already fits', () => {
    clamp(false)
    vi.useFakeTimers()
    try {
      renderSection({ rows: [{ id: 'zh', isDefault: false, name: '中文助手', description: '短描述。' }] })

      fireEvent.mouseEnter(within(rowFor('zh')).getByText('短描述。'))
      act(() => { vi.advanceTimersByTime(400) })

      // A bubble repeating what is already fully on the card is noise.
      expect(screen.queryByRole('tooltip')).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it('renders where the runtime has no ResizeObserver', () => {
    vi.unstubAllGlobals()
    clamp(true)

    expect(() => {
      renderSection({ rows: [{ id: 'zh', isDefault: false, description: LONG }] })
    }).not.toThrow()
    // The first measurement does not depend on the observer.
    expect(within(rowFor('zh')).getByText(LONG).getAttribute('title')).toBe('')
  })
})
