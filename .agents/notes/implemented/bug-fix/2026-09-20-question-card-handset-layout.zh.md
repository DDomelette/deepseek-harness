# Agent Note: 提问卡的手持设备布局

Status: implemented

[English](2026-09-20-question-card-handset-layout.md) | 中文

## 问题

在 360×740 视口上实测，Web 提问卡（`packages/client/ui-user-questions`）在窄屏手机上有三处不可用：

- 卡片的 `max-width: var(--dsh-chat-content-width)` 跟随阅读行长轴，其"列宽 64%"项把卡片限到 230px，而列宽本有 304px。footer——分页器（89px）加跳过/提交动作（154px）——超出该宽度 47px，卡片的 `overflow: hidden` 把提交按钮裁到无法触及：在其中心点击命中的是卡片外框而非按钮。390px 视口勉强放得下 footer，所以这个缺陷一直没暴露。
- 分页器无条件渲染，因此单题请求——常见情形——在两个永久禁用的箭头之间显示 `1 / 1`，把 footer 89px 的预算花在了无效装饰上。
- 卡片限高 `min(60vh, 520px)`，矮视口下选项滚动区只剩约 354px：四个选项加自定义答案行只露出三个选项，自定义入口消失进滚动区，而触屏用户没有任何可发现的滚动提示。

## 决策

四处修改覆盖两张接管卡片（`QuestionComposer.tsx` 与两个 CSS module）：

- 分页器仅在 `questions.length > 1` 时渲染。单题请求的 footer 只有反馈与动作。
- 在既有的 `max-width: 720px` 媒体查询下，两张卡片（提问卡与 plan-review 卡）都取 `max-width: 100%`，两个接管外框的侧内边距都从桌面的 `clearance + 16px` 收窄为裸 `--dsh-composer-side-clearance`，两个 footer 都增加 `flex-wrap: wrap` 与 8px 行距。16px 内缩的存在意义是让接管卡在 transcript 旁保持"输入卡 − 32"的嵌套关系；手持端接管卡整个替换输入卡，因此它取输入卡自己的 gutter——裸 clearance，两侧各 16px。桌面布局（>720px）逐像素不变。
- 有选项时，自定义答案行从 `[data-question-scroll]` 滚动区移到滚动区与 footer 之间的常驻座位。该座位复刻了行在列表内时的度量（1px 行距作为上外边距、列表的 12px 侧内边距、4px 下内边距），因此在卡片触顶、列表开始滚动之前没有任何位移；此后该行保持可见。无选项问题的块式答案字段仍是滚动内容——它就是该问题的整个主体。两张卡片的限高都从 `60vh` 现代化为 `60dvh`，与客户端其余部分一致。

## 曾考虑的替代方案

- **压缩或重设计 footer 以塞进 230px（更小的按钮、纯图标动作）。** 否决：这是为一个卡片本不该有的宽度重设计装饰——尺寸错误的是卡片而非 footer，而且阅读行长轴是 transcript 的契约，接管卡片在手持宽度下没有理由跟随它。
- **提高 64% 项或在窄列上为 `--dsh-chat-content-width` 加下限。** 否决：该轴由 transcript 与每个 dock 卡片共享；为修一张卡片调整它会改变整个对话的行宽。
- **手持端保留"输入卡 − 32"内缩。** 否决：720px 以下内缩根本不来自宽度轴（其下限解析为列宽，`max-width` 从不生效），只来自外框 padding；它在已经只有 230px 的卡片上再花掉 32px，而它所嵌套对齐的输入卡此时并不可见；与输入卡取同一 gutter 让座位的两个占用者保持同一条边线。
- **把自定义行留在滚动区并加滚动提示。** 否决：提示并不能让入口免于滚动即可达，而且该行与 footer 动作是同级的（承载同一个 Enter 提交流程），把它钉在它们旁边是更简单的契约。
- **卡片取裸 clearance gutter 后就取消 footer 换行。** 否决：即使在加宽后的手持宽度下，约 320px 的视口对多题请求仍放不下分页器加动作；换行是唯一不需要第二个断点就能保持提交可点的排布。

## 后果

- 360×740 下提问卡实测 262px——即输入卡在该视口的稳定宽度，此前为 230px——footer 无需换行即可放下，提交可点；自定义答案行在任何卡片高度下可见。plan-review 卡取同一宽度，其 Approve/Refuse 决策行保持可命中。
- 单题请求在所有视口（包括桌面）都不再显示 `1 / 1` 分页器——捕获到编辑器的录制会话 ARIA golden（`snapshots/web/question-composer/ui.expected.md`、`composed.expected.md` 与 `snapshots/web/steering/mid-steer.expected.md`）正是为此以及自定义行移出 radiogroup 而刷新。
- 多题请求在约 320px 以下的视口会把动作换到分页器下一行；footer 增高一行而不是裁切。
- 组件 spec 固定了这些行为：单题无分页器、有选项时自定义行在滚动区之外、无选项的块式字段仍在滚动区之内。编辑器的 replay e2e（`apps/web/tests/question-composer.e2e.ts`）在 360×740 稳定布局下量测：提问卡宽度等于输入卡的手持实测宽度、无分页器、提交按钮在自身中心可命中、自定义行在滚动区之外且在卡片之内；另通过 user-questions seam 直接发起一次 plan review，断言其布局同宽且 Approve 可命中。
