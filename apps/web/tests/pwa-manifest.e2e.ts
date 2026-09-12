import { readFile, stat } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { expect, it } from 'vitest'

const DIST_ROOT = fileURLToPath(new URL('../dist', import.meta.url))

it('ships install metadata with the built web application', async () => {
  const index = await readFile(join(DIST_ROOT, 'index.html'), 'utf8')
  expect(index).toContain('<link rel="manifest" href="./manifest.webmanifest" />')

  const manifest: unknown = JSON.parse(await readFile(join(DIST_ROOT, 'manifest.webmanifest'), 'utf8'))
  expect(manifest).toEqual({
    id: '/',
    name: 'DeepSeek Harness',
    short_name: 'DSH',
    start_url: '/',
    scope: '/',
    display: 'fullscreen',
    background_color: '#151517',
    theme_color: '#151517',
    icons: [{
      src: '/icon-192.png',
      sizes: '192x192',
      type: 'image/png',
      purpose: 'any',
    }, {
      src: '/icon-512.png',
      sizes: '512x512',
      type: 'image/png',
      purpose: 'any',
    }, {
      src: '/favicon.svg',
      sizes: 'any',
      type: 'image/svg+xml',
      purpose: 'any',
    }],
  })

  // A manifest that names an icon the build does not serve produces an
  // uninstallable application, so every source is checked in the shipped tree.
  for (const icon of (manifest as { icons: { src: string }[] }).icons) {
    await expect(stat(join(DIST_ROOT, icon.src))).resolves.toBeDefined()
  }
})

it('ships a favicon that switches to a light mark under dark color scheme', async () => {
  const favicon = await readFile(join(DIST_ROOT, 'favicon.svg'), 'utf8')
  // The light fill must live inside the dark-scheme media query, so the icon
  // stays black in light mode and only turns white under a dark scheme.
  expect(favicon).toMatch(/@media \(prefers-color-scheme: dark\)\s*{\s*path\s*{[^}]*fill:\s*#fff/i)
  expect(favicon).toContain('fill="#000"')
})
