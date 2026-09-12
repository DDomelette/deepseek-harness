/**
 * Browser-floor compatibility for the Web shell: the standard APIs the shipped
 * bundles — and the third-party code they carry — call unconditionally, defined
 * here for engines that predate them. The same shell is served over plain HTTP to
 * whatever engine an operator's device ships (a LAN deployment exists so a phone
 * on the network can open it), and Android WebView builds rarely receive an
 * update, so the floor lives at the boot kernel instead of being re-derived per
 * call site.
 * @module @deepseek-ai/dsh-client-web/src/compat
 */

/** Structural view of the `AbortSignal` constructor for an API the runtime lib predates. */
interface AbortSignalHost {
  any?: (signals: readonly AbortSignal[]) => AbortSignal
}

/** Structural view of the `Promise` constructor for an API the runtime lib predates. */
interface PromiseHost {
  withResolvers?: <T>() => PromiseWithResolvers<T>
}

/** Structural view of a global that pre-ES2025 engines do not define. */
interface IteratorHost {
  Iterator?: unknown
}

/**
 * Fuse signals into one that aborts with the reason of whichever source aborts
 * first: `AbortSignal.any` as specified, without requiring the engine to have it.
 * Listeners are released when the fused signal aborts, so callers that fuse a
 * long-lived lifetime signal once per operation do not accumulate them.
 * @param sources - signals to fuse, in precedence order.
 * @returns a signal aborted by the first aborted source, carrying that source's reason.
 */
function fuseAbortSignals(sources: readonly AbortSignal[]): AbortSignal {
  const fused = new AbortController()
  const attached: { source: AbortSignal; listener: () => void }[] = []
  const release = (): void => {
    for (const entry of attached) entry.source.removeEventListener('abort', entry.listener)
    attached.length = 0
  }
  // A controller keeps the reason of its first abort() call, so the first source
  // to abort owns the fused reason; later calls cannot replace it.
  const abort = (source: AbortSignal): void => {
    release()
    fused.abort(source.reason)
  }
  for (const source of sources) {
    if (source.aborted) {
      abort(source)
      break
    }
    const listener = (): void => { abort(source) }
    attached.push({ source, listener })
    source.addEventListener('abort', listener)
  }
  return fused.signal
}

/** Define `AbortSignal.any` (Chrome 116, Safari 17.4) when the engine lacks it. */
function installAbortSignalAny(): void {
  const host = AbortSignal as unknown as AbortSignalHost
  if (typeof host.any === 'function') return
  host.any = fuseAbortSignals
}

/**
 * Define the ES2025 `Iterator` global (Chrome 117, Safari 18.4) when the engine
 * lacks it. The value is a carrier, not an implementation: `prototype` is the
 * intrinsic %IteratorPrototype% that engine-created iterators already inherit
 * from, which is where pdfjs-dist's import-time `Iterator.prototype.join`
 * polyfill lands so its call sites reach it.
 */
function installIteratorGlobal(): void {
  const host = globalThis as IteratorHost
  if (host.Iterator !== undefined) return
  // Two prototype hops from an engine iterator: %ArrayIteratorPrototype%, then
  // %IteratorPrototype% — the same intrinsic a generator iterator's chain ends at.
  const arrayIterator = ([] as unknown[]).values()
  host.Iterator = {
    prototype: Object.getPrototypeOf(Object.getPrototypeOf(arrayIterator) as object) as object,
  }
}

/** Define `Promise.withResolvers` (Chrome 119, Safari 17.4) when the engine lacks it. */
function installPromiseWithResolvers(): void {
  const host = Promise as unknown as PromiseHost
  if (typeof host.withResolvers === 'function') return
  host.withResolvers = function withResolvers<T>(): PromiseWithResolvers<T> {
    let resolve!: (value: T | PromiseLike<T>) => void
    let reject!: (reason?: unknown) => void
    const promise = new Promise<T>((settle, fail) => {
      resolve = settle
      reject = fail
    })
    return { promise, resolve, reject }
  }
}

/**
 * Define every browser API the shell's bundles expect, skipping the ones this
 * engine already provides. {@link AppWebEntry.run} installs the floor as its
 * first step, before any bundle is imported; a bundle that reaches for a further
 * API of this class adds its definition here rather than at the call site.
 */
export function installBrowserCompat(): void {
  installAbortSignalAny()
  installIteratorGlobal()
  installPromiseWithResolvers()
}
