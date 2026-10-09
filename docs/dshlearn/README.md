# dshlearn — visual guides to the harness architecture

English | [中文](README.zh.md)

Self-contained HTML pages that show how DeepSeek Harness is put together. Each page is one file with inline CSS and JavaScript, and opens directly in a browser: no build step, no server, no network access, no dependencies.

Both pages describe current behaviour, and the architecture page links no generated catalog. The package catalog is the exception: its data comes from the workspace, so it goes stale when packages change.

A third page records [how these pages explain the harness](explaining-the-harness.md) and what an earlier version of the turn walkthrough got wrong.

## Pages

| Page | What it shows |
|---|---|
| [`architecture-visual.html`](architecture-visual.html) | Profile boot order, the product spine, a step-through player of the turn and step lifecycle that shows the payload each frame carries, the three event domains, context assembly and injection, skills and MCP, capability seams, the session log, and the guarded tool pipeline |
| [`plugins-visual.html`](plugins-visual.html) | Every workspace package in 12 categories, each with its seam role, its `ctx` keys, and a one-line description; searchable by text and filterable by role |

## Regenerating the package catalog

The catalog embeds data extracted from the workspace instead of hand-written prose. [`tools/`](tools/README.md) owns the extraction script, the reviewed descriptions, and the renderer; read that page before running them.
