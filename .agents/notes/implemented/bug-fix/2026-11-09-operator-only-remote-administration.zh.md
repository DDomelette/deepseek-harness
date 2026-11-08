# Agent Note：Remote 管理权留在操作者手里

Status: implemented

[English](2026-11-09-operator-only-remote-administration.md) | 中文

## 问题

已配对设备是被接纳的 Remote 调用方：`admit()` 按它的 cookie 返回该设备自己的 Peer，`/api` 只检查 Host/Origin 栅栏与浏览器认证，而设置控制器的 `@Remote` 方法没有任何权限类别。因此，一台只为*使用*智能体而配对的手机，可以直接调用 `settings/mutate`，改写所有可写的（volatile）配置——模型提供商的 `baseURL`、MCP 服务器清单（其中 `command`/`args` 会被 Host 拉起）、绑定策略、工具超时——尽管 GUI 对非回环页面把设置显示为只读。配对是对使用智能体的许可，从来不是对管理 Host 的许可。真正起作用的只有客户端那条持久化规则，而手写一次 RPC 调用就能绕过它。

## 决策

`connection.reserveOperatorOnly(endpoint)` 把一个共享通道 RPC 端点保留给操作者的 Peer。共享 Fetch 处理器在派发之前对除操作者外的每个已接纳 Peer 回答 403；预留本身是一个 effect，销毁时会恢复访问。Remote 装配保留设置的写端点——`settings/update`、`settings/replace`、`settings/mutate`、`settings/openSettingsDocument`——因为该表层由装配发布，而控制器看不到调用方。

读操作仍然放行：经过脱敏的命名空间描述不属于管理行为，手机外壳仍可描述命名空间。判权放在传输层，因为只有传输层知道是哪种凭据接纳了这次请求；Peer 本身有意不记录权限。

## 备选方案

- **只保留客户端规则。** 否决：`ui-settings` 让非回环页面停留在进程内只是 UI 策略——设备可以直接调用端点，Host 侧没有任何东西会拒绝。
- **在 `SettingsController` 内部判断。** 按现有代码不可能：Remote 方法拿不到请求，无法区分操作者 cookie 与设备 cookie。
- **给设备列出允许调用的命名空间白名单。** 暂时否决：每个命名空间都需要一次产品决策，而不完整的白名单会破坏手机自身的外壳；保留管理类动词把改动限制在可控范围。
- **在 Typert Remote 中声明权限类别。** 这是长期的正确归属，但属于协议级改动；预留用传输层已有的凭据现在就表达了同一条规则。

## 影响

- 已配对设备保留智能体、会话、工作区、上传与流式通道；每个被保留的配置写入改为返回 403，而不是静默成功。
- 操作者在它声明的每个 authority 上都能使用这些端点，包括绑定的局域网地址——这与 `/pair/*` 早已用于设备管理的凭据规则一致。
- 设置页在非回环页面的行为不变；那条 UI 策略现在与传输层的执行结果一致。
- 其他管理面——凭据写入、插件安装、账号绑定——尚未预留，划清界线之前需要同样的审计。

## 测试

- `packages/client/connection/tests/operator-only-rpc.host.spec.ts`——操作者 Peer 通过、设备 Peer 得到 403、未预留端点保持开放、释放预留后恢复访问、畸形端点名被拒绝。
- `packages/api/remotes/tests/operator-only.host.spec.ts`——装配预留四个设置写端点，并在销毁时释放。
- `apps/web/tests/phone-pairing.e2e.ts`——已配对手机无法管理配对，且在「连接手机」页看不到策略控件；操作者的局域网页面保持可编辑。

## 相关

- [「连接手机」设置页与保存的绑定策略](../feature/2026-11-08-connect-phone-page-and-bind-policy.zh.md)——促成这次预留的那次策略写入。
- [浏览器令牌认证](../architecture/2026-08-24-browser-token-authentication.zh.md)——本规则所区分的操作者与设备两类凭据。
- [LAN Web 服务](../architecture/2026-09-11-lan-web-serving.zh.md)——设备凭据来源的栅栏与配对模型。
