// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-web-react'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import { en } from '../src/client/locales.ts'
import { UsageTelemetryCard } from '../src/client/UsageTelemetryCard.tsx'
import type { UsageTelemetryCardProps } from '../src/client/UsageTelemetryCard.tsx'
import type { UsageTelemetryCardState } from '../src/client/usage-telemetry-card-controller.ts'

afterEach(cleanup)

const t = (key: keyof typeof en) => en[key]

it('renders the card title and stages the opposite switch value', () => {
  const state = createSnapshotStore<UsageTelemetryCardState>({
    available: true, writable: true, dirty: false, invalid: false, saving: false, failed: false,
    enabled: true, draft: true,
  })
  const edit = vi.fn()
  const props = {
    ...{ edit, resetField: vi.fn(), save: vi.fn(), discard: vi.fn() },
    t,
    useUsageTelemetryCard: bindSnapshotSelector(state),
  } as unknown as UsageTelemetryCardProps
  render(<UsageTelemetryCard {...props} />)
  expect(screen.getByText(en.usageTelemetryTitle)).toBeTruthy()
  fireEvent.click(screen.getByText(en.usageTelemetryTitle))
  fireEvent.click(screen.getByRole('checkbox', { name: en.usageTelemetryEnabled }))
  expect(edit).toHaveBeenCalledWith('enabled', 'false')
})
