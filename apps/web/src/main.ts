/** Browser entry for the Web client. */
import { AppWebEntry } from '@deepseek-ai/dsh-client-web'

// pdfjs-dist (bundled by the document-preview sidebar) polyfills
// `Iterator.prototype.join` at import time; browsers predating the ES2025
// Iterator global (Safari < 18.4, Chrome < 117) throw on the bare reference
// and take down the whole plugin tree. Hand it the intrinsic
// %IteratorPrototype% — the object generator iterators already inherit from —
// so the polyfill lands where its call sites can reach it.
if (typeof (globalThis as Record<string, unknown>).Iterator === 'undefined') {
  (globalThis as Record<string, unknown>).Iterator = {
    prototype: Object.getPrototypeOf(Object.getPrototypeOf(function* () { /* shim target only */ }).prototype),
  }
}

const el = document.getElementById('root')
if (el === null) throw new Error('web app: missing #root')
void new AppWebEntry(el).run()

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('/sw.js').catch(() => {})
  })
}
