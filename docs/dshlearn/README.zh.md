# dshlearn —— harness 架构的可视化导读

[English](README.md) | 中文

自包含的 HTML 页面，用来直观呈现 DeepSeek Harness 是怎么拼起来的。每页都是一个内联 CSS 与 JavaScript 的单文件，直接用浏览器打开：不需要构建、不需要服务器、不访问网络、没有依赖。

两页描述的都是当前行为，架构页不引用任何生成物。包目录是例外：它的数据来自 workspace，所以包发生变动后它会过期。

第三页记录了[这些页面是怎么讲 harness 的](explaining-the-harness.zh.md)，以及更早一版 turn 走查讲错了什么。

## 页面

| 页面 | 呈现内容 |
|---|---|
| [`architecture-visual.html`](architecture-visual.html) | profile 的叠加顺序、产品脊柱、可逐步播放的 turn/step 生命周期（含每一帧流过的数据）、三个事件域、上下文组装与注入、Skill 与 MCP、能力接缝、会话日志，以及被守卫的工具管线 |
| [`plugins-visual.html`](plugins-visual.html) | 12 个类目下的全部 workspace 包，每个带接缝角色、`ctx` key 与一句话描述；支持文本搜索与按角色筛选 |

## 重新生成包目录

包目录内嵌的是从 workspace 提取的数据，不是手写的文字。[`tools/`](tools/README.zh.md) 拥有提取脚本、人工确认过的描述与渲染器；运行它们之前先读那一页。
