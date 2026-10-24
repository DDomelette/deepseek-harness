/** Native pnpm and git processes cannot execute inside the browser Worker. */
import { notImplementedFail } from '../notImplementedFail.ts'

/** Refuse native package-manager and repository commands explicitly. */
export const execa = notImplementedFail('execa', 'execa')

/** CommonJS interop marker for the Worker module loader. */
export const __esModule = true

/** CommonJS namespace for the package manager's named process helper. */
export default { execa }
