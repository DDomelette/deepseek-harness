# @deepseek-ai/dsh-client-ui-settings-archived

English | [中文](README.zh.md)

Archived conversations settings section for the DeepSeek Harness Web GUI.

## Surface

The plugin registers `settings.section` entry `archived` at order 40. The page derives its groups from the existing sessions and workspaces baselines; it adds no list RPC.

## Behavior

- Groups follow workspace registry order, then Ungrouped last.
- Each row shows its archive date under the title; sessions archived before the host recorded times show an unknown-time placeholder.
- A details button opens a fixed-field dialog: group, directory, agent preset, archive time, last activity, status, subagent count, and session id.
- Restore unarchives, opens the session, and closes settings.
- Delete requests recursive deletion and always opens a confirmation dialog.
- Running rows keep restore enabled and disable delete.

## Errors

- `loadFailed` with Retry covers baseline failures.
- Restore failures stay inline on the row.
- Delete failures keep the confirmation dialog open.

## Model Experience

### Request context and condition

#### What the model sees

No model-facing surface from this package. The plugin renders the archived-conversations `settings.section` entry only and registers no tools, prompts, or session events.

#### Token effect

Zero direct tokens.

#### KV Cache effect

Independent of live requests.

## Known Limitations and Deferred Work

- **Archive dates are not reconstructed for older records** — sessions archived before archive-time metadata show the unknown-time placeholder.
- **The inventory shares the existing session baseline** — the page has no independent archived-session search or pagination RPC.
