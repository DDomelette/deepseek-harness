/** Promise-based stream helpers from the maintained browser stream implementation. */
import { promises } from '../stream.ts'

/** Promise variants share the same stream classes and lifecycle as `node:stream`. */
const { pipeline, finished } = promises
export { pipeline, finished }

/** CommonJS interop marker consumed by the worker module loader. */
export const __esModule = true

/** CommonJS-compatible promise helper namespace. */
export default promises
