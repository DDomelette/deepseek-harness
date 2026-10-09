# dshlearn 构建工具

[English](README.md) | 中文

`plugins-visual.html` 里的包清单、包的描述与 `ctx` key 归属是生成出来的，不是手抄的。包发生增删或改名后，重跑这两个脚本即可刷新。

```sh
# run from this directory
node extract-packages.mjs      # scan the repository packages/, write ./packages.json
node build-plugins.mjs         # read ./packages.json + ./descriptions.json, write ../plugins-visual.html
```

`extract-packages.mjs` 同时从 `docs/capability-seams.md` 解析出每个 `ctx` key 的 owner、implementations 与 consumers，所以接缝改完后那份文档也要重新生成（`pnpm run gen-doc-graphs`）。

| 文件 | 角色 |
|---|---|
| `extract-packages.mjs` | 扫描 `packages/*/*/package.json` 与 `docs/capability-seams.md`，产出 `packages.json` |
| `packages.json` | 生成物：各包的 name、description、client 标记与 `ctx` key 归属，以及 `ctx` 服务与 12 个类目的分组 |
| `descriptions.json` | **人工审阅过的一句话中文描述**，按包路径索引并附角色标签。重新生成页面不会覆盖它，需要手工维护 |
| `build-plugins.mjs` | 把上面两份数据渲染成 `../plugins-visual.html` |

`descriptions.json` 是唯一需要人维护的输入：新增的包在里面没有条目，`build-plugins.mjs` 会把包名打印到 stderr，页面里那个包则只显示英文原始描述。
