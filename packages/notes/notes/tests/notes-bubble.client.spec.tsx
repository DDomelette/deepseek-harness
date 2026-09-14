// @vitest-environment jsdom
/**
 * The selection bubble: what a reader selected in the conversation, the actions
 * the deployment offers for it, and what a collection sends to the Host.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { SelectionBubble } from '../src/client/SelectionBubble.tsx'
import { harness, materialId, sessions, unavailable } from './fixtures.client.ts'

// jsdom lays nothing out and its Range has no client rectangle at all, so the
// geometry a browser supplies is stubbed here: the bubble only reads where the
// selection sits, and this is where it sits.
const originalRect = Object.getOwnPropertyDescriptor(Range.prototype, 'getBoundingClientRect')

beforeAll(() => {
  Object.defineProperty(Range.prototype, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({ left: 10, top: 20, width: 30, height: 8 }) as DOMRect,
  })
})

afterAll(() => {
  if (originalRect === undefined) Reflect.deleteProperty(Range.prototype, 'getBoundingClientRect')
  else Object.defineProperty(Range.prototype, 'getBoundingClientRect', originalRect)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  window.getSelection()?.removeAllRanges()
})

/** One element holding conversation content, with a selectable passage in it. */
function contentWith(text = 'a passage worth keeping'): HTMLElement {
  const host = document.createElement('div')
  const paragraph = document.createElement('p')
  paragraph.textContent = text
  host.append(paragraph)
  document.body.append(host)
  return host
}

/** Select one node's text, the way a reader's drag does. */
function select(node: Node): void {
  const range = document.createRange()
  range.selectNodeContents(node)
  const selection = window.getSelection()
  selection?.removeAllRanges()
  selection?.addRange(range)
}

describe('selection bubble', () => {
  it('offers the deployment\'s actions over a selection inside the conversation', async () => {
    const bench = harness()
    const content = contentWith()
    render(<SelectionBubble {...bench.bubbleProps({ content })} />)

    select(content.firstChild as Node)
    fireEvent(document, new Event('selectionchange'))

    await waitFor(() => { expect(document.querySelector('[data-notes-bubble]')).not.toBeNull() })
    expect(screen.getByText('collect.add')).toBeDefined()
    // The action comes from the notes settings section the bubble read.
    await waitFor(() => { expect(document.querySelector('[data-notes-collect-action="translate"]')).not.toBeNull() })
  })

  it('sends a plain collection with the passage and a localized source', async () => {
    const bench = harness()
    const content = contentWith()
    render(<SelectionBubble {...bench.bubbleProps({ content })} />)
    select(content.firstChild as Node)
    fireEvent(document, new Event('selectionchange'))
    await waitFor(() => { expect(screen.getByText('collect.add')).toBeDefined() })
    bench.remote.sessionList.mockResolvedValue(sessions([], [], null))

    fireEvent.click(screen.getByText('collect.add'))

    await waitFor(() => { expect(bench.remote.sessionCreate).toHaveBeenCalledTimes(1) })
    await waitFor(() => { expect(bench.remote.materialAddText).toHaveBeenCalledTimes(1) })
    expect(bench.remote.materialAddText.mock.calls[0]?.[0]).toMatchObject({
      text: 'a passage worth keeping',
      action: null,
      source: {
        view: 'chat',
        seq: null,
        messageId: null,
        callId: null,
        label: 'collect.source',
      },
    })
  })

  it('sends the action the reader picked', async () => {
    const bench = harness()
    const content = contentWith()
    render(<SelectionBubble {...bench.bubbleProps({ content })} />)
    select(content.firstChild as Node)
    fireEvent(document, new Event('selectionchange'))
    const action = await screen.findByText('翻译')

    fireEvent.click(action)

    await waitFor(() => { expect(bench.remote.materialAddText).toHaveBeenCalledTimes(1) })
    expect(bench.remote.materialAddText.mock.calls[0]?.[0]).toMatchObject({ action: 'translate' })
  })

  it('reports a refusal instead of closing over it', async () => {
    const bench = harness()
    const content = contentWith()
    render(<SelectionBubble {...bench.bubbleProps({ content })} />)
    select(content.firstChild as Node)
    fireEvent(document, new Event('selectionchange'))
    await waitFor(() => { expect(screen.getByText('collect.add')).toBeDefined() })
    bench.remote.materialAddText.mockResolvedValueOnce({ ok: false, error: unavailable('socket closed') })

    fireEvent.click(screen.getByText('collect.add'))

    await waitFor(() => { expect(document.querySelector('[data-notes-collect-failure]')).not.toBeNull() })
    expect(screen.getByText('error.remoteUnavailable(message=socket closed)')).toBeDefined()
    // The passage stays selected, so the reader can try again.
    expect(document.querySelector('[data-notes-bubble]')).not.toBeNull()
  })

  it('reports the Host\'s own refusal', async () => {
    const bench = harness()
    const content = contentWith()
    render(<SelectionBubble {...bench.bubbleProps({ content })} />)
    select(content.firstChild as Node)
    fireEvent(document, new Event('selectionchange'))
    await waitFor(() => { expect(screen.getByText('collect.add')).toBeDefined() })
    bench.remote.materialAddText.mockResolvedValueOnce({
      ok: true,
      value: { ok: false, error: { code: 'session-not-found', id: materialId('n1') as never } },
    })

    fireEvent.click(screen.getByText('collect.add'))

    await waitFor(() => { expect(screen.getByText('error.sessionNotFound')).toBeDefined() })
  })

  it('shows nothing for a selection outside the conversation', async () => {
    const bench = harness()
    const content = contentWith()
    const outside = contentWith('elsewhere')
    render(<SelectionBubble {...bench.bubbleProps({ content })} />)

    select(outside.firstChild as Node)
    fireEvent(document, new Event('selectionchange'))

    expect(document.querySelector('[data-notes-bubble]')).toBeNull()
  })

  it('shows nothing for a collapsed selection', async () => {
    const bench = harness()
    const content = contentWith()
    render(<SelectionBubble {...bench.bubbleProps({ content })} />)

    const range = document.createRange()
    range.setStart(content.firstChild as Node, 0)
    range.collapse(true)
    const selection = window.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)
    fireEvent(document, new Event('selectionchange'))

    expect(document.querySelector('[data-notes-bubble]')).toBeNull()
  })

  it('shows nothing before the conversation content is mounted', () => {
    const bench = harness()
    render(<SelectionBubble {...bench.bubbleProps()} />)

    select(contentWith().firstChild as Node)
    fireEvent(document, new Event('selectionchange'))

    expect(document.querySelector('[data-notes-bubble]')).toBeNull()
  })

  it('shows nothing when the document reports no selection at all', () => {
    const bench = harness()
    const content = contentWith()
    render(<SelectionBubble {...bench.bubbleProps({ content })} />)
    vi.stubGlobal('getSelection', () => null)

    fireEvent(document, new Event('selectionchange'))

    expect(document.querySelector('[data-notes-bubble]')).toBeNull()
  })

  it('shows nothing over a View whose collection the notes cannot name', async () => {
    const bench = harness()
    const content = contentWith()
    render(<SelectionBubble {...bench.bubbleProps({ content, view: 'other' })} />)

    select(content.firstChild as Node)
    fireEvent(document, new Event('selectionchange'))

    expect(document.querySelector('[data-notes-bubble]')).toBeNull()
  })

  it('collects a trajectory selection as one', async () => {
    const bench = harness()
    const content = contentWith()
    render(<SelectionBubble {...bench.bubbleProps({ content, view: 'trajectory' })} />)
    select(content.firstChild as Node)
    fireEvent(document, new Event('selectionchange'))
    await waitFor(() => { expect(screen.getByText('collect.add')).toBeDefined() })

    fireEvent.click(screen.getByText('collect.add'))

    await waitFor(() => { expect(bench.remote.materialAddText).toHaveBeenCalledTimes(1) })
    expect(bench.remote.materialAddText.mock.calls[0]?.[0]).toMatchObject({ source: { view: 'trajectory' } })
  })
})
