# Phase 3 设计文档:移动端响应式适配(批次 A)

日期:2026-09-13

状态:已确认(范围=批次 A;抽屉式;按钮+遮罩;只做手机 ~390px)

## 背景与目标

dsh-mob Phase 0-2 已落地 dev(LAN 默认绑定、配对码认证、PWA 基础、设置"连接手机"入口)。手机端当前可用但排版是桌面式:窄屏侧栏展开挤压主区(390px 视口只剩 110px)、内容区 680px 宽度下限导致溢出、无安全区处理。本阶段让手机端核心路径(看会话/发消息/审批)获得正确的移动布局。

已确认的决策:

| 决策点 | 结论 |
|---|---|
| 范围 | 只做批次 A:骨架 + 核心会话路径 |
| 导航模式 | 抽屉式侧栏(overlay + scrim),AppFrame 内断点分支,不新建 shell |
| 抽屉交互 | 顶部汉堡按钮开关 + 点遮罩关闭;不做滑动手势 |
| 目标视口 | 只做手机(≤767px 一档,验证基准 390×844);平板沿用现有 767px 行为 |
| PC 回归 | 既有 e2e 黄金(1680px 基准 + 1024/767px 变视口断言)必须全绿 |

勘察依据(2026-09-13,dev 分支):ui-layout 布局为 JS 求解(ResizeObserver → store → 内联 grid tracks),已有 narrow 模式(<1024px 收 56px 轨道)与右栏 <768px 自动全屏两个先例;容器查询已在 4 个包落地;`pointer: coarse` 先例在 ui-attachment/ui-deliverables;slot 整骨架替换代价过高(single slot priority 遮蔽需重写子 slot 声明与 owner props 契约),AppFrame 内分支是唯一正确路径。

## 总体模式

框架层 JS 断点分支 + 组件层容器查询 + shell 层高度链。PC 端代码路径不变。

## 工作流

### W1 — 抽屉模式(ui-layout,最大单点)

- `packages/client/ui-layout/src/client/columns.ts`:求解器加"覆盖模式"——视口 <768px 时侧栏展开不进入 grid track,改 fixed overlay(宽 280px)+ 半透明遮罩;收起态保持 56px 轨道。
- `AppFrame.tsx`:窄屏顶栏加汉堡按钮(文案走 locale 字典,zh/en 双语);8px 拖拽柄窄屏隐藏;遮罩点击关闭抽屉、Escape 关闭(沿用 Modal 惯例)。
- `stores.ts`:`narrowExpanded` 语义扩展为"覆盖式展开"(与既有 <1024px 挤压行为分界:768-1023 维持现状,<768 覆盖)。
- 单测:求解器新分支纯函数覆盖(per-file 100% 门禁)。

### W2 — 拆宽度下限(ui-conversation + ui-chat)

- `ConversationRoot.module.css` 的 `--dsh-chat-content-width: clamp(680px, …)` 与 `ConversationRoot.tsx:43` 的 JS 镜像改为跟随列宽,窄屏取全宽;共享宽度轴的卡片 32px 关系与注释同步更新。
- composer/hero 加安全区 padding;WidthHandle(40px 拖拽柄)窄屏隐藏。
- ui-chat 消息/转写组件沿用容器查询与既有 480px 断点先例。

### W3 — shell 高度链(apps/web + client/web)

- `apps/web/index.html` viewport 加 `viewport-fit=cover`。
- `packages/client/web/src/base.css` 高度链 `height: 100%` 改 `100dvh`;加 `env(safe-area-inset-*)` 底/侧 padding。
- 视口 meta 评估 `interactive-widget=resizes-content`(Android 软键盘遮挡 composer 的缓解;不支持的平台自然忽略)。

### W4 — 触摸与移动 e2e 基建

- `pointer: coarse` 下放大触摸目标(composer 按钮、附件操作、模型选择),沿用 ui-attachment 先例。
- `apps/web/tests/support.ts` 加移动视口 fixture(390×844、hasTouch),模式照现有变视口 e2e;新增移动视口断言:抽屉开关、内容无横向溢出、composer 可见可用。
- ui-approval(已挂 `--dsh-chat-content-width`)与 ui-user-questions(已有 720px 断点)校验 390px 表现,预计自愈,只补移动视口测试。

## 错误处理与边界

- 断点跨越(旋转屏幕/拖窗口)时布局由 store 驱动平滑切换,无状态丢失。
- 抽屉打开时主区交互冻结(遮罩拦截指针)。
- iOS 安全区与软键盘行为 CI(Linux Chromium)不可验证:接受"Chromium 视口模拟 + 真机手测"缺口,README 注明。
- 移动 e2e 命名/放置沿用 apps/web/tests 既有结构,不引入共享 playwright.config(各 e2e 自行 launch 的现状不动)。

## 验证策略

- 基线:ui-layout + ui-conversation 505 单测全绿(工作树已验证)。
- 回归:变视口 e2e 黄金(details-session-lifecycle、sidebar-right、composer-tab-geometry、plan-control-row)全绿;`DSH_SNAPSHOT=replay pnpm run test:web`。
- 新增:移动视口 e2e(W4)。
- 门禁:`pnpm run test:gui`、per-file 100% 覆盖、verify-client-ui-i18n(新文案键)、Agent Note 同 PR。
- 真机:`pnpm dsh web` 手测清单——抽屉开关、发消息、审批、横竖屏旋转。

## 明确不做(YAGNI)

滑动手势、底部导航、平板断点档、批次 B(设置族/轨迹/工作区/其余 ui-*)、右栏改造(768px 自动全屏已上线)、slot 骨架替换。
