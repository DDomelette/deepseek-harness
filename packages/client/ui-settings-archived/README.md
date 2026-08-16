# @deepseek-ai/dsh-client-ui-settings-archived

English | [中文](README.zh.md)

Archived conversations settings section for the DeepSeek Harness Web GUI.

## Surface

The plugin registers `settings.section` entry `archived` at order 40. The page derives its groups from the existing sessions and workspaces baselines; it adds no list RPC.

## Behavior

- Groups follow workspace registry order, then Ungrouped last.
- Restore unarchives, opens the session, and closes settings.
- Delete requests recursive deletion and always opens a confirmation dialog.
- Running rows keep restore enabled and disable delete.

## Errors

- `loadFailed` with Retry covers baseline failures.
- Restore failures stay inline on the row.
- Delete failures keep the confirmation dialog open.

## Model Experience

No model tokens, tools, or prompts; the plugin is user-visible Web UI only.
