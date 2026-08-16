# @deepseek-ai/dsh-client-ui-settings-archived

[English](README.md) | 中文

DeepSeek Harness Web GUI 的已归档对话设置板块。

## 界面

该插件注册 `settings.section` 条目 `archived`，order 为 40。页面从现有 sessions 与 workspaces 基线派生分组；不新增列表 RPC。

## 行为

- 分组遵循 workspace registry 顺序，随后是底部的“未分组”。
- 恢复会取消归档、打开会话并关闭设置页。
- 删除请求递归删除，并且总是先打开确认对话框。
- 运行中的行保留恢复按钮，禁用删除按钮。

## 错误

- 基线失败显示 `loadFailed` 与“重试”。
- 恢复失败留在行内显示。
- 删除失败保持确认对话框打开。

## 模型体验

不产生模型 token，不注册工具或提示词；该插件仅是用户可见的 Web UI。
