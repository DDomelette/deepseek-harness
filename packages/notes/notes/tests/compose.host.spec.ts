/**
 * Content composition: an action contributes its prompt template, a text
 * material submits its body under that template, a screenshot submits the
 * reference it was stored as, and resolving the action a material names tells a
 * caller whether the current configuration still offers it.
 */
import { describe, expect, it } from 'vitest'
import { actionFor, composeContent } from '../src/compose.ts'
import type { ActionDef } from '../src/settings.ts'
import { imageRef, material, noteId } from './bench.ts'

const translate: ActionDef = {
  id: 'translate',
  label: '翻译',
  prompt: '不改变语句结构，翻译下列内容：',
  autoSend: true,
}

describe('action resolution', () => {
  it('resolves the action a material names', () => {
    expect(actionFor('translate', [translate])).toBe(translate)
  })

  it('resolves nothing for a material that names no action', () => {
    expect(actionFor(null, [translate])).toBeUndefined()
  })

  it('resolves nothing for an action the configuration no longer offers', () => {
    expect(actionFor('gone', [translate])).toBeUndefined()
  })
})

describe('text composition', () => {
  it('submits the material text unchanged without an action', () => {
    expect(composeContent(material({ noteId: noteId('n1'), text: 'body' }), undefined))
      .toEqual([{ type: 'text', text: 'body' }])
  })

  it('prepends the action prompt template', () => {
    const stored = material({ noteId: noteId('n1'), text: 'body', action: 'translate' })
    expect(composeContent(stored, translate))
      .toEqual([{ type: 'text', text: '不改变语句结构，翻译下列内容：\nbody' }])
  })

  it('reads a text-less material as an empty body', () => {
    expect(composeContent(material({ noteId: noteId('n1'), text: null }), undefined))
      .toEqual([{ type: 'text', text: '' }])
  })
})

describe('screenshot composition', () => {
  it('submits the stored reference as an image block', () => {
    const stored = material({ noteId: noteId('n1'), kind: 'image', text: null, image: imageRef() })

    expect(composeContent(stored, undefined)).toEqual([{ type: 'image', attachment: imageRef() }])
  })

  it('puts the action template in front of the image it collected through', () => {
    const stored = material({
      noteId: noteId('n1'),
      kind: 'image',
      text: null,
      image: imageRef(),
      action: 'translate',
    })

    expect(composeContent(stored, translate)).toEqual([
      { type: 'text', text: '不改变语句结构，翻译下列内容：' },
      { type: 'image', attachment: imageRef() },
    ])
  })
})
