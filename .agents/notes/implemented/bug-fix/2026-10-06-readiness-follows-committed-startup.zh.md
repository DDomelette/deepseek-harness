# Agent Note: 就绪跟随已提交的启动

Status: implemented

[English](2026-10-06-readiness-follows-committed-startup.md) | 中文

## 问题

`web-app` 在 Loader 结算时就宣告 URL 行并打开默认浏览器。Loader 的结算只报告被拒绝的行：一行永远无法激活时——patch 层插入了一行、而它 inject 的服务无人提供，或它依赖的服务行被 disable——该行保持 pending，配置树照常结算而不失败，直到其后 boot 自己的 `assertEntriesActivated` 才把整棵树判为失败。于是 `dsh web` 为一个在下一个微任务里就会中止的树打印了 `dsh web: http://…` 并打开了 GUI，而模块自己的约定与 README 都把这一行称作监督方据以行动的信号。

## 决策

当启动器提供 `appReady`（其 `onReady` 只在 boot 与宿主机准备都已提交后才触发）时，宣告注册到那里、不再等待 Loader；该注册是一个 effect，因此在提交之前就被释放的树会一并取消它。没有该信号的组合保留 Loader 路径，而连 Loader 都没有的手工构建树仍立即宣告。

## 备选方案

- **保留 Loader 路径，只把差距写进文档。** 否决：这一行的全部意义就是标出部署真正可用的那条界线。
- **等 Loader 之后再等一个固定延迟。** 否决：延迟不是信号，它要么掩盖真实的就绪，要么照样为一个更晚才失败的树打印。
- **让 boot 自己打印这一行。** 否决：那会把启动令牌、局域网快照与浏览器交接搬进 app boot，而它并不拥有其中任何一项，其他宿主（worker 预览、桌面宿主）还会继承一行它们本不该打印的输出。

## 后果

- `dsh web` 只在组合真正可用时打印该行；激活审计失败的树什么都不打印，并以 boot 自己的诊断退出。
- 就绪约定只剩一个所有者，即启动器的启动信号；树在那里注册的 listener 会随树一起被移除。
- 不提供启动信号的组合维持原有时间点，README 记录了这条回退。

## Testing

`packages/bundle/web-app/tests/web-app.spec.ts` 提供一个由测试控制 `commit()` 的启动器替身：Loader 结算后什么都不打印、也不开浏览器，提交之后两者都发生。去掉这道闸门后，该规格报出 `expected "log" to not be called at all, but actually been called 2 times`。
