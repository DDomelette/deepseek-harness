/** Rasterize the app favicon into the PNG icons the web manifest names. */
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const publicDir = fileURLToPath(new URL('../public/', import.meta.url))
const source = fileURLToPath(new URL('../public/favicon.svg', import.meta.url))

for (const [name, size] of [['icon-192.png', 192], ['icon-512.png', 512], ['apple-touch-icon.png', 180]]) {
  await sharp(source, { density: 384 }).resize(size, size).png().toFile(`${publicDir}${name}`)
  console.log(`wrote ${name}`)
}
