# Agent Note: 索引入口由它解析到的文件判定

Status: implemented

[English](2026-10-06-index-entry-resolved-identity.md) | 中文

## 问题

回退席位用字符串比较来判断一个请求是否指向应用外壳：`target === distRoot || target === distIndex`。在大小写不敏感的卷上——`dsh web` 实际发布的 NTFS 与默认 APFS——`/INDEX.html` 指向的文件与 `/index.html` 相同，但比较却不等，于是该请求落进公开的静态分支，而 `readFile` 会按大小写不敏感把文件读出来：外壳被当作静态资源以 `200 text/html` 返回，既不经过 `authorizeIndex`，也就没有 Connection 的浏览器认证与 Host/Origin 栅栏。本机记录的运行里，`/INDEX.html` 返回 `200` 与原始外壳，而 `/index.html` 返回的是认证拒绝。模块自己的约定（「每个索引响应都先通过 Connection 的浏览器认证」）与 `README.md`（「被栅栏拒绝的名字永远拿不到应用」）都要求：栅栏拒绝的 authority 不得拿到外壳，而别名路径把两者同时绕过。外壳本身不是机密——受信但无 cookie 的 authority 本就会以 401 拿到它——所以泄露的是不变量而非字节；在 Linux 上同一请求只是 404，这正是随附测试从未发现它的原因。

## 决策

入口由路径解析到的文件判定。`isIndexEntry` 保留精确比较作为快路径，对其余候选路径则比较目标与 `distIndex` 各自的 `realpathSync.native`。无法解析的路径就不是入口，调用方的读取会照旧给出同一个 404。解析同时覆盖指向索引文件的符号链接，它现在也走认证路径。

## 备选方案

- **比较小写化后的路径。** 否决：它让大小写敏感文件系统上每一个仅大小写不同的文件都变成索引请求，于是真的同时发布 `INDEX.html` 与 `index.html` 的部署会拿到外壳而不是那个文件。
- **先探测卷的大小写敏感性，只在敏感处按不敏感比较。** 否决：这个探测本身就是一次具有同样失败模式的文件系统探测，而且它仍然漏掉与大小写无关的别名（指向索引的符号链接、NTFS 的 8.3 短名）。
- **对任何小写形式等于索引路径的非精确路径一律拒绝。** 否决：理由同上不完整，而且它把一个合法资源变成 403，而不是把它提供出去。
- **不改，只把别名写进文档。** 否决：栅栏是仓库明文声明过两次的安全边界，而修法只是在「本来就不是精确索引」的路径上多两次 `realpath`。

## 后果

- `/INDEX.html` 现在与 `/index.html` 走同一条路径：未认证的回环请求得到最小 401 拒绝，受信的局域网 authority 得到标记为需要认证的外壳，已配对设备则经由 `renderIndex` 得到普通外壳（含 taps 与注入）。
- 每一个非精确索引的静态请求都要付两次 `realpath` 系统调用；精确路径仍走只做比较的快路径。
- 大小写敏感卷上仅大小写不同的文件不受影响：解析要么失败、要么得到另一个文件，因此它仍是静态资源。

## Testing

- `packages/host/frontend-static/tests/frontend-static.spec.ts` 在真实 Loader 组合中请求 `/INDEX.html` 与 `/Index.HTML`，先探测夹具所在卷是否大小写不敏感，再对两个分支分别断言：在不敏感卷上未认证请求是 `401 text/plain`、已认证请求是 `200 text/html` 且带生效中的索引 tap（证明它经过 `renderIndex` 而非静态读取）；在敏感卷上两者都是 404。没有本次改动时，记录的运行报出 `expected [ '/INDEX.html', 200, … ] to deeply equal [ '/INDEX.html', 401, … ]`。
- Windows CI 作业跑的是大小写不敏感那一支，Linux 作业跑另一支。
