// @vitest-environment jsdom
/**
 * The selection bubble: what a reader selected in the conversation, the actions
 * the deployment offers for it, and what a collection sends to the Host.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { SelectionBubble, placeBubble } from '../src/client/SelectionBubble.tsx'
import { harness, materialId, sessions, unavailable } from './fixtures.client.ts'

// jsdom lays nothing out and its Range has no client rectangle at all, so the
// geometry a browser supplies is stubbed here: the bubble only reads where the
// selection sits, and this is where it sits.
const originalRect = Object.getOwnPropertyDescriptor(Range.prototype, 'getBoundingClientRect')

/** The selection rectangle the current test reports. */
let currentRect = { left: 10, top: 20, width: 30, height: 8, right: 40, bottom: 28 }

beforeAll(() => {
  Object.defineProperty(Range.prototype, 'getBoundingClientRect', {
    configurable: true,
    value: () => currentRect as DOMRect,
  })
})

afterAll(() => {
  if (originalRect === undefined) Reflect.deleteProperty(Range.prototype, 'getBoundingClientRect')
  else Object.defineProperty(Range.prototype, 'getBoundingClientRect', originalRect)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  currentRect = { left: 10, top: 20, width: 30, height: 8, right: 40, bottom: 28 }
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

/** One element holding a rendered row around its selectable passage. */
function contentIn(row: string, text = 'a passage worth keeping'): HTMLElement {
  const host = document.createElement('div')
  host.innerHTML = `<div ${row}><p>${text}</p></div>`
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

  it('sends the identities of the row the passage started in', async () => {
    const bench = harness()
    const content = contentIn('data-chat-anchor-key="user:1" data-chat-seq="42" data-chat-message-id="message-1"')
    render(<SelectionBubble {...bench.bubbleProps({ content })} />)
    select(content.querySelector('p') as Node)
    fireEvent(document, new Event('selectionchange'))
    await waitFor(() => { expect(screen.getByText('collect.add')).toBeDefined() })
    bench.remote.sessionList.mockResolvedValue(sessions([], [], null))

    fireEvent.click(screen.getByText('collect.add'))

    await waitFor(() => { expect(bench.remote.materialAddText).toHaveBeenCalledTimes(1) })
    expect(bench.remote.materialAddText.mock.calls[0]?.[0]?.source).toMatchObject({
      view: 'chat',
      seq: 42,
      messageId: 'message-1',
      callId: null,
    })
  })

  it('sends the call of the tool row a passage came from', async () => {
    const bench = harness()
    const content = contentIn('data-chat-anchor-key="tool:1" data-chat-seq="7"')
    const wrapper = document.createElement('div')
    wrapper.setAttribute('data-chat-call-id', 'call-7')
    wrapper.setAttribute('data-chat-anchor-key', 'call:call-7')
    wrapper.append(content.querySelector('p') as Node)
    content.firstElementChild?.append(wrapper)
    render(<SelectionBubble {...bench.bubbleProps({ content })} />)
    select(content.querySelector('p') as Node)
    fireEvent(document, new Event('selectionchange'))
    await waitFor(() => { expect(screen.getByText('collect.add')).toBeDefined() })
    bench.remote.sessionList.mockResolvedValue(sessions([], [], null))

    fireEvent.click(screen.getByText('collect.add'))

    await waitFor(() => { expect(bench.remote.materialAddText).toHaveBeenCalledTimes(1) })
    expect(bench.remote.materialAddText.mock.calls[0]?.[0]?.source).toMatchObject({
      seq: 7,
      messageId: null,
      callId: 'call-7',
    })
  })

  it('sends the sequence of the trajectory row a passage came from', async () => {
    const bench = harness()
    const content = contentIn('data-trajectory-row-key="assistant:seq:9" data-trajectory-seq="9"')
    render(<SelectionBubble {...bench.bubbleProps({ content, view: 'trajectory' })} />)
    select(content.querySelector('p') as Node)
    fireEvent(document, new Event('selectionchange'))
    await waitFor(() => { expect(screen.getByText('collect.add')).toBeDefined() })
    bench.remote.sessionList.mockResolvedValue(sessions([], [], null))

    fireEvent.click(screen.getByText('collect.add'))

    await waitFor(() => { expect(bench.remote.materialAddText).toHaveBeenCalledTimes(1) })
    expect(bench.remote.materialAddText.mock.calls[0]?.[0]?.source).toMatchObject({
      view: 'trajectory',
      seq: 9,
      messageId: null,
      callId: null,
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

describe('selection bubble placement', () => {
  const viewport = { width: 1024, height: 768 }
  const size = { width: 200, height: 40 }

  it('centers on the selection above it', () => {
    expect(placeBubble(viewport, { midX: 500, top: 100, bottom: 120 }, size)).toEqual({
      left: 500, top: 100, side: 'above',
    })
  })

  it('clamps into the viewport at the left and right edges', () => {
    expect(placeBubble(viewport, { midX: 5, top: 100, bottom: 120 }, size).left).toBe(108)
    expect(placeBubble(viewport, { midX: 1020, top: 100, bottom: 120 }, size).left).toBe(916)
  })

  it('centers a bubble wider than the viewport instead of clamping', () => {
    expect(placeBubble({ width: 120, height: 768 }, { midX: 60, top: 100, bottom: 120 }, size).left).toBe(60)
  })

  it('flips below the selection when the space above is too short', () => {
    expect(placeBubble(viewport, { midX: 500, top: 30, bottom: 50 }, size)).toEqual({
      left: 500, top: 58, side: 'below',
    })
  })

  it('flips the rendered bubble below a selection at the top edge', async () => {
    const bench = harness()
    const content = contentWith()
    render(<SelectionBubble {...bench.bubbleProps({ content })} />)
    currentRect = { left: 10, top: 2, width: 30, height: 8, right: 40, bottom: 10 }

    select(content.firstChild as Node)
    fireEvent(document, new Event('selectionchange'))

    // jsdom measures the bubble itself as zero-sized, so only the flip shows.
    await waitFor(() => {
      expect(document.querySelector('[data-notes-bubble-side="below"]')).not.toBeNull()
    })
  })
})

describe('selection bubble dismissal', () => {
  it('closes on Escape and consumes the key', async () => {
    const bench = harness()
    const content = contentWith()
    render(<SelectionBubble {...bench.bubbleProps({ content })} />)
    select(content.firstChild as Node)
    fireEvent(document, new Event('selectionchange'))
    await waitFor(() => { expect(document.querySelector('[data-notes-bubble]')).not.toBeNull() })

    const escape = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true })
    fireEvent(document, escape)

    expect(document.querySelector('[data-notes-bubble]')).toBeNull()
    expect(escape.defaultPrevented).toBe(true)
  })

  it('leaves an Escape a surface above it already consumed', async () => {
    const above = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') event.preventDefault()
    }
    document.addEventListener('keydown', above)
    const bench = harness()
    const content = contentWith()
    render(<SelectionBubble {...bench.bubbleProps({ content })} />)
    select(content.firstChild as Node)
    fireEvent(document, new Event('selectionchange'))
    await waitFor(() => { expect(document.querySelector('[data-notes-bubble]')).not.toBeNull() })

    fireEvent(document, new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }))

    expect(document.querySelector('[data-notes-bubble]')).not.toBeNull()
    document.removeEventListener('keydown', above)
  })

  it('ignores a key that is not Escape', async () => {
    const bench = harness()
    const content = contentWith()
    render(<SelectionBubble {...bench.bubbleProps({ content })} />)
    select(content.firstChild as Node)
    fireEvent(document, new Event('selectionchange'))
    await waitFor(() => { expect(document.querySelector('[data-notes-bubble]')).not.toBeNull() })

    fireEvent.keyDown(document, { key: 'Enter' })

    expect(document.querySelector('[data-notes-bubble]')).not.toBeNull()
  })

  it('closes when the conversation scrolls under it', async () => {
    const bench = harness()
    const content = contentWith()
    const scroller = document.createElement('div')
    document.body.append(scroller)
    render(<SelectionBubble {...bench.bubbleProps({ content })} />)
    select(content.firstChild as Node)
    fireEvent(document, new Event('selectionchange'))
    await waitFor(() => { expect(document.querySelector('[data-notes-bubble]')).not.toBeNull() })

    // Scroll does not bubble; the capture listener still sees an inner scroller.
    fireEvent(scroller, new Event('scroll'))

    expect(document.querySelector('[data-notes-bubble]')).toBeNull()
  })

  it('stays and re-measures when the window resizes', async () => {
    const bench = harness()
    const content = contentWith()
    render(<SelectionBubble {...bench.bubbleProps({ content })} />)
    select(content.firstChild as Node)
    fireEvent(document, new Event('selectionchange'))
    await waitFor(() => { expect(document.querySelector('[data-notes-bubble]')).not.toBeNull() })

    fireEvent(window, new Event('resize'))

    expect(document.querySelector('[data-notes-bubble]')).not.toBeNull()
  })
})
