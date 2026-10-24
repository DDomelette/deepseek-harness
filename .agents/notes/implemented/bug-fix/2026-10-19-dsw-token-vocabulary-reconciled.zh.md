# Agent Note: 特性样式表只引用已定义的 `--dsw-*` token

Status: implemented

[English](2026-10-19-dsw-token-vocabulary-reconciled.md) | 中文

## 问题

名字没有任何样式表定义的 `var(--dsw-*)` 会解析为它的 fallback，没有 fallback 时解析为 guaranteed-invalid 值，于是该属性悄悄保持初始值。`packages/client` 中特性样式表引用的二十一个 token 名在 `packages/client/ui-theme/src/styles/` 里没有定义，当前的各张样式表与合并前分支的 `design-platform.css` 也都没有定义它们。于是边框、填充、禁用标签、状态标签与代码字体族要么渲染成各处自带的字面值，要么根本不生效：终端状态条、设置页的技能与归档行、任务列表的实时卡片填充与等宽标签、文档预览与插件管理器的代码文本，以及设置表单的错误标签。

## 决策

`packages/client/ui-theme/src/styles/` 是 token 的权威，现在每一处特性引用都指向它声明过的名字：

| 引用名 | 已定义的替换 | 消费方 |
|---|---|---|
| `--dsw-alias-bg-l1` | `--dsw-alias-bg-layer-1` | ui-sidebar-terminal |
| `--dsw-alias-bg-l2` | `--dsw-alias-bg-layer-2` | ui-sidebar-terminal |
| `--dsw-alias-bg-layer-4` | `--dsw-alias-interactive-bg-hover` | ui-primitives 设置表单、ui-settings-subagent |
| `--dsw-alias-border-secondary` | `--dsw-alias-border-l2` | ui-settings-skills |
| `--dsw-alias-surface-primary` | `--dsw-alias-bg-layer-1` | ui-settings-skills |
| `--dsw-alias-surface-secondary` | `--dsw-alias-bg-layer-2` | ui-settings-skills |
| `--dsw-alias-state-error-label` | `--dsw-alias-state-error-primary` | ui-settings-skills |
| `--dsw-alias-label-error` | `--dsw-alias-state-error-primary` | ui-primitives 设置表单 |
| `--dsw-alias-label-quaternary` | `--dsw-alias-label-tertiary` | ui-agent-preset、ui-sidebar-browser |
| `--dsw-alias-separator-primary` | `--dsw-alias-label-tertiary` | ui-chat |
| `--dsw-alias-fill-l1` | `--dsw-alias-interactive-bg-hover` | ui-jobs |
| `--dsw-alias-fill-l2` | `--dsw-alias-interactive-bg-hover-solid` | ui-jobs |
| `--dsw-alias-fill-tertiary` | `--dsw-alias-interactive-bg-hover` | ui-attachment |
| `--dsw-alias-fill-tsp-secondary` | `--dsw-alias-interactive-bg-hover` | ui-agent-preset |
| `--dsw-color-text-secondary` | `--dsw-alias-label-secondary` | ui-settings-archived |
| `--dsw-color-border` | `--dsw-alias-border-l2` | ui-settings-archived |
| `--dsw-color-warning` | `--dsw-alias-state-warn-label` | ui-settings-archived |
| `--dsw-color-danger` | `--dsw-alias-state-error-primary` | ui-settings-archived |
| `--dsw-font` | `--dsw-font-family` | ui-sidebar-documentpreview |
| `--dsw-font-mono` | `--dsw-font-family-code` | ui-agent-preset、ui-jobs、ui-plugin-manager、ui-sidebar-documentpreview、experimental client-ui-claude-code-mods |
| `--dsw-font-sm-13` | `--dsw-font-xs-13` | ui-tool |

每个替换名都是样式表声明过的名字：配色与语义别名对照 `design-platform.css` 核对，字体栈对照 `base.css` 核对；那些让旧声明仍能解析的字面值或字体栈 fallback 一并删除。映射本身顺带产生两处已落地的调整，它们不是独立决定。`ArchivedSection` 的行分隔线现在指向中性边框 token，因此改画 elevation 样式表契约要求中性实线边框使用的 0.5px 发丝线。`terminal.module.css` 在 `.empty` 状态会滚动的面板上绘制 `--dsw-alias-bg-layer-2`，因此该面板声明了滚动条契约要求"在抬升表面上滚动"的样式表提供的那组 l2 滚动条变量。

`--dsw-font-family-code` 是唯一新增的 token。`packages/client/ui-theme/src/styles/base.css` 在 `:root` 与 `body` 上把它声明在 `--dsw-font-family`、`--dsw-font-family-brand` 旁边，解析为 `--ds-font-family-code`，也就是用户代码字体列表已经参数化的那个字体栈。它属于 `base.css`，因为那张表持有字体 token，而且它指向既有的代码字体栈而不是重写一份字体族列表；七处原本写 `--dsw-font-mono` 的特性样式表现在读它。

## 不是缺陷的名称

"被引用但未定义"的差异中有三个名字不是坏引用，保持原样：

- `--dsw-elevation-*` 是 `packages/client/ui-theme/src/styles/gradient-shadow-text.css` 注释里的通配写法，用来说明逐元素重新绑定；那行是散文，不是 `var()` 调用。
- `--dsw-hovercard-bg` 是 `packages/client/ui-primitives/src/HoverCard.module.css` 既声明又读取的组件局部属性，样式归属规则允许这种用法。
- `--dsw-radius-missing` 是 `packages/client/ui-theme/tests/radius-styles.client.spec.ts` 中的夹具字符串，用来证明圆角扫描器会报告未知的圆角 token。

## 强制检查

`scripts/verify-client-token-vocabulary.ts` 会让任何引用了 `packages/client/ui-theme/src/styles/` 中没有任何样式表声明过的 `var(--dsw-*)` 的写法人失败，并报告 `file:line: --token (no definition)`。主题样式表是唯一的定义权威：特性样式表自己的声明无法满足其他样式表的引用，因为自定义属性只沿元素树继承。`--dsw-hovercard-bg` 是唯一被允许的组件局部属性；测试源码不在扫描范围内，因此 `--dsw-radius-missing` 夹具无需进入允许清单。该检查与 `client-ui-i18n` 并列运行于 `ci-primary`、`ci-static` 与 `check-all`，并会在样式表语料缩小或引用数量少得可疑时拒绝通过。

## 备选方案

**把这二十一个名字补进 `design-platform.css`。** 否决：它们的值只能是编造的。本仓库没有任何样式表定义过它们，因此没有可还原的来源值，而它们暗示的 `--dsw-alias-fill-*`、`--dsw-color-*` 两族并不对应配色中的任何一层。

**在需要它的特性样式表里造一个专属 token 名。** 否决，违反样式归属规则：共享的颜色与字体决定属于主题包，特性模块里的一次性名字正是 token 表要防止的漂移。

**保留各处的字面值 fallback，只做名字映射。** 否决：正是这些 fallback 让声明仍可解析，主题因此从未作用到它们，其中若干还是组件规则禁止的字面颜色。

## 后果

- 边框、填充、禁用标签、状态标签与代码字体族都通过已定义的词汇解析；删掉的 fallback 让将来一次改名以可见的方式失败，而不是悄悄回到初始值。
- 引用集合少了二十一个过期名字，token 表现在完整描述特性样式表使用的词汇。
- 将来为组件样式表新增 token 时，它落在对应族旁边的主题样式表里；没有样式表定义的名字就是调用方的缺陷。
- 引用没有主题样式表定义的名字，现在会在 `pnpm run verify-client-token-vocabulary` 中失败，而不是带着属性的初始值渲染。
