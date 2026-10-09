// Extracts the DSH package inventory for docs/dshlearn/.
// Usage: node extract-packages.mjs [repoRoot] [outFile]
// Defaults: repoRoot = two levels up from this file, outFile = ./packages.json
import { readdirSync, readFileSync, writeFileSync, statSync, existsSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = process.argv[2] ?? resolve(here, '..', '..', '..')
const outFile = process.argv[3] ?? join(here, 'packages.json')
const packagesRoot = join(repoRoot, 'packages')

/** Lists immediate subdirectories of a directory. */
function dirs(p) {
  return readdirSync(p).filter((n) => statSync(join(p, n)).isDirectory())
}

const packages = []
for (const group of dirs(packagesRoot)) {
  for (const dir of dirs(join(packagesRoot, group))) {
    const pj = join(packagesRoot, group, dir, 'package.json')
    if (!existsSync(pj)) continue
    const json = JSON.parse(readFileSync(pj, 'utf8'))
    const exportsField = json.exports ?? {}
    packages.push({
      group,
      dir,
      rel: `packages/${group}/${dir}`,
      name: json.name,
      description: json.description ?? '',
      version: json.version ?? '',
      private: json.private === true,
      client: json.dsh?.client ? { platform: json.dsh.client.platform ?? null, inject: json.dsh.client.inject ?? [] } : null,
      hasInvariant: Object.prototype.hasOwnProperty.call(exportsField, './invariant'),
      depCount: Object.keys(json.dependencies ?? {}).length,
    })
  }
}

// ctx service table from the generated capability graph.
const seamsFile = join(repoRoot, 'docs', 'capability-seams.md')
const services = []
for (const line of readFileSync(seamsFile, 'utf8').split('\n')) {
  if (!line.startsWith('| `ctx.')) continue
  const cells = line.split('|').map((c) => c.trim())
  const key = cells[1].replaceAll('`', '')
  const role = cells[2].replaceAll('`', '')
  const pkgPaths = (cell) => [...cell.matchAll(/\]\(\.\.\/(packages\/[^)]+)\)/g)].map((m) => m[1])
  services.push({
    key,
    role,
    owner: pkgPaths(cells[3]).map((p) => p.replace(/^\//, '')),
    implementations: pkgPaths(cells[4]),
    consumers: pkgPaths(cells[5]),
    companions: pkgPaths(cells[6]),
    note: cells[7],
  })
}

// Attach service participation to each package.
for (const pkg of packages) {
  const owned = services.filter((s) => s.owner.includes(pkg.rel)).map((s) => s.key)
  const implementsSeam = services.filter((s) => s.implementations.includes(pkg.rel)).map((s) => s.key)
  const consumes = services.filter((s) => s.consumers.includes(pkg.rel)).map((s) => s.key)
  pkg.owns = owned
  pkg.implements = implementsSeam
  pkg.consumes = consumes
}

const groups = [...new Set(packages.map((p) => p.group))].sort()
const payload = {
  counts: {
    packages: packages.length,
    groups: groups.length,
    services: services.length,
    clientPackages: packages.filter((p) => p.client).length,
  },
  groups,
  packages: packages.sort((a, b) => a.rel.localeCompare(b.rel)),
  services: services.sort((a, b) => a.key.localeCompare(b.key)),
}
writeFileSync(outFile, JSON.stringify(payload, null, 1))
console.log(`packages=${payload.counts.packages} groups=${payload.counts.groups} services=${payload.counts.services} client=${payload.counts.clientPackages}`)
