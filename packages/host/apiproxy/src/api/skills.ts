/**
 * skills domain contract: read-only skill catalog lookup addressed by session.
 * The session's header cwd resolves to the canonical project root host-side —
 * the client never submits a raw path, and skill lookup never creates or
 * resumes an Agent.
 */

import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { RpcRequest, RpcResponse } from './rpc.ts'

/** Skill catalog row (wire projection of the host SkillSummary; provider/source vocabulary stays host-side). */
export interface SkillEntry {
  /** Kebab-case identifier the user references as `/name` in the composer. */
  readonly name: string
  /** Short routing description. */
  readonly description: string
  /** Optional extra routing guidance. */
  readonly whenToUse?: string
  /** False marks a user-only skill (`disable-model-invocation`): invocable here, absent from the model catalog. */
  readonly modelInvocable: boolean
}

/**
 * Full catalog row served to the skills settings panel. Unlike {@link SkillEntry}
 * this row carries every skill regardless of invocation policy, plus the
 * grouping metadata the panel aggregates by and the user-override state.
 */
export interface SkillCatalogEntry {
  /** Kebab-case identifier used to address the skill. */
  readonly name: string
  /** Short routing description. */
  readonly description: string
  /** Optional extra routing guidance. */
  readonly whenToUse?: string
  /** Optional grouping label declared by the skill. */
  readonly group?: string
  /** Discovery source bucket, the panel's grouping fallback. */
  readonly source: string
  /** Effective model invocation flag, user overrides included. */
  readonly modelInvocable: boolean
  /** Effective user invocation flag, user overrides included. */
  readonly userInvocable: boolean
  /** Whether a user setting switches this skill off entirely. */
  readonly disabled: boolean
}

/**
 * Skill-domain unary methods (the map key skill.* of RpcMethodMap). Listing
 * and cataloging are the domain's only RPCs: invocation itself is a plain
 * `session.prompt` whose leading `/name` token the host recognizes at the
 * pre-step boundary (`dsh-tool-skill` injects the rendered body there), so
 * every client shares one deterministic path with no dedicated invocation
 * wire.
 */
export interface SkillsApi {
  /** Lists the user-invocable skill catalog for the session's project. */
  list(request: RpcRequest<{ sessionId: SessionId }>): Promise<RpcResponse<{ skills: readonly SkillEntry[] }>>
  /**
   * Serves the complete catalog for the session's composition — every skill
   * regardless of invocation policy, the same cwd/scope resolution as
   * {@link list}, plus grouping metadata and the user-disabled marker.
   */
  catalog(request: RpcRequest<{ sessionId: SessionId }>): Promise<RpcResponse<{ skills: readonly SkillCatalogEntry[] }>>
}
