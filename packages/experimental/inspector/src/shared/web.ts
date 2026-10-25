/** Authenticated browser bootstrap route; the debugging URL stays on the Host. */

/** Read the current browser-source connection parameters. */
export const INSPECTOR_BOOTSTRAP_PATH = '/api/experimental-inspector/bootstrap'

/** Document-relative browser route for the authenticated source bootstrap. */
export const INSPECTOR_BOOTSTRAP_ROUTE = INSPECTOR_BOOTSTRAP_PATH.slice(1)
