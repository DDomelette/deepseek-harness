/**
 * Client-safe type surface of the skill seam: the user-invocation source and
 * the seam's Cordis event declarations. Types only — no runtime code, and
 * nothing here reaches a Host-only symbol, so a Client compilation face reads
 * exactly the signatures the Host emits.
 *
 * @module @deepseek-ai/dsh-skill/types
 */

/**
 * Durable source for the context message a user-explicit skill invocation
 * injects: the user's own words ride a plain user message, and the rendered
 * skill body follows as injected `instructions`-form context carrying this
 * source, so transcript consumers present the injection from metadata
 * instead of re-parsing the model-facing text.
 */
export interface SkillInvocationSource {
  readonly kind: 'skill-invocation'
  /** Invoked skill name, validated user-invocable at the injecting boundary. */
  readonly name: string
  /** Injected skill bodies are instructions for the model to follow. */
  readonly form: 'instructions'
}

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    /** A user-explicit skill invocation injected by the host. */
    'skill-invocation': SkillInvocationSource
  }
}

declare module '@deepseek-ai/cordis' {
  interface Events {
    /**
     * A skill provider, runtime contribution, or effective invocation policy
     * may have changed. This is an unfiltered invalidation notification;
     * consumers refetch the catalog for their own lookup options. Listener
     * failures are contained and cannot veto the registry mutation.
     * @mode emit
     */
    'skills/change'(): void
  }
}
