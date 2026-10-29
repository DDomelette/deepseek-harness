// @vitest-environment jsdom
/**
 * Modal: the shared dialog chrome. It owns the outermost Escape, so an inner
 * surface that consumed the key keeps the dialog — and whatever it holds — open,
 * while any other Escape closes it.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Modal } from '../src/Modal.tsx'

afterEach(cleanup)

/** Mount the dialog with one inner input that decides whether it owns the Escape. */
function mount(options: { open?: boolean; consumeEscape?: boolean } = {}): { onClose: ReturnType<typeof vi.fn> } {
  const onClose = vi.fn()
  render(
    <Modal open={options.open ?? true} onClose={onClose} title="Connect phone" closeLabel="Close">
      <input
        aria-label="Device name"
        onKeyDown={(event) => {
          if (options.consumeEscape === true && event.key === 'Escape') event.preventDefault()
        }}
      />
    </Modal>,
  )
  return { onClose }
}

describe('Modal Escape ownership', () => {
  it('closes on an Escape no surface consumed, and ignores every other key', () => {
    const { onClose } = mount()

    fireEvent.keyDown(document, { key: 'Enter' })
    expect(onClose).not.toHaveBeenCalled()

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('keeps the dialog open when an inner surface consumed the Escape', () => {
    const { onClose } = mount({ consumeEscape: true })

    fireEvent.keyDown(screen.getByLabelText('Device name'), { key: 'Escape' })

    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog')).toBeTruthy()
  })

  it('closes on its own close button and listens to no key while closed', () => {
    const { onClose } = mount()
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(onClose).toHaveBeenCalledOnce()
    cleanup()

    const closed = mount({ open: false })
    expect(screen.queryByRole('dialog')).toBeNull()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(closed.onClose).not.toHaveBeenCalled()
  })
})
