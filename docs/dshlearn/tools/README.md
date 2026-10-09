# dshlearn build tooling

English | [中文](README.zh.md)

The package inventory, the package descriptions, and the `ctx` key ownership shown in `plugins-visual.html` are generated rather than transcribed. Rerun these two scripts after packages are added, removed, or renamed.

```sh
# run from this directory
node extract-packages.mjs      # scan the repository packages/, write ./packages.json
node build-plugins.mjs         # read ./packages.json + ./descriptions.json, write ../plugins-visual.html
```

`extract-packages.mjs` also parses the owner, implementations, and consumers of every `ctx` key out of `docs/capability-seams.md`, so regenerate that document too once a seam changes (`pnpm run gen-doc-graphs`).

| File | Role |
|---|---|
| `extract-packages.mjs` | Scans `packages/*/*/package.json` and `docs/capability-seams.md`, producing `packages.json` |
| `packages.json` | Generated: name, description, client flag, and `ctx` key ownership for the workspace packages, plus the `ctx` services and the 12-category grouping |
| `descriptions.json` | **Hand-reviewed one-sentence Chinese descriptions**, indexed by package path and carrying a role label. Regenerating the page never overwrites it; it is maintained by hand |
| `build-plugins.mjs` | Renders the two data files above into `../plugins-visual.html` |

`descriptions.json` is the only input a person maintains: a newly added package has no entry there, so `build-plugins.mjs` prints its name to stderr and the page shows that package's English description alone.
