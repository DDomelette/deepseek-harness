// @vitest-environment jsdom
/** Skills settings section: group grid, drill-in list, and revision-guarded toggles. */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RpcResponse, SkillCatalogEntry } from '@deepseek-ai/dsh-api-remotes/client'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-test-runtime'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { SkillsSection, type SkillsSectionInjected } from '../src/client/SkillsSection.tsx'
import { SkillsSettingsStore } from '../src/client/store.ts'
import { en, zh, type SkillsKey } from '../src/client/locales.ts'

let nextRpc = 0
function ok<T>(value: T): RpcResponse<T> {
  return { rpcId: `r-${nextRpc++}` as never, result: { ok: true, value } }
}

const CATALOG: SkillCatalogEntry[] = [
  { name: 'grouped-a', description: 'Grouped A', group: 'superpowers', source: 'user-dsh', modelInvocable: true, userInvocable: true, disabled: false },
  { name: 'grouped-b', description: 'Grouped B', group: 'superpowers', source: 'user-dsh', modelInvocable: false, userInvocable: false, disabled: true },
  { name: 'user-only-c', description: 'User only C', source: 'bundled', modelInvocable: false, userInvocable: true, disabled: false },
]

const t: TranslateNS<'settings.skills'> = (key): string => {
  return key in zh ? zh[key as SkillsKey] : key
}

const enT: TranslateNS<'settings.skills'> = (key): string => {
  return key in en ? en[key as SkillsKey] : key
}

// Global standard kit stubs: this component does not consume these hooks.
const unusedHook = (() => { throw new Error('unused by SkillsSection') }) as never
const kit = { useSessions: unusedHook, useWorkspaces: unusedHook }

function skillsNamespace() {
  return {
    ns: 'skills',
    schema: {},
    value: { disabled: ['grouped-b'] },
    applies: 'live' as const,
    secrets: [],
    revision: 1,
  }
}

async function mount(
  catalog: SkillCatalogEntry[] = CATALOG,
  writable = true,
  translate: TranslateNS<'settings.skills'> = t,
): Promise<{
  controller: SkillsSettingsStore
  update: ReturnType<typeof vi.fn>
}> {
  const update = vi.fn(() => Promise.resolve(ok({})))
  const face = {
    skills: { catalog: (_payload: { sessionId: never }) => Promise.resolve(ok({ skills: catalog })) },
    settings: {
      describe: () => Promise.resolve(ok({ writable, hasDocument: true, namespaces: [skillsNamespace()] })),
      update,
    },
  }
  const controller = new SkillsSettingsStore(face as never, () => 'sk-component-1' as never)
  await controller.load()
  const injected: SkillsSectionInjected = {
    hooks: { skills: controller.store },
    load: () => controller.load(),
    setEnabled: (name, enabled) => controller.setEnabled(name, enabled),
  }
  render(<SkillsSection
    {...kit}
    useSkills={bindSnapshotSelector(controller.store)}
    load={injected.load}
    setEnabled={injected.setEnabled}
    t={translate}
    close={() => {}}
  />)
  return { controller, update }
}

afterEach(cleanup)

describe('SkillsSection', () => {
  it('renders one icon per group with a localized count and drills into the group', async () => {
    await mount()

    // Two groups: the declared superpowers group and the bundled source group.
    const buttons = screen.getAllByRole('button', { name: /superpowers|内置技能/ })
    expect(buttons.map(button => button.textContent)).toEqual([
      expect.stringContaining('superpowers'),
      expect.stringContaining('内置技能'),
    ])

    fireEvent.click(screen.getByRole('button', { name: /superpowers/ }))
    expect(screen.getByRole('heading', { name: 'superpowers' })).toBeTruthy()
    expect(screen.getByText('grouped-a')).toBeTruthy()
    expect(screen.getByText('grouped-b')).toBeTruthy()
    expect(screen.queryByText('user-only-c')).toBeNull()
  })

  it('uses the singular count for a one-skill group', async () => {
    await mount(CATALOG, true, enT)

    expect(screen.getByRole('button', { name: /superpowers2 skills$/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /Bundled skills1 skill$/ })).toBeTruthy()
  })

  it('returns from the drill-in view to the group grid', async () => {
    await mount()
    fireEvent.click(screen.getByRole('button', { name: /superpowers/ }))
    fireEvent.click(screen.getByRole('button', { name: '返回' }))
    expect(screen.getByRole('heading', { name: '技能' })).toBeTruthy()
    expect(screen.queryByText('grouped-a')).toBeNull()
  })

  it('marks a user-only skill and reflects the disabled toggle state', async () => {
    await mount()
    fireEvent.click(screen.getByRole('button', { name: /内置技能/ }))

    const row = screen.getByText('user-only-c').closest('li') as HTMLElement
    expect(within(row).getByText('仅用户可用')).toBeTruthy()
    const enabledSwitch = within(row).getByRole('switch')
    expect(enabledSwitch.getAttribute('aria-checked')).toBe('true')

    // The disabled skill lives in the other group: its switch reads off.
    fireEvent.click(screen.getByRole('button', { name: '返回' }))
    fireEvent.click(screen.getByRole('button', { name: /superpowers/ }))
    const disabledRow = screen.getByText('grouped-b').closest('li') as HTMLElement
    expect(within(disabledRow).getByRole('switch').getAttribute('aria-checked')).toBe('false')
  })

  it('writes the toggle through the store and waits for the write', async () => {
    const { update } = await mount()
    fireEvent.click(screen.getByRole('button', { name: /superpowers/ }))
    const row = screen.getByText('grouped-a').closest('li') as HTMLElement
    const switchControl = within(row).getByRole('switch')

    fireEvent.click(switchControl)
    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      ns: 'skills',
      patch: { disabled: ['grouped-b', 'grouped-a'] },
      expectedRevision: 1,
    }))
  })

  it('disables toggles while the settings seam is read-only', async () => {
    await mount(CATALOG, false)
    fireEvent.click(screen.getByRole('button', { name: /superpowers/ }))
    const row = screen.getByText('grouped-a').closest('li') as HTMLElement
    expect(within(row).getByRole('switch').hasAttribute('disabled')).toBe(true)
  })

  it('disables toggles while refreshing a previously loaded catalog', async () => {
    const { controller } = await mount()
    act(() => {
      controller.store.update((state) => { state.status = 'loading' })
    })
    fireEvent.click(screen.getByRole('button', { name: /superpowers/ }))
    const row = screen.getByText('grouped-a').closest('li') as HTMLElement
    expect(within(row).getByRole('switch').hasAttribute('disabled')).toBe(true)
  })

  it('shows the error state with a retry action', async () => {
    const controller = new SkillsSettingsStore({
      skills: { catalog: (_payload: { sessionId: never }) => Promise.resolve({ rpcId: 'r-1' as never, result: { ok: false, error: { code: 'internal', message: 'catalog down', details: {} } } }) },
      settings: {
        describe: () => Promise.resolve(ok({ writable: true, hasDocument: true, namespaces: [skillsNamespace()] })),
        update: vi.fn(),
      },
    } as never, () => 'sk-component-1' as never)
    const load = vi.spyOn(controller, 'load')
    const injected: SkillsSectionInjected = {
      hooks: { skills: controller.store },
      load: () => controller.load(),
      setEnabled: (name, enabled) => controller.setEnabled(name, enabled),
    }
    await act(async () => {
      render(<SkillsSection
        {...kit}
        useSkills={bindSnapshotSelector(controller.store)}
        load={injected.load}
        setEnabled={injected.setEnabled}
        t={t}
        close={() => {}}
      />)
    })
    expect(screen.getByText(/catalog down/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '重试' }))
    expect(load).toHaveBeenCalled()
  })

  it('shows the no-session posture when no session is open', async () => {
    const face = {
      skills: { catalog: (_payload: { sessionId: never }) => Promise.resolve(ok({ skills: [] })) },
      settings: {
        describe: () => Promise.resolve(ok({ writable: true, hasDocument: true, namespaces: [skillsNamespace()] })),
        update: vi.fn(),
      },
    }
    const controller = new SkillsSettingsStore(face as never, () => undefined)
    await controller.load()
    const injected: SkillsSectionInjected = {
      hooks: { skills: controller.store },
      load: () => controller.load(),
      setEnabled: (name, enabled) => controller.setEnabled(name, enabled),
    }
    render(<SkillsSection
      {...kit}
      useSkills={bindSnapshotSelector(controller.store)}
      load={injected.load}
      setEnabled={injected.setEnabled}
      t={t}
      close={() => {}}
    />)
    expect(screen.getByText(/打开一个会话后/)).toBeTruthy()
  })

  it('disables the switch while its write is in flight', async () => {
    let release: (() => void) | undefined
    const held = new Promise<void>((resolve) => { release = resolve })
    const update = vi.fn(() => held.then(() => ok({})))
    const face = {
      skills: { catalog: (_payload: { sessionId: never }) => Promise.resolve(ok({ skills: CATALOG })) },
      settings: {
        describe: () => Promise.resolve(ok({ writable: true, hasDocument: true, namespaces: [skillsNamespace()] })),
        update,
      },
    }
    const controller = new SkillsSettingsStore(face as never, () => 'sk-component-1' as never)
    await controller.load()
    const injected: SkillsSectionInjected = {
      hooks: { skills: controller.store },
      load: () => controller.load(),
      setEnabled: (name, enabled) => controller.setEnabled(name, enabled),
    }
    render(<SkillsSection
      {...kit}
      useSkills={bindSnapshotSelector(controller.store)}
      load={injected.load}
      setEnabled={injected.setEnabled}
      t={t}
      close={() => {}}
    />)
    fireEvent.click(screen.getByRole('button', { name: /superpowers/ }))
    const row = screen.getByText('grouped-a').closest('li') as HTMLElement
    fireEvent.click(within(row).getByRole('switch'))
    expect(within(row).getByRole('switch').hasAttribute('disabled')).toBe(true)
    release?.()
  })

  it('surfaces a failed write as an alert above the list', async () => {
    const update = vi.fn(() => Promise.reject(new Error('write rejected')))
    const face = {
      skills: { catalog: (_payload: { sessionId: never }) => Promise.resolve(ok({ skills: CATALOG })) },
      settings: {
        describe: () => Promise.resolve(ok({ writable: true, hasDocument: true, namespaces: [skillsNamespace()] })),
        update,
      },
    }
    const controller = new SkillsSettingsStore(face as never, () => 'sk-component-1' as never)
    await controller.load()
    const injected: SkillsSectionInjected = {
      hooks: { skills: controller.store },
      load: () => controller.load(),
      setEnabled: (name, enabled) => controller.setEnabled(name, enabled),
    }
    render(<SkillsSection
      {...kit}
      useSkills={bindSnapshotSelector(controller.store)}
      load={injected.load}
      setEnabled={injected.setEnabled}
      t={t}
      close={() => {}}
    />)
    fireEvent.click(screen.getByRole('button', { name: /superpowers/ }))
    const row = screen.getByText('grouped-a').closest('li') as HTMLElement
    fireEvent.click(within(row).getByRole('switch'))
    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain('write rejected')
    })
  })
})
