/** The Node OTLP client's socket and HTTP-agent transport cannot run in a browser Worker. */
import { notImplementedFail } from '../notImplementedFail.ts'

/** Refuse native OTLP HTTP requests without claiming a successful export. */
export const post = notImplementedFail('got', 'post')

/** CommonJS interop marker for the Worker module loader. */
export const __esModule = true

/** Default HTTP client namespace used by the Node event exporter. */
export default { post }
