# Agent Note: Worker 异步委派保留返回值

Status: implemented

[English](2026-10-24-worker-delegation-return-values.md) | 中文

## Problem

Worker 依赖还使用具名默认声明、模块局部 `createRequire`、callback 规范路径和流辅助函数。丢失绑定或缺少模块接口会阻止 Host 服务激活。Worker 镜像包含异步生成器使用 `return yield* source` 的依赖模块。仅支持委派语句的转换器无法打包这些模块；忽略 return 则会改变生成器的完成值。

## Decision

[模块转换器](../../../../packages/experimental/webworker-runtime/src/compile/transform.ts) 支持委派语句或直接作为 return 操作数的委派。yield 值与消费者输入通过既有挂起协议传递；直接 return 传递迭代器耗尽时的值，取消则关闭尚未完成的迭代器。包含委派的赋值和调用仍被拒绝，因为替换整个语句会丢失其他操作。仍不支持转发消费者的 `throw()`。

具名默认声明保留声明并通过 getter 导出。静态导入先于模块语句初始化。具名和默认导入保留实时绑定；`eslint-scope` 识别引用，避免改写词法遮蔽或属性名。简写属性保留键名，导入函数调用保留接收者语义。生成的模块请求在 ESM 词法块外捕获镜像解析器，使局部 `require` 可与静态及动态导入共存。兼容表复用维护中的流实现，并在 VFS 上提供 callback `realpath.native`。经 `execa` 安装原生包、经 `got` 传输 Node OTLP 事件与其他仅支持原生环境的包一样，由明确拒绝调用的外部替代实现承接。它们不支持的 IPC 与 socket 依赖不进入镜像；清单读取可以激活，但不代表浏览器支持安装或遥测导出。不支持的 readline 操作也明确拒绝。

预览文档声明目录基址。不带查询参数的文件名不得成为 RPC 挂载路径；空环境和示例数据入口使用同一目录。

生成代码变化时必须更新 lowering 版本，使 Worker 拒绝为不兼容 wrapper 语义编译的镜像。[Client 包拓扑](2026-08-15-client-shells-and-dynamic-packages.zh.md)继续规定 Client 模块身份与加载；本决策仅规定 Worker 镜像中的异步生成器转换。

## Alternatives considered

- 从镜像删除依赖：其运行时消费者仍需要该模块。
- 接受任意 `yield*` 表达式：语句级改写无法保留其外围操作。
- 将 return 下的委派也当成普通语句：这会丢失内部迭代器的完成值。

## Consequences

预览可以打包直接返回的委派，无需在 Worker 内加入编译器。转换测试覆盖值、输入传递、取消、行号与外围表达式拒绝。打包预览仍须通过真实 Worker 和页面隧道完成启动验收。
