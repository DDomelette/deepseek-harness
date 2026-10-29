/** Native readline interfaces are unavailable in the Worker host. */
import { notImplementedFail } from '../../notImplementedFail.ts'

/** Readline interface construction (unavailable). */
export const createInterface: typeof import('node:readline').createInterface = notImplementedFail('node:readline', 'createInterface')

/** CommonJS interop marker consumed by the worker module loader. */
export const __esModule = true

/** CommonJS namespace for importers that do not construct a native interface. */
export default { createInterface } satisfies Partial<typeof import('node:readline')>
