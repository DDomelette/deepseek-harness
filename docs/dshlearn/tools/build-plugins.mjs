// Builds docs/dshlearn/plugins-visual.html from the package inventory plus the
// per-package Chinese descriptions produced for each batch.
// Usage: node build-plugins.mjs
// Reads ./packages.json (from extract-packages.mjs) and ./descriptions.json;
// writes ../plugins-visual.html next to this tools directory.
import { readFileSync, writeFileSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const outFile = resolve(here, '..', 'plugins-visual.html')
const inventory = JSON.parse(readFileSync(join(here, 'packages.json'), 'utf8'))
const zh = JSON.parse(readFileSync(join(here, 'descriptions.json'), 'utf8'))

const ROLE_LABEL = {
  definition: 'Definition', provider: 'Provider', consumer: 'Consumer',
  library: 'Library', bundle: 'Bundle', infra: 'Infra',
}
const CATEGORIES = [
  ['spine', '核心脊柱', '产品 API 的主干：会话、prompt、工具、Agent 服务与那唯一的具体循环，外加把它们暴露到远端的类型网关。',
    ['core', 'api', 'typert', 'boot']],
  ['compose', '组合与启动', '可安装的 patch 层。每个 bundle 声明自己往 profile 里插哪些配置行，以及这些行挂载什么代码。',
    ['bundle']],
  ['model', '模型与 LLM', '消息与流的词汇表、适配器接缝，以及各家 provider 的具体实现。',
    ['llm']],
  ['data', '会话数据平面', 'append-only 的会话日志、持久化与检索、非会话存储、Workspace 实体与会话遥测。',
    ['session', 'session-query', 'storage', 'workspace', 'telemetry']],
  ['exec', '执行世界', '文件系统、shell、子进程、持久终端、进程围栏、语言服务与代码执行——共享同一个执行世界的全部能力。',
    ['fs', 'shell', 'subprocess', 'terminal', 'sandbox', 'lsp', 'code-runtime']],
  ['context', '上下文与注入', '不定义工具、只往请求里加东西的插件：工作区指令、文件与会话引用、时间；再加上改写历史的压缩、附件与超长结果外溢。',
    ['context', 'compaction', 'attachment', 'spill']],
  ['acquire', 'Skill 与 MCP', '把外部能力接进来。Skill 是按需加载的指令集，MCP 是把外部 server 的工具变成原生工具。两者都只是 ctx.tools 的贡献者。',
    ['skill', 'mcp']],
  ['delegate', '委派与编排', '把工作交出去或排出顺序：子代理、工作流、后台任务、会话内目标、定时跟进、计划模式、每会话组合，以及实验性原型。',
    ['subagent', 'workflow', 'jobs', 'goal', 'schedule', 'plan', 'preset', 'todo', 'experimental']],
  ['human', '人类协作', '审批与权限、打断模型的交互、人直接发出的命令、问人工具，以及反馈与笔记。',
    ['interaction', 'feedback', 'notes']],
  ['web', 'Web GUI', '浏览器应用的两半：Host 侧是 API 网关与 HTTP 路由，Client 侧是 shell、wire、对象服务与全部 ui-* 插件。',
    ['host', 'client']],
  ['integrate', '集成与外围', '与外部世界对接：运行时自我修改、Claude Code / Codex hook 桥、webhook 入口、SDK、ACP、E2B 远程运行时，以及 Web 访问能力。',
    ['extensions', 'hooks', 'webhook', 'sdk', 'acp', 'e2b', 'web']],
  ['ops', '运行与支撑', '让整套东西可靠运转的东西：循环卫生守卫、运行时不变式、设置与凭据、匿名身份，以及跨组共用的零依赖工具与测试基础设施。',
    ['guard', 'runtime-diagnostics', 'settings', 'credentials', 'identity', 'util', 'test-support']],
]

/** Derives a display role when the per-package description did not supply one. */
function roleOf(pkg) {
  const given = zh[pkg.rel]?.role
  if (given && ROLE_LABEL[given]) return given
  if (pkg.implements.length) return 'provider'
  if (pkg.owns.length) return 'definition'
  if (pkg.consumes.length) return 'consumer'
  return 'library'
}

const rows = inventory.packages.map((p) => ({
  g: p.group,
  d: p.dir,
  n: p.name.replace('@deepseek-ai/dsh-', ''),
  e: p.description,
  z: zh[p.rel]?.zh ?? '',
  r: roleOf(p),
  k: p.owns,
  i: p.implements,
  c: p.consumes,
  w: p.client ? 1 : 0,
  v: p.hasInvariant ? 1 : 0,
  p: p.private ? 1 : 0,
}))

const missing = rows.filter((r) => !r.z).map((r) => r.d)
if (missing.length) console.error(`WARNING: ${missing.length} packages without a Chinese description: ${missing.join(', ')}`)

/** Per-category hue, shared by the proportion bar, jump chips, and section headers. */
const CAT_HUE = {
  spine: 222, compose: 262, model: 190, data: 152, exec: 22, context: 45,
  acquire: 335, delegate: 285, human: 0, web: 205, integrate: 110, ops: 70,
}

const payload = {
  counts: {
    packages: rows.length,
    groups: inventory.counts.groups,
    services: inventory.counts.services,
    categories: CATEGORIES.length,
    client: rows.filter((r) => r.w).length,
  },
  categories: CATEGORIES.map(([id, title, desc, groups]) => ({
    id, title, desc, groups, hue: CAT_HUE[id],
    count: rows.filter((r) => groups.includes(r.g)).length,
  })),
  packages: rows,
}

const html = `<!DOCTYPE html>
<html lang="zh-CN" data-theme="dark">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>DeepSeek Harness · 插件目录</title>
<style>
:root {
  --dsw-font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC',
    'Hiragino Sans GB', 'Microsoft YaHei', 'Helvetica Neue', Helvetica, Arial, sans-serif;
  --dsw-font-mono: 'SF Mono', 'JetBrains Mono', 'Fira Code', Consolas,
    'Liberation Mono', Menlo, Courier, 'PingFang SC', 'Microsoft YaHei';
  --ds-ease-in-out: cubic-bezier(0.4, 0, 0.2, 1);
  --ds-dur: 0.2s;
}
html[data-theme='dark'] {
  --bg-base: rgb(21, 21, 23); --bg-layer-1: rgb(35, 35, 36); --bg-layer-2: rgb(44, 44, 46);
  --bg-layer-3: rgb(53, 54, 56); --sidebar-fill: rgb(27, 27, 28);
  --border-l1: rgba(255,255,255,.06); --border-l2: rgba(255,255,255,.12);
  --border-l3: rgba(255,255,255,.16); --border-l4: rgba(255,255,255,.2);
  --label-primary: rgb(249,250,251); --label-secondary: rgb(207,211,214);
  --label-tertiary: rgb(173,178,184); --label-caption: rgb(129,133,140);
  --brand: rgb(86,134,254); --link: rgb(103,158,254); --hover: rgba(255,255,255,.08);
  --active: rgba(255,255,255,.14); --success: rgb(34,197,94); --error: rgb(242,90,90);
  --warn: rgb(245,158,11); --violet: rgb(167,139,250); --teal: rgb(45,212,191);
}
html[data-theme='light'] {
  --bg-base: rgb(255,255,255); --bg-layer-1: rgb(249,250,251); --bg-layer-2: rgb(245,246,247);
  --bg-layer-3: rgb(235,238,242); --sidebar-fill: rgb(249,250,251);
  --border-l1: rgba(0,0,0,.04); --border-l2: rgba(0,0,0,.1);
  --border-l3: rgba(0,0,0,.12); --border-l4: rgba(0,0,0,.16);
  --label-primary: rgb(15,17,21); --label-secondary: rgb(97,102,107);
  --label-tertiary: rgb(129,133,140); --label-caption: rgb(173,178,184);
  --brand: rgb(65,118,230); --link: rgb(65,118,230); --hover: rgba(38,49,72,.06);
  --active: rgba(38,49,72,.1); --success: rgb(34,197,94); --error: rgb(236,19,19);
  --warn: rgb(221,134,41); --violet: rgb(124,92,214); --teal: rgb(13,148,136);
}
* { box-sizing: border-box; }
html { scroll-behavior: smooth; scroll-padding-top: 108px; }
body {
  margin: 0; font-family: var(--dsw-font-family); font-size: 14px; line-height: 24px;
  color: var(--label-primary); background: var(--bg-base); -webkit-font-smoothing: antialiased;
}
code, .mono { font-family: var(--dsw-font-mono); }
code { background: var(--bg-layer-3); border-radius: 4px; padding: 1px 5px; font-size: .92em; }
a { color: var(--link); text-decoration: none; }
a:hover { text-decoration: underline; }

.topbar {
  position: sticky; top: 0; z-index: 40; display: flex; align-items: center; gap: 12px;
  height: 52px; padding: 0 20px;
  background: color-mix(in srgb, var(--bg-base) 86%, transparent);
  backdrop-filter: blur(12px); border-bottom: 0.5px solid var(--border-l2);
}
.brandmark { display: flex; align-items: center; gap: 9px; font-weight: 600; letter-spacing: -.01em; }
.brandmark .dot { width: 16px; height: 16px; border-radius: 50%; border: 2px solid var(--brand);
  border-right-color: transparent; border-bottom-color: transparent; transform: rotate(-35deg); }
.topnav { display: flex; gap: 4px; margin-left: 8px; }
.topnav a { padding: 5px 11px; border-radius: 8px; font-size: 13px; color: var(--label-secondary); }
.topnav a:hover { background: var(--hover); color: var(--label-primary); text-decoration: none; }
.topnav a.on { background: var(--active); color: var(--label-primary); }
.spacer { flex: 1; }
.iconbtn {
  height: 30px; padding: 0 10px; border-radius: 8px; cursor: pointer; font: inherit; font-size: 12px;
  border: 0.5px solid var(--border-l3); background: transparent; color: var(--label-secondary);
  transition: background var(--ds-dur) var(--ds-ease-in-out);
}
.iconbtn:hover { background: var(--hover); color: var(--label-primary); }

.hero { padding: 30px 32px 22px; border-bottom: 0.5px solid var(--border-l1); }
.hero h1 { margin: 0 0 6px; font-size: 24px; font-weight: 600; letter-spacing: -.02em; }
.hero p { margin: 0; color: var(--label-tertiary); max-width: 82ch; }
.stats { display: flex; flex-wrap: wrap; gap: 26px; margin-top: 18px; }
.stat .v { font-size: 22px; font-weight: 600; font-family: var(--dsw-font-mono); letter-spacing: -.02em; }
.stat .l { font-size: 11.5px; color: var(--label-caption); }

.catbar { display: flex; height: 14px; border-radius: 7px; overflow: hidden; margin-top: 22px; gap: 1px; }
.catbar a { display: block; transition: filter var(--ds-dur) var(--ds-ease-in-out); }
.catbar a:hover { filter: brightness(1.3); }
.catbarhint { margin-top: 7px; font-size: 11.5px; color: var(--label-caption); }
.catdot {
  width: 8px; height: 8px; border-radius: 3px; flex: none; display: inline-block;
  background: hsl(var(--h) 62% 62%);
}
html[data-theme='light'] .catdot { background: hsl(var(--h) 58% 45%); }

.filterbar {
  position: sticky; top: 52px; z-index: 30; display: flex; flex-wrap: wrap; gap: 9px; align-items: center;
  padding: 11px 32px; border-bottom: 0.5px solid var(--border-l2);
  background: color-mix(in srgb, var(--bg-base) 92%, transparent); backdrop-filter: blur(12px);
}
.search {
  flex: 1 1 236px; max-width: 340px; height: 32px; padding: 0 12px; border-radius: 9px;
  border: 0.5px solid var(--border-l3); background: var(--bg-layer-1);
  color: var(--label-primary); font: inherit; font-size: 13px; outline: none;
  transition: border-color var(--ds-dur) var(--ds-ease-in-out);
}
.search:focus { border-color: var(--brand); }
.search::placeholder { color: var(--label-caption); }
.rolechips { display: flex; gap: 6px; flex-wrap: wrap; }
.rchip {
  padding: 4px 10px; border-radius: 7px; cursor: pointer; font: inherit; font-size: 12px;
  font-family: var(--dsw-font-mono); border: 0.5px solid var(--border-l3);
  background: transparent; color: var(--label-tertiary);
  transition: all var(--ds-dur) var(--ds-ease-in-out);
}
.rchip:hover { background: var(--hover); color: var(--label-primary); }
.rchip.on { background: var(--brand); border-color: var(--brand); color: #fff; }
.hits { font-size: 12px; color: var(--label-caption); font-family: var(--dsw-font-mono); }
.keylegend { font-size: 11px; color: var(--label-caption); font-family: var(--dsw-font-mono); }
.keylegend b { font-weight: 600; }

.jump { display: flex; flex-wrap: wrap; gap: 6px; padding: 14px 32px 4px; }
.jump a {
  display: inline-flex; align-items: center; gap: 7px;
  padding: 4px 10px; border-radius: 7px; font-size: 12px; color: var(--label-tertiary);
  border: 0.5px solid var(--border-l2);
}
.jump a:hover { background: var(--hover); color: var(--label-primary); text-decoration: none; }

main { padding: 8px 32px 100px; }
section { padding: 26px 0 6px; scroll-margin-top: 108px; }
section + section { border-top: 0.5px solid var(--border-l1); }
.cathead { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; margin-bottom: 4px; }
.cathead .catdot { align-self: center; width: 10px; height: 10px; }
.cathead h2 { margin: 0; font-size: 18px; font-weight: 600; letter-spacing: -.01em; }
.cathead .c { font-family: var(--dsw-font-mono); font-size: 12px; color: var(--brand); }
.cathead .g { font-family: var(--dsw-font-mono); font-size: 11px; color: var(--label-caption); }
.catdesc { color: var(--label-tertiary); font-size: 13px; margin: 0 0 16px; max-width: 84ch; }
.cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(316px, 1fr)); gap: 10px; }
.pcard {
  border: 0.5px solid var(--border-l2); border-radius: 11px; padding: 13px 15px;
  background: var(--bg-layer-1); transition: all var(--ds-dur) var(--ds-ease-in-out);
}
.pcard:hover { border-color: var(--border-l4); background: var(--bg-layer-2); }
.pcard .top { display: flex; align-items: center; gap: 8px; margin-bottom: 5px; flex-wrap: wrap; }
.pcard .nm { font-family: var(--dsw-font-mono); font-size: 13px; font-weight: 600; color: var(--label-primary); }
.pcard .zh { font-size: 13px; line-height: 20px; color: var(--label-secondary); margin-bottom: 7px; }
.pcard .en { font-size: 11.5px; line-height: 17px; color: var(--label-caption); }
.pcard .keys { margin-top: 8px; display: flex; flex-wrap: wrap; gap: 4px; }
.pcard .keys span {
  font-family: var(--dsw-font-mono); font-size: 10.5px; padding: 1px 6px; border-radius: 5px;
  border: 0.5px solid var(--border-l3); color: var(--label-tertiary);
}
.pcard .keys span.k-own {
  background: var(--brand); border-color: var(--brand); color: #fff;
}
.pcard .keys span.k-impl {
  color: var(--teal); border-color: color-mix(in srgb, var(--teal) 45%, transparent);
  background: color-mix(in srgb, var(--teal) 10%, transparent);
}
.tag {
  font-family: var(--dsw-font-mono); font-size: 10.5px; line-height: 16px; padding: 0 6px;
  border-radius: 5px; border: 0.5px solid var(--border-l3); color: var(--label-tertiary); white-space: nowrap;
}
.tag.definition { color: var(--brand); border-color: color-mix(in srgb, var(--brand) 45%, transparent); }
.tag.provider { color: var(--teal); border-color: color-mix(in srgb, var(--teal) 45%, transparent); }
.tag.consumer { color: var(--violet); border-color: color-mix(in srgb, var(--violet) 45%, transparent); }
.tag.bundle { color: var(--warn); border-color: color-mix(in srgb, var(--warn) 45%, transparent); }
.tag.client { color: var(--success); border-color: color-mix(in srgb, var(--success) 45%, transparent); }
.empty { padding: 60px 0; text-align: center; color: var(--label-caption); }
footer { padding: 26px 32px 60px; color: var(--label-caption); font-size: 12px; border-top: 0.5px solid var(--border-l1); }
@media (max-width: 760px) {
  .hero, .filterbar, .jump, main, footer { padding-left: 16px; padding-right: 16px; }
  .cards { grid-template-columns: 1fr; }
}
</style>
</head>
<body>

<div class="topbar">
  <div class="brandmark"><span class="dot"></span>DeepSeek Harness</div>
  <nav class="topnav">
    <a href="architecture-visual.html">架构总览</a>
    <a href="plugins-visual.html" class="on">插件目录</a>
  </nav>
  <div class="spacer"></div>
  <button class="iconbtn" id="themeBtn" type="button">切换主题</button>
</div>

<div class="hero">
  <h1>插件目录</h1>
  <p>DSH 里的一切都是插件。下面按类目列出 workspace 中的全部包：每个包的职责、它在接缝里扮演的角色，以及它拥有或消费的 <code>ctx</code> key。</p>
  <div class="stats" id="stats"></div>
  <div class="catbar" id="catbar"></div>
  <div class="catbarhint">各类目的包数占比，颜色与下方类目标题、跳转标签一致；点击色块跳转。</div>
</div>

<div class="filterbar">
  <input class="search" id="q" type="search" placeholder="搜索包名、功能、ctx key…" autocomplete="off">
  <div class="rolechips" id="roleChips"></div>
  <span class="keylegend"><b style="color:var(--brand)">owns</b> 拥有 · <b style="color:var(--teal)">impl</b> 实现 · <b>uses</b> 消费</span>
  <span class="hits" id="hits"></span>
</div>

<div class="jump" id="jump"></div>

<main id="main"></main>

<footer>
  包清单与英文描述在构建时从各 <code>package.json</code> 提取；<code>ctx</code> key 的角色归属取自 <code>docs/capability-seams.md</code>。视觉 token 取自 <code>packages/client/ui-theme</code>。
</footer>

<script id="dsh-data" type="application/json">${JSON.stringify(payload).replace(/</g, '\\u003c')}</script>
<script>
(function () {
  'use strict';
  var root = document.documentElement, D = JSON.parse(document.getElementById('dsh-data').textContent);
  var saved = null;
  try { saved = localStorage.getItem('dshlearn-theme'); } catch (e) { saved = null; }
  if (saved === 'light' || saved === 'dark') root.setAttribute('data-theme', saved);
  document.getElementById('themeBtn').addEventListener('click', function () {
    var n = root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    root.setAttribute('data-theme', n);
    try { localStorage.setItem('dshlearn-theme', n); } catch (e) { /* storage unavailable; theme stays session-local */ }
  });

  var ROLE = { definition: 'Definition · 接口', provider: 'Provider · 实现', consumer: 'Consumer · 使用方',
               library: 'Library · 库', bundle: 'Bundle · 组合层', infra: 'Infra · 基础设施' };
  var ROLE_SHORT = { definition: 'Definition', provider: 'Provider', consumer: 'Consumer',
                     library: 'Library', bundle: 'Bundle', infra: 'Infra' };

  var stats = document.getElementById('stats');
  [['packages', '个包'], ['groups', '个包组'], ['services', '个 ctx 服务'],
   ['categories', '个类目'], ['client', '个含浏览器半边']].forEach(function (s) {
    var d = document.createElement('div');
    d.className = 'stat';
    d.innerHTML = '<div class="v">' + D.counts[s[0]] + '</div><div class="l">' + s[1] + '</div>';
    stats.appendChild(d);
  });

  var roles = ['all'].concat(Object.keys(ROLE).filter(function (r) {
    return D.packages.some(function (p) { return p.r === r; });
  }));
  var activeRole = 'all';
  var chipEls = {};
  var chips = document.getElementById('roleChips');
  roles.forEach(function (r) {
    var b = document.createElement('button');
    b.type = 'button'; b.className = 'rchip' + (r === 'all' ? ' on' : '');
    b.textContent = r === 'all' ? '全部' : ROLE_SHORT[r];
    b.addEventListener('click', function () {
      activeRole = r;
      Object.keys(chipEls).forEach(function (k) { chipEls[k].classList.toggle('on', k === r); });
      render();
    });
    chipEls[r] = b; chips.appendChild(b);
  });

  var jump = document.getElementById('jump'), jumpEls = {};
  var catbar = document.getElementById('catbar');
  D.categories.forEach(function (c) {
    var a = document.createElement('a');
    a.href = '#' + c.id;
    a.innerHTML = '<i class="catdot" style="--h:' + c.hue + '"></i>' + esc(c.title) + ' <span class="jc" style="color:var(--label-caption)">' + c.count + '</span>';
    jump.appendChild(a);
    jumpEls[c.id] = a;

    var seg = document.createElement('a');
    seg.href = '#' + c.id;
    seg.style.width = (c.count / D.counts.packages * 100) + '%';
    seg.style.background = 'hsl(' + c.hue + ' 55% 55%)';
    seg.title = c.title + ' · ' + c.count + ' 个包';
    catbar.appendChild(seg);
  });

  var q = document.getElementById('q'), main = document.getElementById('main'), hits = document.getElementById('hits');
  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  function mark(text, term) {
    if (!term) return esc(text);
    var i = text.toLowerCase().indexOf(term);
    if (i < 0) return esc(text);
    return esc(text.slice(0, i)) + '<mark style="background:color-mix(in srgb,var(--warn) 40%,transparent);color:inherit;border-radius:3px">' +
      esc(text.slice(i, i + term.length)) + '</mark>' + esc(text.slice(i + term.length));
  }

  function render() {
    var term = q.value.trim().toLowerCase();
    var html = '', total = 0;
    D.categories.forEach(function (c) {
      var items = D.packages.filter(function (p) {
        if (!c.groups.includes(p.g)) return false;
        if (activeRole !== 'all' && p.r !== activeRole) return false;
        if (!term) return true;
        return (p.d + ' ' + p.n + ' ' + p.e + ' ' + p.z + ' ' + p.k.join(' ') + ' ' + p.i.join(' ') + ' ' + p.c.join(' '))
          .toLowerCase().indexOf(term) >= 0;
      });
      if (!items.length) { jumpEls[c.id].style.display = 'none'; return; }
      jumpEls[c.id].style.display = '';
      jumpEls[c.id].querySelector('.jc').textContent = items.length;
      total += items.length;
      html += '<section id="' + c.id + '"><div class="cathead"><span class="catdot" style="--h:' + c.hue + '"></span><h2>' + esc(c.title) + '</h2>' +
        '<span class="c">' + items.length + '</span>' +
        '<span class="g">' + c.groups.join(' · ') + '</span></div>' +
        '<p class="catdesc">' + esc(c.desc) + '</p><div class="cards">';
      items.forEach(function (p) {
        var keys = p.k.map(function (k) { return '<span class="k-own">owns ' + esc(k) + '</span>'; })
          .concat(p.i.map(function (k) { return '<span class="k-impl">impl ' + esc(k) + '</span>'; }))
          .concat(p.c.map(function (k) { return '<span class="k-use">uses ' + esc(k) + '</span>'; })).join('');
        html += '<div class="pcard"><div class="top"><span class="nm">' + mark(p.d, term) + '</span>' +
          '<span class="tag ' + p.r + '">' + ROLE_SHORT[p.r] + '</span>' +
          (p.w ? '<span class="tag client">client</span>' : '') + '</div>' +
          (p.z ? '<div class="zh">' + mark(p.z, term) + '</div>' : '') +
          '<div class="en">' + mark(p.e, term) + '</div>' +
          (keys ? '<div class="keys">' + keys + '</div>' : '') + '</div>';
      });
      html += '</div></section>';
    });
    main.innerHTML = html || '<div class="empty">没有匹配的包。试试清空搜索或换一个角色筛选。</div>';
    hits.textContent = total + ' / ' + D.counts.packages;
  }
  q.addEventListener('input', render);
  render();
})();
</script>
</body>
</html>
`

writeFileSync(outFile, html)
console.log(`wrote ${outFile}`)
console.log(`packages=${payload.counts.packages} categories=${payload.counts.categories} withZh=${rows.filter((r) => r.z).length}`)
