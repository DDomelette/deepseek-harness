# Agent Note: 客户端断开时响应桥接会结算

Status: implemented

[English](2026-10-06-http-bridge-settles-on-client-disconnect.md) | 中文

## 问题

`bridge()` 把处理器的响应体流式写入 node:http 响应；当某次写入报告背压时，它会等 `'drain'` 或 `'close'` 之后再写下一块。中途取消长下载的客户端只会触发一次 `'close'`，而此后在被销毁的响应上每次写入都会报告永远不会被排空的背压。只要那唯一的 `'close'` 已经触发过——无论是在某次等待期间，还是在循环挂上监听器之前——这次等待就订阅了一个再也不会到来、而且无法被重复等待的事件：循环停住，`bridge()` 永不结算，`for await` 永不取消响应体流，webserver 自己的 `await route.handler` 也永不返回。每一次被取消的流式下载（会话日志导出路由就是一条队列化的 `ReadableStream`）都会在进程余下的生命里滞留一个响应、一条响应体流、它已入队的缓冲，以及处理器的 promise。

## 决策

循环的两个出口都改为读取响应状态，而不是等待下一个事件。当 `res.destroyed` 已经为真时，迭代在写入之前就停止；背压等待在挂上监听器之后立刻发现响应已销毁时也会结束，因为先到的 `'close'` 是一次性事件、无法再被等待；等待结束后响应已消失则跳出循环。对已销毁的响应不再调用 `res.end()`，而离开迭代会经由异步迭代器的 return 取消响应体流。

## 备选方案

- **用超时等待 `'drain'` 或 `'close'`。** 否决：计时器把一次正确的退出变成每个背压分块都要付的延迟代价，而且在它触发之前响应体仍是未取消的。
- **只依赖桥接已经接到处理器请求上的 abort 信号。** 否决：忽略该信号的生产者（导出路由的队列流就是这样）永远不会结束，而停住的恰恰是循环自己的等待，与生产者无关。
- **用 `stream.pipeline` 与 `Readable.fromWeb` 重写这个循环。** 本次修复否决：为了纠正一个退出条件而替换每条路由的响应处理，而两处状态读取保留了现有的逐块背压行为。

## 后果

- 被取消的流式下载如今在同一毫秒内结束：记录的 socket 运行在 39 ms 销毁响应、41 ms 取消响应体、42 ms 结算 `bridge()`；而在改动之前，同样一次运行从不结算，也从不取消任何东西。
- 读取到底的路径不变：同一个 12.8 MiB 响应体仍然逐字节送达并结算。
- 忽略 abort 信号的处理器现在会在取消时失去自己的响应体流，而不是让它继续存活；生产者必须容忍 `cancel()`，而 `ReadableStream` 约定本就要求这一点。

## Testing

- `packages/client/connection/tests/http-bridge.host.spec.ts` 固定两种次序——背压等待期间的断开，以及首次写入之前响应就已销毁——通过一个两秒的 `settledOrParked` 时限，在没有修复时报出 `expected 'parked' to be 'settled'`，并断言响应体的 `cancel()` 已运行、而 `res.end()` 未被调用。
- 针对本源码的真实 node:http socket 运行（客户端在首块 64 KiB 之后销毁自己的 socket）记录到 `client-destroy@39ms`、`res-close@40ms`、`body-cancelled@41ms`、`bridge-resolved@42ms`；读完整个响应体的对照运行仍然送达全部 13,109,176 字节。
