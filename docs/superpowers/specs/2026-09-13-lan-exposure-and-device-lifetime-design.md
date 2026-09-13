# 设计：LAN 暴露面收窄与每设备配对寿命

**Goal:** 在不引入 TLS 的前提下，把「手机到电脑这一段明文链路」的风险收敛到可管理的程度：随附默认寿命从 180 天下调，每台已配对设备可以单独设定期限且改期即重新计时，「连接手机」面板能看见天数并一键吊销，文档给出可复制的按设备限流配方。

**Non-goals:** 不做 TLS、不改 cookie 格式与命名、不改回环启动令牌的语义、不引入多用户或设备分组。TLS 仍是单独一期，本设计把「明文链路上的凭据寿命与暴露面」当作可控变量处理，而不是消除它。

## 背景

`dsh web` 默认绑定所有网卡，手机经配对接入，认证凭据是设备 cookie。它等价于 shell 凭据：拿到它就等于在电脑上以操作者身份执行命令。今天的实现有三个具体缺口：

1. **寿命写死在 cookie 载荷里。** `packages/client/connection/src/browser-auth.ts` 的 `issueDeviceCookie()` 用 `expiresAt = 签发时刻 + deviceCookieMaxAgeDays` 生成签名载荷；随附默认是 `180`（`packages/client/connection/src/index.ts` 的 `deviceCookieMaxAgeDays`）。除重新配对之外没有任何续期路径，也不区分设备。
2. **每设备不可控。** 登记表 `client-connection/paired-devices`（`packages/client/connection/src/devices.ts`，v1）每条只有 `{ id, label, registeredAt, lastSeenAt }`，它只回答「这台设备还算不算数」；吊销是唯一手段。
3. **暴露面默认最大。** 绑定所有网卡 + 明文 HTTP + 180 天凭据，且启动警告只说「只在可信网络使用」，没有给出可操作的收窄办法。

## 决策

### 1. 登记表是寿命的唯一权威

`PairedDevice` 增加两个可选字段：

- `lifetimeDays?: number` —— 操作者为这台设备选择的政策（天）。
- `expiresAt?: number` —— 当前倒计时的终点（绝对毫秒）。

设备 cookie 的校验规则变为：**签名有效 ∧ 登记表里仍有这台设备 ∧ 当前时间未到该设备的到期点**。其中到期点的取值规则是：

- 登记表有 `expiresAt` ⇒ 以它为准（新模型）。
- 登记表没有 `expiresAt` ⇒ 以 cookie 签名载荷里的 `expiresAt` 为准（今天的行为，见下方迁移）。

**改寿命即重新计时**：面板写入 `lifetimeDays = N` 的同时写入 `expiresAt = now + N 天`。缩短立即生效（下一次请求就被登记表拒绝）；延长在手机下一次打开/刷新页面时生效（见第 2 条）。

参考记录形状（v1 兼容，纯增量）：

```yaml
kind: grant
payload:
  version: 1
  devices:
    - id: "<base64url>"
      label: "Pixel 8"
      registeredAt: 1757000000000
      lastSeenAt: 1757000000000
      lifetimeDays: 30
      expiresAt: 1759592000000
```

### 2. 浏览器 cookie 是登记表的投影，索引请求懒刷新

cookie 仍然是「身份 + authority + 签发时刻 + 到期」的签名载荷，但**它不再定义政策**：载荷里的到期时间是这台设备当前窗口的硬上限，而窗口本身由登记表决定，两者由下面这条刷新规则保持一致。当一次索引请求（手机打开或刷新页面）带着有效设备 cookie 到达、而该 cookie 的到期早于登记表里这台设备的 `expiresAt` 时，响应里重新签发一份与登记表对齐的 cookie（`Set-Cookie` 的载荷与 `Max-Age`/`Expires` 属性同步写入）。

- 延长之后，手机需要先加载一次页面：在那之前 `/api` 请求仍受旧载荷的到期时间约束，加载之后两者一致；面板文案写明「手机上重新打开页面后生效」，不假装它是即时的。
- 缩短不需要刷新：登记表在下一个请求就拒绝这台设备。
- 刷新只发生在索引请求上，`/api` 的请求路径保持现状，避免把续期逻辑铺到每一条 RPC 上。

配置面只保留**一个**旋钮：`deviceLifetimeDays`（默认 **30**）——新设备的默认政策。原 `deviceCookieMaxAgeDays` 随本次改动删除（pre-stable 配置，随附 web profile 未覆盖它；改为由登记表逐设备决定）。启动令牌 cookie 的 `cookieMaxAgeDays`（默认 30）不受影响。

合法性边界：`deviceLifetimeDays` 与每设备天数都限定为整数 **1–365**；**不提供「永不过期」**。

### 3. 已配对设备不写回

升级时登记表里已有的条目**没有** `expiresAt`，本设计不做自动迁移、不在读取时写回：它们继续按 cookie 载荷判定（今天的行为），面板在「寿命」列显示 `—`（未知），并在该行提供「设为 …」入口；一旦操作者为它设定天数，这台设备就切换到登记表权威模型。理由是避免「读一次配置就产生写入」，也让升级不改变现有手机的可用性。

### 4. 面板：看见天数、逐设备改期、一键吊销

「设置 → 通用设置 → 连接手机」（`packages/bundle/mob/src/client/PairingPanel.tsx`）的已配对设备列表增加：

- **寿命列**：登记表授权时显示 `N 天（剩余 M 天）`；已过显示 `已过期`；旧条目显示 `—`；已吊销就是移除该行（现有行为）。
- **改期控件**：档位快选（1 / 7 / 30 / 90 天）+ 任意天数输入，提交后立刻重新计时。
- **吊销**：保留现有按钮，并在列表上方补一行引导文案（中英词典键）：不再使用的设备立即吊销；在不受信任的网络上用过之后也建议吊销。

新路由 `POST /pair/devices/lifetime`，请求体 `{ deviceId, days }`，与其他决策类路由一样强制**回环 authority + 浏览器会话**（`packages/bundle/mob/src/routes.ts` 的 `refused(req, res, ctx, 'loopback')` 模式），因此手机无法修改自己或他人的寿命。现有的 `GET /pair/devices` 应答随本次改动带上 `lifetimeDays` 与 `expiresAt`，面板据此渲染寿命列；`PairedDeviceView` 同步扩展。

### 5. 暴露面收窄的其余三件事

- **启动警告补上动作**（`packages/bundle/web-app/src/index.ts` 的 `console.error`）：保留现有措辞，追加一句可操作的收窄办法（按设备限防火墙，或 `--host 127.0.0.1` 只服务本机）。
- **README**：`packages/bundle/web-app/README.{md,zh.md}` 的 LAN 访问段与 Known Limitations 增加「按设备放行」的 Windows 防火墙配方（可复制命令 + 手机 IP 变化时的注意事项），并写明设备寿命与吊销；`packages/bundle/mob/README.{md,zh.md}` 增加逐设备寿命的事实。
- **Agent Note**：新增一条记录本次决策（登记表权威、懒刷新、不写回旧条目、默认 30 天、面板面），并把 `2026-09-12-phone-device-pairing` 与 `2026-08-24-browser-token-authentication` 里被本次改写的寿命描述就地更新。

## 验证计划

- **登记表**（`packages/client/connection/tests/`）：v1 旧条目解析仍通过；写入 `lifetimeDays`/`expiresAt`；改期重写两个字段；损坏条目仍 fail loud。
- **认证矩阵**（`browser-auth.host.spec.ts`）：登记表到期点拒绝；没有 `expiresAt` 的旧条目按载荷判定；延长后索引请求返回对齐的 `Set-Cookie`，未漂移时不重复签发；缩短后下一次请求即拒绝；吊销仍然立即失效。
- **路由**（`packages/bundle/mob/tests/routes.host.spec.ts`）：`/pair/devices/lifetime` 的回环守卫、会话守卫、天数校验（0、366、非整数一律拒绝）、未知 deviceId。
- **面板**（组件测试）：寿命列的四种状态、档位与任意天数的提交、吊销引导文案；i18n 键由 `verify-client-ui-i18n` 保证归属。
- **配置**：新默认 30 天的行为有测试钉住；随附 web profile 不再引用被删除的配置名。
- **文档门禁**：`pnpm run test:docs`、配对重录。
- **真机**：手机上重新打开页面确认仍可访问；电脑上把该设备改成 1 天再改回 30 天，确认面板天数变化、手机下次打开页面后窗口随之更新。

## 后果与已知限制

- 明文链路仍然存在：本设计**缩小并限制**被偷凭据的价值窗口与可达面，不消除网络上的可读性。TLS 一期仍待做。
- 手机上的窗口变更需要一次页面加载才生效（延长方向）。
- 旧设备在操作者手动设定前不享受登记表权威（与今天完全一致，不产生意外下线）。
- 每设备寿命是逐条记录的事实，因此备份/迁移凭据文件时一并带走。
