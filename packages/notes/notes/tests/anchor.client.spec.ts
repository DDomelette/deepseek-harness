// @vitest-environment jsdom
/**
 * The anchor reader: which identities a collected passage carries, and what it
 * records when the row it came from carries none of them.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { anchorAt } from '../src/client/anchor.ts'

/** Mount one rendered row and return a text node inside its body. */
function selectable(html: string): Text {
  document.body.innerHTML = html
  const body = document.querySelector('[data-row-body]')
  if (body === null || body.firstChild === null) throw new Error('the fixture row has no body text')
  return body.firstChild as Text
}

afterEach(() => { document.body.innerHTML = '' })

describe('anchor reader', () => {
  it('reads the sequence and message a conversation row carries', () => {
    const start = selectable(`
      <div data-chat-anchor-key="user:1" data-chat-seq="42" data-chat-message-id="message-1">
        <p data-row-body>a passage</p>
      </div>
    `)

    expect(anchorAt(start)).toEqual({ seq: 42, messageId: 'message-1', callId: null })
  })

  it('reads the call a tool row carries', () => {
    const start = selectable(`
      <div data-chat-anchor-key="tool:1" data-chat-seq="7">
        <div data-chat-call-id="call-7" data-chat-anchor-key="call:call-7">
          <p data-row-body>tool output</p>
        </div>
      </div>
    `)

    expect(anchorAt(start)).toEqual({ seq: 7, messageId: null, callId: 'call-7' })
  })

  it('reads the sequence and call a trajectory row carries', () => {
    const start = selectable(`
      <table><tbody>
        <tr data-trajectory-row-key="assistant:seq:9" data-trajectory-seq="9" data-trajectory-call-id="call-9">
          <td><p data-row-body>a trajectory passage</p></td>
        </tr>
      </tbody></table>
    `)

    expect(anchorAt(start)).toEqual({ seq: 9, messageId: null, callId: 'call-9' })
  })

  it('records a zero sequence rather than treating it as absent', () => {
    const start = selectable('<div data-chat-anchor-key="user:0" data-chat-seq="0"><p data-row-body>x</p></div>')

    expect(anchorAt(start)).toEqual({ seq: 0, messageId: null, callId: null })
  })

  it('records nothing for a row that carries no identity', () => {
    const start = selectable('<div data-chat-anchor-key="turn:1"><p data-row-body>x</p></div>')

    expect(anchorAt(start)).toEqual({ seq: null, messageId: null, callId: null })
  })

  it('records nothing for a selection outside every row', () => {
    const start = selectable('<div><p data-row-body>elsewhere</p></div>')

    expect(anchorAt(start)).toEqual({ seq: null, messageId: null, callId: null })
  })

  it('records nothing for a sequence the store would reject', () => {
    const start = selectable('<div data-chat-anchor-key="assistant:9" data-chat-seq="51.9"><p data-row-body>x</p></div>')

    expect(anchorAt(start)).toEqual({ seq: null, messageId: null, callId: null })
  })

  it('records nothing for a sequence no number can hold', () => {
    const start = selectable('<div data-chat-anchor-key="user:9" data-chat-seq="99999999999999999999"><p data-row-body>x</p></div>')

    expect(anchorAt(start)).toEqual({ seq: null, messageId: null, callId: null })
  })

  it('records no message for an empty identity attribute', () => {
    const start = selectable('<div data-chat-anchor-key="user:9" data-chat-message-id=""><p data-row-body>x</p></div>')

    expect(anchorAt(start)).toEqual({ seq: null, messageId: null, callId: null })
  })

  it('records nothing for a node that is not mounted yet', () => {
    expect(anchorAt(document.createTextNode('detached'))).toEqual({ seq: null, messageId: null, callId: null })
    expect(anchorAt(null)).toEqual({ seq: null, messageId: null, callId: null })
  })
})
