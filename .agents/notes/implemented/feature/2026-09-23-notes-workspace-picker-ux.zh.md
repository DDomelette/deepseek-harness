# Agent Note: 笔记工作区选择体验——单行按钮、新建文件夹、可滚动设置卡

Status: implemented

[English](2026-09-23-notes-workspace-picker-ux.md) | 中文

## 问题

笔记工作区选择流程有三个用户可见的缺陷，全部出现在首启路径上：首启门的「选择目录」按钮把最后一个字折到了第二行；卡内目录浏览器没有新建文件夹的入口，想要一个全新笔记目录的读者只能离开应用去建；设置卡被视口截断且无法滚动，折叠线以下的字段够不着。

## 决定

浏览按钮现在带 `flex: none` 与 `white-space: nowrap`，无论字段如何挤压宽度，按钮文字都不会折行。

目录浏览器新增了新建文件夹流程，宿主侧零改动：directory-picker 能力本就在 wire 上暴露了 `createDirectory`（`directory-picker/exists`、`directory-picker/create-failed`），因此笔记 face 把它呈现为 `createDirectory(path, name)`，结果是封闭的 `{ ok: true, path } | { ok: false, code }`。创建成功后浏览器直接进入新目录，因此选中它只差一次点击；被拒绝的名字在名称字段下方就地显示，而不是让整次选择失败。

设置卡的 `Modal` 现在挂载一个受视口约束的对话框（`max-height: calc(100vh - 48px)`，带 `100dvh` 支持），其内容可滚动——这正是 `RiskConfirmation` 已验证过的配方。提交时机变成一行两座，功能选择器与「+」控件同行，节与节之间用发丝分隔线取代原先的间隙——卡片读起来是一个完整的设置面，而不是一摞盒子。

## 考虑过但未采用

- **加宽首启门或缩短按钮文案。** 否决：两种语言下的文案都是正确的，任何固定宽度都会在下一次翻译时再次破版；`nowrap` 修掉的是这类缺陷，而不是这一次实例。
- **在 notes 命名空间加 `createDirectory` 动词。** 否决：宿主的 directory-picker wire 已经拥有带封闭拒绝码的目录创建；第二个动词只会重复这条接缝并随时间漂移。
- **让模态背后的页面滚动。** 否决：模态的框架属于卡片本身，页面级滚动会把标题与关闭控件送出屏幕——这正是所报告症状的另一种说法。

## 影响

- `notes-settings.client.spec.tsx` 新增新建文件夹用例块：创建并进入、`exists` 与普通拒绝就地显示、Enter 创建且忙时重入被拦、Escape 收起创建行（包内 440 个测试通过）。
- `fixtures.client.ts` mock 了该接缝的 `createDirectory`；面板的 props 与命令接线原样传递它。
- 两个 README 的目录字段段落记录了新建文件夹控件、其 wire 拒绝码，以及卡片的滚动行为。
- `NotesSettingsCard.tsx` 通过模块级常量读取对话框类名，并附带来由的 v8 ignore：css 模块必定定义该类，`?? ''` 回退只为满足 `noUncheckedIndexedAccess` 下的 `Record` 索引签名类型——`RiskConfirmation.tsx` 是另一个给 `Modal` 传动态类名的调用方，但它在覆盖率门槛之外，因此门内没有先例可循。
