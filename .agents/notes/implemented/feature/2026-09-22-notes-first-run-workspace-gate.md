# Agent Note: First-run workspace gate for the notes panel

Status: implemented

English | [中文](2026-09-22-notes-first-run-workspace-gate.zh.md)

## Problem

The notes panel offered its full chrome — new conversation, history, settings, refresh, float — before any workspace was configured, and the first click on 新建会话 only then reported `workspace-missing`. First-run setup was a refusal, not a flow.

## Decision

While the settings section resolves to no workspace, the panel mounts only the `WorkspaceGate`: a centered card with a folder icon, one title line, one hint line, and the workspace directory field. Every other control — the whole navigation bar, the empty state's create button, the image input — stays out of the tree, so nothing the reader can reach depends on a workspace that does not exist yet. The gate condition is exactly `settings.workspace === null` on the already-read section: an unread or refused settings read is not the gate, because that state carries its own loading and failure lines and must not masquerade as first-run.

The directory field is the one the settings card already edited, extracted as `WorkspaceField` (input plus browse, falling back to the host-listing browser when the deployment serves no native chooser) so the gate and the card share one write path: picking or choosing a directory is a deliberate value and saves immediately through `notes/settingsUpdate`, and the re-read section naming the directory ungates the panel. Clearing the directory in the settings card returns the panel to the gate, which is the same condition doing its work, not a second mechanism.

## Alternatives considered

- **Gate on "settings not yet answered" as well.** Rejected: it would flash the gate on every fresh mount for every deployment, and a refused settings read (no provider mounted) would strand the reader behind a picker whose save cannot land; the normal content with its failure line is the right answer there.
- **A modal or app-level onboarding surface.** Rejected: `OnboardingSurface` portals over the whole application and inerts the root, which is heavier than the request — the gate belongs to the notes panel alone, and the rest of the app must stay usable while it shows.
- **Duplicating the browse flow inside the gate.** Rejected: the native-pick-then-browser fallback is exactly the settings card's flow, and two copies would drift; `WorkspaceField` is the shared component and `WorkspaceField.module.css` owns the field and browser recipes the card now composes from.

## Consequences

- `notes-panel.client.spec.tsx` gains a `first-run workspace gate` block: the gate hides every other control and starts no conversation; a native pick saves `{ workspace }` and ungates; a deployment without a native chooser browses the host's listing and chooses a level to the same effect (436 package tests pass).
- `NotesSettingsCard.tsx` loses its private `DirectoryBrowser` and browse state to `WorkspaceField.tsx`; its module CSS composes `field` from the shared module, and the card's data attributes and commit behavior are unchanged.
- The known-limitation line about shipping no first-run setup screen is rewritten in both READMEs: the gate is the setup screen, and `workspace-missing` remains the wire refusal for starts attempted outside the panel.
