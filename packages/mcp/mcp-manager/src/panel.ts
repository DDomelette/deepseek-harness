/** Read-only roster used by the MCP settings tab. */
import { Context } from '@deepseek-ai/cordis'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { McpServerSnapshot } from './types.ts'

/** Panel-specific view over the manager's configuration and runtime status. */
export class McpPanelRemote extends TypertRemoteService {
  constructor(ctx: Context, private readonly config: { snapshot: () => McpServerSnapshot }) { super(ctx, 'mcpServers') }

  /** Read the panel roster.
   * @returns the configured and declarative roster without credential values.
   */
  @Remote('list')
  list(): McpServerSnapshot { return this.config.snapshot() }
}
