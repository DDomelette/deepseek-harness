# Phase 3 批次 A 实现计划:移动端响应式适配

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让手机(~390px)访问 dsh Web UI 时获得正确布局:覆盖式抽屉侧栏、内容宽度跟随列宽、dvh/安全区高度链、触摸目标与移动视口 e2e。

**Architecture:** 框架层在 ui-layout 既有 JS 求解布局里加第二断点(768px)变覆盖式抽屉;组件层拆 ui-conversation 的 680px 宽度下限(自适应 min);shell 层补 viewport-fit/dvh/safe-area。PC 端代码路径不变,由既有 e2e 黄金兜底。

**Tech Stack:** React 18 + CSS Modules(容器查询/媒体查询)、Playwright e2e、vitest。

**Spec:** `docs/superpowers/specs/2026-09-13-mob-responsive-design.md`

**工作目录:** `D:/Deepseek_Harness/.worktrees/mob-responsive`,分支 `feat/mob-responsive`。

## Global Constraints

- PC 回归硬约束:既有 e2e 黄金(details-session-lifecycle 的 1024/767 列宽断言、sidebar-right 的 767 全屏、composer-tab-geometry、plan-control-row)与 ui-layout/ui-conversation 505 个基线单测必须全绿,桌面行为零变化。
- per-file 100% 覆盖率门禁(packages/*/*/src);新分支必须有单测。
- 文案强制 i18n:产品可见字符串进 typed 字典;本计划**不新增文案**(抽屉触发用侧栏轨道已有的 "Open sidebar"/"打开侧边栏" 切换钮),遮罩为 `aria-hidden` 装饰元素,键盘经 Escape 关闭。
- 断点分界:视口 <768px 覆盖式抽屉;768-1023px 维持既有挤压行为;≥1024px 桌面。数值常量化,不写裸数字。
- 测试命令:`pnpm exec vitest run <路径>`;e2e 走 `apps/web/tests/`,先 `pnpm run build` 产出 dist。
- 文件末尾恰好一个换行;ESM,本地相对 import 带 `.ts` 后缀(CSS 模块带 `.css`)。
- 非琐碎改动同 PR 附 Agent Note(双语 + sidecar 重录)。
- 抽屉触发钮已存在(SidebarRoot 轨道的 toggle,aria-label 英文 "Open sidebar"/"Collapse sidebar"),**不新增汉堡按钮**——这是对 spec 的简化,零新增 chrome。

---

### Task 1: 断点常量与 store 的 768 跨越复位

**Files:**
- Modify: `packages/client/ui-layout/src/client/columns.ts`(:23 后)
- Modify: `packages/client/ui-layout/src/client/stores.ts`(:115-122)
- Test: `packages/client/ui-layout/tests/layout-store.client.spec.ts`

**Interfaces:**
- Produces: `SIDEBAR_OVERLAY = 768`(columns.ts 导出,Task 2 消费)。

- [ ] **Step 1: 写失败测试**

在 `layout-store.client.spec.ts` 的现有 viewport 用例(参考 :59-75 的 1024 跨越用例形态)后新增:

```ts
  it('drops the narrow expansion override when crossing the overlay breakpoint in either direction', () => {
    const store = createStore(1920)
    // 进入手机档并展开抽屉。
    actions.setViewportWidth(390)
    actions.toggleSidebar()
    expect(store.getSnapshot().layoutInfo.narrowExpanded).toBe(true)
    // 回到平板档(挤压行为):override 丢弃。
    actions.setViewportWidth(800)
    expect(store.getSnapshot().layoutInfo.narrowExpanded).toBe(false)
    // 平板档内移动不丢(挤压语义未变)。
    actions.toggleSidebar()
    expect(store.getSnapshot().layoutInfo.narrowExpanded).toBe(true)
    actions.setViewportWidth(1023)
    expect(store.getSnapshot().layoutInfo.narrowExpanded).toBe(true)
    // 再回到手机档:也丢。
    actions.setViewportWidth(500)
    expect(store.getSnapshot().layoutInfo.narrowExpanded).toBe(false)
  })
```

注:`createStore`/`actions` 用该文件既有夹具的对应名字(:17 区域的 `viewportWidth: 1920` 初始化方式);若夹具签名不同,按文件现状适配,断言内容不变。

- [ ] **Step 2: 跑红**

Run: `pnpm exec vitest run packages/client/ui-layout/tests/layout-store.client.spec.ts` Expected: FAIL(800 时 narrowExpanded 仍为 true)。

- [ ] **Step 3: 实现**

(a) `columns.ts` 在 `SIDEBAR_AUTO_COLLAPSE`(:23)后加:

```ts
/** Viewport width below which an expanded sidebar floats over the center as a
 * drawer instead of squeezing it (handset breakpoint); between this and
 * SIDEBAR_AUTO_COLLAPSE the squeeze behavior is unchanged. */
export const SIDEBAR_OVERLAY = 768
```

(b) `stores.ts`:import 加 `SIDEBAR_OVERLAY`;`setViewportWidth`(:115-122)的跨越判断改为:

```ts
        if ((d.layoutInfo.viewportWidth < SIDEBAR_AUTO_COLLAPSE) !== (width < SIDEBAR_AUTO_COLLAPSE)
          || (d.layoutInfo.viewportWidth < SIDEBAR_OVERLAY) !== (width < SIDEBAR_OVERLAY)) {
          d.layoutInfo.narrowExpanded = false
        }
```

并更新该 action 上方注释(:113-114),说明 768/1024 两个断点跨越都丢弃 override。

- [ ] **Step 4: 跑绿 + 全量**

Run: `pnpm exec vitest run packages/client/ui-layout` Expected: PASS(含既有全部用例)。

- [ ] **Step 5: Commit**

```bash
git add packages/client/ui-layout
git commit -m "feat(ui-layout): add the 768px overlay breakpoint to the layout store"
```

---

### Task 2: AppFrame 覆盖式抽屉渲染

**Files:**
- Modify: `packages/client/ui-layout/src/client/AppFrame.tsx`
- Modify: `packages/client/ui-layout/src/client/AppFrame.module.css`
- Test: `packages/client/ui-layout/tests/app-frame.client.spec.tsx`

**Interfaces:**
- Consumes: `SIDEBAR_OVERLAY`(Task 1)。
- Produces: 无新导出;frame 根元素新增 `data-drawer` 属性(e2e 与 CSS 挂钩)。

- [ ] **Step 1: 写失败测试**

在 `app-frame.client.spec.tsx` 中(用该文件既有渲染夹具)新增窄视口用例骨架:

```ts
it('renders the expanded sidebar as a drawer with a scrim below the overlay breakpoint', async () => {
  // 视口 390,narrowExpanded=true:sidebar track 为 0,drawer 覆盖,scrim 在;
  // 视口 800,narrowExpanded=true:维持挤压(track > 0),无 scrim。
})
```

具体断言(按夹具形态适配):
- 设 store `viewportWidth: 390, narrowExpanded: true, sidebar: 280`:frame 的 `gridTemplateColumns` 以 `56px` 开头(轨道只剩收起轨道,抽屉覆盖于其上——`computeColumns(viewport, 0, …)` 的 sidebar=0 产出 56px rail 而非 0px,rail 上保留开关钮);`[data-drawer]` 存在于 sidebar 列;scrim 元素(`[data-drawer-scrim]`)存在;`[data-side="sidebar"]` 拖拽柄数量为 0;
- 触发 Escape(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))`)后:toggieSidebar 被调(或 narrowExpanded 变 false,按夹具能力);
- scrim 点击后同上;
- 改 `viewportWidth: 800`(narrowExpanded true):gridTemplateColumns 以 `280px` 开头,无 scrim(既有挤压不变)。

- [ ] **Step 2: 跑红**

Run: `pnpm exec vitest run packages/client/ui-layout/tests/app-frame.client.spec.tsx` Expected: FAIL(无 data-drawer/scrim)。

- [ ] **Step 3: 实现**

(a) `AppFrame.tsx`:
- import 加 `SIDEBAR_OVERLAY`;
- :160 后加:

```ts
  const overlay = viewport < SIDEBAR_OVERLAY
  const sidebarCollapsed = narrow ? !layoutInfo.narrowExpanded : layoutInfo.sidebar === 0
  const drawerOpen = overlay && !sidebarCollapsed
  const sidebarPreference = sidebarCollapsed
    ? 0
    : layoutInfo.sidebar === 0 ? SIDEBAR_DEFAULT : layoutInfo.sidebar
```

(即把原 :161 的 sidebarCollapsed 上移一行,新增 overlay/drawerOpen;drawer 展开时 sidebar 参数传 0,`computeColumns` 据此把 track 收成 56px rail,抽屉覆盖于其上。)

- `normal` 与 `cols` 两个 computeColumns 调用的 sidebar 参数改为 `drawerOpen ? 0 : sidebarPreference`(:168 的 `!layoutInfo.rightbarShown && narrow ? 0 : sidebarPreference` 相应变为 `!layoutInfo.rightbarShown && narrow ? 0 : drawerOpen ? 0 : sidebarPreference`,:169 同理);
- sidebar slot props(:193-196):`width` 改为 `drawerOpen ? sidebarPreference : cols.sidebar`;
- 根 div 的 `data-drawer` 属性:`data-drawer={drawerOpen || undefined}`;
- sidebarCol 渲染(:221-223):

```tsx
      <div className={css.sidebarCol} data-drawer={drawerOpen || undefined}>
        {sidebar}
      </div>
```

- scrim 与拖拽柄(:233-237 区域):sidebar 拖拽柄条件改为 `{!overlay && !sidebarCollapsed && <DragHandle side="sidebar" … />}`;在 overlayLayer 前插入:

```tsx
      {drawerOpen && (
        <div
          className={css.scrim}
          aria-hidden="true"
          data-drawer-scrim
          onClick={() => { actions.toggleSidebar() }}
        />
      )}
```

- Escape 关闭(组件内,drag callbacks 附近):

```ts
  useEffect(() => {
    if (!drawerOpen) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') actions.toggleSidebar()
    }
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('keydown', onKey) }
  }, [drawerOpen, actions])
```

(b) `AppFrame.module.css`(参照既有 transition 变量与 z-index 约定:handle 为 z-index 11):

```css
/* Drawer presentation (viewport < 768px): the sidebar leaves the grid and
   floats over the center; the scrim freezes the center and closes on tap. */
.sidebarCol[data-drawer] {
  position: fixed;
  inset-block: 0;
  inset-inline-start: 0;
  z-index: 13;
  background: var(--dsw-alias-bg-base);
  box-shadow: 8px 0 24px rgb(0 0 0 / 24%);
}

.scrim {
  position: fixed;
  inset: 0;
  z-index: 12;
  background: rgb(0 0 0 / 32%);
}
```

- [ ] **Step 4: 跑绿 + 全量 + 覆盖率**

Run: `pnpm exec vitest run packages/client/ui-layout` Expected: PASS;新分支(overlay/drawerOpen/scrim/Escape)被用例覆盖。

- [ ] **Step 5: Commit**

```bash
git add packages/client/ui-layout
git commit -m "feat(ui-layout): render the narrow expanded sidebar as a drawer"
```

---

### Task 3: 拆内容宽度下限(ui-conversation)

**Files:**
- Modify: `packages/client/ui-conversation/src/client/skeleton/ConversationRoot.tsx`(:36-44)
- Modify: `packages/client/ui-conversation/src/client/skeleton/ConversationRoot.module.css`(:9-35 注释与 :28-31 clamp;:226 区域 WidthHandle 隐藏;:369 composerSeat 安全区)
- Test: `packages/client/ui-conversation/tests/skeleton.client.spec.tsx`

**Interfaces:**
- Consumes: 无(纯本包)。
- Produces: `resolveContentWidth` 的自适应下限语义(窄列时内容 = 列宽)。

- [ ] **Step 1: 写失败测试**

`skeleton.client.spec.tsx` 已有 ResizeObserverStub + offsetWidth 伪造(:52-81、:625-638,现有 1200/1600 用例)。新增窄列用例:

```ts
it('fits the content width to a handset column, clamping even a stored wide preference', async () => {
  // localStorage 存偏好 800;offsetWidth 伪造为 390:
  localStorage.setItem('dsh.conversation.contentWidth', '800')
  // 渲染后触发 observer:
  Object.defineProperty(root, 'offsetWidth', { value: 390, configurable: true })
  // publishWidths 经 observer 回调触发;
  expect(root.style.getPropertyValue('--dsh-chat-user-width')).toBe('390px')
  // 无偏好时:不设置 --dsh-chat-user-width(CSS clamp 的 min() 兜底,e2e 验证)。
})
```

(渲染/observer 触发方式严格照 :625-638 现有用例的写法。)

- [ ] **Step 2: 跑红**

Run: `pnpm exec vitest run packages/client/ui-conversation/tests/skeleton.client.spec.tsx` Expected: FAIL(现为 `640px`)。

- [ ] **Step 3: 实现**

(a) `ConversationRoot.tsx` 的 `resolveContentWidth`(:40-44)改为:

```ts
function resolveContentWidth(columnWidth: number, preference: number | null): number {
  const effectiveMin = Math.min(CONTENT_MIN, columnWidth)
  const max = Math.max(effectiveMin, columnWidth - CONTENT_EDGE_BUDGET)
  if (preference !== null) return Math.min(Math.max(preference, effectiveMin), max)
  return Math.max(Math.min(680, columnWidth), Math.min(columnWidth * 0.64, 920))
}
```

桌面行为不变校验(写进测试或注释):column=1000 无偏好 → 680;column=2000 → 920;column=1000 偏好 800 → 800。 同步更新 `CONTENT_MIN`/`CONTENT_EDGE_BUDGET`(:18-24)的 JSDoc:窄列时 effectiveMin 退化为列宽,EDGE_BUDGET 预算让位于"内容=列宽"。

(b) `ConversationRoot.module.css` :28-31 改为:

```css
  --dsh-chat-content-width: var(
    --dsh-chat-user-width,
    clamp(min(680px, var(--dsh-conversation-column-width, 0px)), calc(var(--dsh-conversation-column-width, 0px) * 0.64), 920px)
  );
```

并更新 :9-35 的宽度轴注释:floor 从固定 680px 改为 `min(680px, 列宽)`——窄列全宽,桌面行为不变。

(c) 同文件 `.widthHandle`(:226)后追加:

```css
/* Drag handles are a mouse facility: hidden on touch and handset widths. */
@media (max-width: 767px), (pointer: coarse) {
  .widthHandle {
    display: none;
  }
}
```

(d) 同文件 `.root[data-phase='active'] .composerSeat`(:369 区域)规则内追加安全区:

```css
  padding-bottom: env(safe-area-inset-bottom);
```

- [ ] **Step 4: 跑绿 + 全量**

Run: `pnpm exec vitest run packages/client/ui-conversation` Expected: PASS(505 基线不回归)。

- [ ] **Step 5: Commit**

```bash
git add packages/client/ui-conversation
git commit -m "feat(ui-conversation): fit the content width axis to handset columns"
```

---

### Task 4: shell 高度链(viewport + dvh)

**Files:**
- Modify: `apps/web/index.html`(:5)
- Modify: `packages/client/web/src/base.css`(:4-9)

**Interfaces:**
- Consumes: 无。Produces: 无代码接口。

- [ ] **Step 1: 实现(纯声明性改动,验证靠 e2e 与构建)**

(a) `apps/web/index.html` :5 改为:

```html
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, interactive-widget=resizes-content" />
```

(b) `packages/client/web/src/base.css` :4-9 改为:

```css
html,
body,
#root {
  height: 100%;
  /* Mobile browsers: the dynamic viewport tracks the URL bar collapsing. */
  height: 100dvh;
  margin: 0;
}
```

- [ ] **Step 2: 验证**

Run: `pnpm run build` Expected: 构建通过,`apps/web/dist/index.html` 含 `viewport-fit=cover`。 iOS 真机行为(safe-area/键盘)记入 Task 6 的真机手测清单,CI 不可验证属已接受缺口。

- [ ] **Step 3: Commit**

```bash
git add apps/web/index.html packages/client/web/src/base.css
git commit -m "feat(web): declare viewport-fit cover and dvh height chain"
```

---

### Task 5: 触摸目标(composer)

**Files:**
- Modify: `packages/client/ui-conversation/src/client/skeleton/InputBar.module.css`

**Interfaces:**
- 无。

- [ ] **Step 1: 实现**

文件末尾追加(沿用 ui-attachment 的 `pointer: coarse` 先例;该文件既有按钮 `min-height: 36px` —— :170 区域):

```css
/* Touch targets: 44px floor on coarse pointers (WCAG 2.5.5). */
@media (pointer: coarse) {
  .root button {
    min-height: 44px;
    min-width: 44px;
  }
}
```

注:`.root` 换成该文件实际的根类名(实现者读文件确认;若根类另有其名,以实际为准,规则内容不变)。

- [ ] **Step 2: 验证**

Run: `pnpm exec vitest run packages/client/ui-conversation` + `pnpm run build` Expected: PASS;无测试断言尺寸时以 e2e(Task 6)的 composer 可用性兜底。

- [ ] **Step 3: Commit**

```bash
git add packages/client/ui-conversation/src/client/skeleton/InputBar.module.css
git commit -m "feat(ui-conversation): raise composer touch targets to 44px on coarse pointers"
```

---

### Task 6: 移动视口 e2e

**Files:**
- Modify: `apps/web/tests/support.ts`(:31-33 后)
- Create: `apps/web/tests/mobile-drawer.e2e.ts`

**Interfaces:**
- Consumes: Task 2 的 `data-drawer`/`data-drawer-scrim`;Task 3/4/5 的 CSS;`launchWebScaffold`(`apps/web/tests/scaffold.ts`,sidebar-right.e2e.ts :27 的用法)。
- Produces: `newMobilePage(browser): Promise<Page>`(support.ts 导出)。

- [ ] **Step 1: support.ts 加移动页夹具**

`newEnglishPage`(:31-33)后加:

```ts
/**
 * Open a handset-sized touch page (390×844) advertising English. Playwright's
 * touch flag needs a context (newPage alone cannot set it); callers dispose
 * the page's context.
 * @param browser - Playwright browser owning the page.
 * @returns the initialized page.
 */
export async function newMobilePage(browser: Browser): Promise<Page> {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    locale: 'en-US',
    timezoneId: 'Asia/Shanghai',
  })
  return await context.newPage()
}
```

- [ ] **Step 2: 写 e2e(先跑红)**

`apps/web/tests/mobile-drawer.e2e.ts`:

```ts
// Handset-viewport coverage for the drawer sidebar, the fitted content width
// axis, and composer usability at 390px: the official roster, one Chromium,
// touch emulation. See sidebar-right.e2e.ts for the scaffold pattern.
import { chromium, type Browser, type Page } from 'playwright'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { launchWebScaffold, watchConsole, type WebScaffold } from './scaffold.ts'
import { newMobilePage, requireDist } from './support.ts'

describe('mobile viewport (390×844, touch)', () => {
  let browser: Browser
  let scaffold: WebScaffold
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>

  beforeAll(async () => {
    requireDist()
    browser = await chromium.launch()
    scaffold = await launchWebScaffold()
    page = await newMobilePage(browser)
    tripwire = watchConsole(page)
    await page.goto(scaffold.url)
  }, 120_000)

  afterAll(async () => {
    await page.context().close()
    await scaffold.dispose()
    await browser.close()
  })

  it('keeps the document within the viewport (no horizontal overflow)', async () => {
    await expect.poll(async () => await page.evaluate(() => document.getElementById('root')?.innerHTML.length ?? 0)).toBeGreaterThan(1000)
    const metrics = await page.evaluate(() => ({
      scroll: document.documentElement.scrollWidth,
      inner: window.innerWidth,
    }))
    expect(metrics.scroll).toBeLessThanOrEqual(metrics.inner)
    expect(tripwire.pageErrors).toEqual([])
  })

  it('opens and closes the sidebar as a drawer', async () => {
    const frame = page.locator('[class*="frame"]').first()
    // 静止态:轨道形态,无 scrim。
    await expect(page.locator('[data-drawer-scrim]')).toHaveCount(0)
    await page.getByRole('button', { name: 'Open sidebar' }).click()
    // 抽屉展开:sidebar 覆盖,track 收成 56px rail,scrim 出现。
    await expect(page.locator('[data-drawer-scrim]')).toHaveCount(1)
    await expect.poll(async () => await frame.getAttribute('data-drawer')).toBe('true')
    await expect.poll(async () => {
      const columns = await frame.evaluate(el => getComputedStyle(el).gridTemplateColumns)
      return columns.startsWith('56px')
    }).toBe(true)
    // 无横向溢出。
    const scroll = await page.evaluate(() => document.documentElement.scrollWidth)
    expect(scroll).toBeLessThanOrEqual(390)
    // scrim 点击关闭。
    await page.locator('[data-drawer-scrim]').click()
    await expect(page.locator('[data-drawer-scrim]')).toHaveCount(0)
    // 再开,Escape 关闭。
    await page.getByRole('button', { name: 'Open sidebar' }).click()
    await expect(page.locator('[data-drawer-scrim]')).toHaveCount(1)
    await page.keyboard.press('Escape')
    await expect(page.locator('[data-drawer-scrim]')).toHaveCount(0)
    expect(tripwire.pageErrors).toEqual([])
  })

  it('keeps the composer visible and focusable', async () => {
    const composer = page.locator('[class*="composerSeat"]').first()
    await expect(composer).toBeVisible()
    const box = await composer.boundingBox()
    expect(box).not.toBeNull()
    expect(box!.y + box!.height).toBeLessThanOrEqual(844)
    expect(box!.width).toBeLessThanOrEqual(390)
    expect(tripwire.pageErrors).toEqual([])
  })
})
```

注:`launchWebScaffold`/`watchConsole`/`scaffold.url`/`scaffold.dispose` 的确切名字以 `apps/web/tests/scaffold.ts` 实际导出为准(实现者读它调整;断言内容不变)。

- [ ] **Step 3: 跑 e2e**

Run: `pnpm run build && pnpm exec vitest run apps/web/tests/mobile-drawer.e2e.ts`(若 e2e 有独立 config,以 apps/web 既有 e2e 运行方式为准,如 `pnpm run test:web` 或 vitest.e2e.config) Expected: 三个用例 PASS。

- [ ] **Step 4: 回归跑变视口黄金**

Run: `pnpm exec vitest run apps/web/tests/sidebar-right.e2e.ts apps/web/tests/details-session-lifecycle.e2e.ts` Expected: 既有 1024/767 断言全绿(PC 行为未变)。

- [ ] **Step 5: Commit**

```bash
git add apps/web/tests
git commit -m "test(web): cover the handset drawer and fitted content at 390px"
```

---

### Task 7: 文档与门禁收尾

**Files:**
- Create: `.agents/notes/implemented/feature/2026-09-13-mobile-responsive-batch-a.md`(+.zh.md + sidecar)
- Modify: `packages/client/ui-layout/README.md` + `README.zh.md`(抽屉断点行为)
- Modify: `packages/client/ui-conversation/README.md` + `README.zh.md`(宽度轴下限语义)

**Interfaces:**
- 无。

- [ ] **Step 1: Agent Note**

按 `.agents/notes/README.md` 格式写(implemented/feature;Problem = 手机端桌面布局挤压/溢出;Decision = 768px 覆盖抽屉 + 宽度轴自适应 min + dvh/safe-area + 触摸目标;Alternatives = slot 骨架替换(子 slot 声明与 owner props 契约需重写,代价过高)/独立 ui-mob-shell(同理)/滑动手势(与拖拽柄冲突,第一版按钮+遮罩);Consequences = PC 路径零变化由 e2e 黄金兜底,iOS 安全区/键盘 CI 不可验证属已接受缺口,后续批次 B 处理设置族等次要路径)。zh 副本逐节镜像;`pnpm run verify-translation-pairing <pair> --write` 重录。先按 dsh-archive-agent-notes 做 supersession 检查(预期:与 2026-09-11-lan-web-serving 无重叠,互链即可)。

- [ ] **Step 2: README 同步**

- ui-layout README:窄屏行为一段补 768px 覆盖抽屉(常量名、行为分界、Escape/遮罩关闭);zh 同步 + sidecar。
- ui-conversation README:宽度轴下限从固定 680px 改为 `min(680px, 列宽)` 的语义更新;zh 同步 + sidecar。

- [ ] **Step 3: 门禁**

Run(逐项记录输出):
```bash
pnpm exec vitest run packages/client/ui-layout packages/client/ui-conversation packages/client/web
pnpm run verify-client-ui-i18n
pnpm run verify-translation-pairing
pnpm run verify-agent-note-format
pnpm run typecheck
```
Expected: 全绿。可见输出变化按要求跑 `DSH_SNAPSHOT=replay pnpm run test:web`;若快照差异属预期(移动端布局),按 snapshots/AGENTS.md 流程处理。

- [ ] **Step 4: Commit**

```bash
git add .agents/notes packages/client/ui-layout packages/client/ui-conversation
git commit -m "docs: record the mobile responsive batch-a decision"
```

---

## 收尾

- 真机手测清单(写进 PR 描述):`pnpm dsh mob` → 手机打开 → 抽屉开合(按钮/遮罩/Escape 等价物)、发一条消息、审批一次、横竖屏旋转、PWA 主屏打开看刘海安全区。
- 推送前检查按 `.agents/skills/dsh-pre-push-checks/SKILL.md` 选最小集。
- PR 目标:dev 分支(fork: DDomelette/deepseek-harness)。
