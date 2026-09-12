# Agent Note: 手机接入归入 web profile

Status: implemented

[English](2026-09-12-phone-access-in-the-web-profile.md) | 中文

## 问题

手机接入 Web GUI 最初以独立的 `dsh mob` profile 发布：一个 bundle patch 把 webserver 重绑到所有网卡——绕过了守护 CLI 路径的 `--allow-lan` 确认——并由终端播报器打印带令牌的加入 URL 二维码。这把一项能力变成了两个安全姿态不同的入口、两套文档，以及一个任何旗标门禁都看不见的重绑。

## 决策

手机接入层归入 `web` profile。`PROFILE_TEMPLATES.web.bundles` 在 `@deepseek-ai/dsh-web-app` 之后组合 `@deepseek-ai/dsh-mob`；不存在 `mob` profile，CLI 也没有 `mob` 别名。在局域网提供服务只有 `dsh web --host 0.0.0.0 --allow-lan` 一条路径,因此确认、明文 HTTP 警告与就绪行都归同一条路径所有。

该层贡献的内容种类不变、范围收窄：`web` profile 下的设置入口 设置 → 通用设置 → 连接手机，以及其背后的 `mob` Remote 命名空间（`mob.joinUrl`），后者从栅栏快照拼出带令牌的局域网 URL。注册它就是插件的全部职责：`packages/bundle/mob/cordis.patch.yml` 只插入自己的行、不打任何补丁，host 半层不产生终端输出。终端二维码路径及其 `qrcode-terminal` 依赖被删除，设置入口成为唯一的加入入口。

组合包保留 `@deepseek-ai/dsh-mob` 包名；插件名为 `mob-join`，说明它现在做什么。

## 曾考虑的替代方案

- **把 `dsh mob` 保留为 `dsh web --allow-lan` 的薄别名。** 否决：该能力从未进入发行版，没有已装用户需要这个别名；而别名是第二个入口，必须永远保持语义一致、有文档、有测试。开发调试期想要的短命令应放在那位开发者的 shell 配置里，而不是 CLI 里。
- **把终端二维码保留为可选旗标。** 否决：手机是通过设置入口里渲染的二维码加入的；终端路径会让二维码依赖、TTY 门控及其测试为无人使用的表层继续存在。
- **让全接口绑定成为 `dsh web` 的默认。** 否决：局域网会话是明文 HTTP 上的承载 cookie，而宿主机可以执行命令；默认开启会把这种暴露变成每个用户的初始状态。`--allow-lan` 保留为显式确认，settings 级长期同意暂缓。

## 后果

- 未被改动过的 installation-owned `web` 元组（`dsh-base` + `dsh-web-app`）会在下次加载 profile 时升级为随发行版模板，因此既有检出无需手改即可获得该层；bundle 列表在任何其他位置不同的 profile 属用户所有，保持不变。
- 早先 `dsh mob` 运行创建的 `$DSH_HOME/profiles/mob` 目录属用户所有：没有随发行版模板认领该名字，`dsh --profile mob` 会继续启动该目录，直到操作者将其删除。
- 设置入口在仅回环部署上报 `mob/loopback-only`，在全接口绑定未派生出可达地址时报 `mob/no-lan-address`，正是操作者可以着手处置的两种情形。
- 加入 URL 的终端输出消失；回环 URL 行、局域网 URL 行与明文 HTTP 警告仍是 `dsh-web-app` 的就绪输出。
