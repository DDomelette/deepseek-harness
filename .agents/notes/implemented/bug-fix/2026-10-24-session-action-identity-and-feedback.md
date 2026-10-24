# Agent Note: Session action identity and optional feedback

Status: implemented

English | [中文](2026-10-24-session-action-identity-and-feedback.zh.md)

## Problem

The Web command UI identifies first-party commands by their definition ids. A feedback or export producer without that id remains executable, but loses its localized first-party presentation. The Session header also needs a feedback action that follows the feedback plugin's lifetime without making Session export depend on that plugin being enabled.

## Decision

The feedback and export producers declare their package names as branded `CommandDefinitionId` values. Names continue to select command execution and scoped shadowing under the [command registry](../feature/2026-07-19-plugin-command-registration.md); the definition id selects first-party Client presentation.

The Session export plugin observes the optional `feedbackUi` service through Cordis injection and publishes availability through a stable observable source. The framework binds that source to the header's hook. The menu offers feedback only while the service is available, and its callback reads the service again because the plugin can unload between render and click. Opening feedback closes the menu and opens the existing Session draft without recording or downloading anything. Export remains available independently.

## Alternatives considered

**Identify first-party commands by name or description.** A scoped plugin can reuse either value. The definition id preserves the producer's identity without interpreting display copy.

**Require the feedback plugin before activating Session export.** Feedback is optional. Its absence cannot remove the independent download action.

**Cache the feedback service in the menu callback.** The captured service could outlive its plugin. Reading `ctx.get('feedbackUi')` at the gesture avoids calling a retired surface.

## Consequences

Command producers own stable ids, while the feedback plugin owns its dialog and Session state. The export plugin owns only the optional menu contribution and its availability observation. This adds a type-only development dependency on the feedback service declaration, without importing another feature's runtime implementation.

Loader tests verify producer identities. Header and plugin tests cover availability changes, unload, reload, menu dismissal, and independence from downloads. The browser feedback scenario verifies that dismissing a draft records nothing and submitting records exactly the requested Session feedback.
