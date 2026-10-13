---
description: "Web GUI 的 agent（智能体） preset 界面：默认 preset 设置、新建会话 chip、会话标题标签与 preset 名单管理分区；供 agent 组装的用户与维护者阅读。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-agent-preset

[English](README.md) | 中文

## 概述

使用本包可以为新的 Web GUI 会话选择 agent preset、在会话标题中查看当前 preset，并在设置中管理可用 preset。preset 在会话创建时即固定，因此更改选择或默认值只影响此后创建的会话。如果部署未提供任何 preset，这些控件保持隐藏，每个会话都使用宿主组装。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

与设置与对话包一起挂载本插件；preset 界面随即出现在各自槽位渲染之处。新建会话 chip 以部署默认值打开并暂存一个选择，落到下一个空白会话上；暂存一经使用即被清空，因此再下一个新会话重新以默认值打开。

### 管理名单

设置分区把名单呈现为卡片，并分为部署随附的 preset 与自行发布展示文案的 preset 两组。默认值可在任一界面设置；preset 文件本身存放在浏览器之外、也在浏览器之外编辑，本页不会创建、改名或移除它们。随附 preset 在只读查看器中打开。名单行携带 `broken` 时渲染为标记卡片，其主体被禁用，因为无法组装会话的 preset 也无法被选中；卡片正面仍显示 preset 自己的描述——在选择器里，一个包说明符不足以让人采取行动——宿主给出的原因作为工具提示附在徽标上，另有一个视觉隐藏的 alert 将该原因传达给辅助技术，而被禁用的卡片主体无法做到这一点。

### 对话式入口

名单携带自指的 `cordis` preset 时，一张虚线添加卡会暂存它并开启新会话——分区关闭设置面板，新建会话 chip 自己的应用器负责组装工作区流程产出的空白会话。preset 正是在那段对话中创作的；本页只读取名单并做选择。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

展示选项来自同一次 `agentPresets/list` 调用——名单本身已报告未显式选择的会话会得到哪个 id，因此任何界面都无需对 settings schema 做内省——默认值的写入即设置分区的设为默认动作，目标是 `agent-presets` settings 命名空间的 `default` 字段，也正是宿主在创建时解析的字段。新建会话 chip 与标题标签共用一个控制器，因为暂存选择属于流程而非任何单个会话；暂存值在会话到达时应用（既覆盖工作区连接新建的会话，也覆盖它复用的空白会话），被拒绝时丢弃。系统会通过 composer 列上方的瞬时横幅提示拒绝结果，因为 chip 的标签此时已经恢复原值，而被宿主拒绝挂载的 preset 正是发现过程报告为健康的那一种——它的名单卡片上没有任何原因可供回头查看。只有用户刚做出的选择会触发提示；会话成为当前会话时触发的应用器不会。[`dsh-client-connection`](../connection/README.zh.md) 使用同一浏览器会话认证 `agentPresets/read`、`agentPresets/list` 及其他所有 Host API 方法。组装仍会指明一个会话所运行的插件，因此读取属于侦察；名单本身是宿主契约，本页只读取。分区在自身操作、`settings/document-updated` 与 `connection/reset` 时重读，因为组装文件在浏览器之外编辑，协议链路不会通知文件变动。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

当 preset 界面无法满足需求时，请阅读以下页面。它们从浏览器界面延伸至 preset 领域与组装模型。

- [dsh-agent-preset-registry](../../preset/agent-preset-registry/README.zh.md)——这些界面读取并管理的宿主名单与组装。
- [ui-conversation](../ui-conversation/README.zh.md)——声明 chip 与标签填充的首屏与会话头部槽位。
- [ui-settings](../ui-settings/README.zh.md)——承载名单分区的设置外壳。
- [客户端包映射](../README.zh.md)——相邻的浏览器 UI 包。

-----

<a id="model-experience"></a>
## 模型体验

间接影响，经由此后会话据以组装的 preset；它所选择的 preset 拥有所有面向模型的效果。

#### KV Cache 影响

没有直接的失效影响。更改默认值绝不触及运行中会话的前缀；此后创建的会话依据它自己的组装建立自己的前缀。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>


这些限制界定了当前 preset 界面。它们是当前包约束，不是通用组装对比或任务积压。

- **没有元数据的 preset 按 id 列出**——展示文案是可选的，不发布任何文案的 preset 回退到自己的 id。解析本身使用 [`dsh-agent-preset-registry/display`](../../preset/agent-preset-registry/README.zh.md) 共享的 `presetDisplayText` 解析逻辑，设置的插件列表把它内联在本插件的字典之上，按当前语言显示随附 preset 的名称，同时不翻译由声明方自有的元数据。
- **组装编辑对页面不可见**——文件在浏览器之外编辑，协议链路不广播文件变动，因此名单只在自身操作、`settings/changed` 与 `connection/reset` 时重读，而非每次磁盘编辑。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>

**运行时不变式：** 不发布伴生入口。这是浏览器侧界面插件，Node 侧不拥有事件流或可变运行时数据；名单与设置写入属于宿主约定。
