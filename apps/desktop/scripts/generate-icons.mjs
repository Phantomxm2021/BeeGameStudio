import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import sharp from 'sharp'

// Reuse the canonical mascot paths and transparent eye mask without redrawing them.
const source = await readFile(new URL('../../frontend/public/assets/bgs_logo.svg', import.meta.url), 'utf8')
const mark = source.replace(/<\?xml[^>]*>\s*/, '').replace(
  /<svg\b[^>]*>/,
  '<svg x="128" y="128" width="768" height="768" viewBox="0 0 1254 1254" fill="none">',
)
const master = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <title>Bee Game Studio</title>
  <rect x="80" y="80" width="864" height="864" rx="192" fill="#101114" stroke="#2a2d33" stroke-width="2"/>
  ${mark}
</svg>
`
const assets = fileURLToPath(new URL('../assets/', import.meta.url))
await mkdir(assets, { recursive: true })
await writeFile(path.join(assets, 'app-icon.svg'), master)
const png = size => sharp(Buffer.from(master)).resize(size, size).png().toBuffer()
await writeFile(path.join(assets, 'app-icon.png'), await png(1024))

// ICO accepts PNG-compressed images; retain small sizes for Explorer and titlebars.
const sizes = [16, 32, 48, 64, 128, 256]
const images = await Promise.all(sizes.map(png))
const directory = Buffer.alloc(6 + images.length * 16)
directory.writeUInt16LE(1, 2)
directory.writeUInt16LE(images.length, 4)
let offset = directory.length
for (let index = 0; index < images.length; index++) {
  const entry = 6 + index * 16
  directory[entry] = directory[entry + 1] = sizes[index] % 256
  directory.writeUInt16LE(1, entry + 4)
  directory.writeUInt16LE(32, entry + 6)
  directory.writeUInt32LE(images[index].length, entry + 8)
  directory.writeUInt32LE(offset, entry + 12)
  offset += images[index].length
}
await writeFile(path.join(assets, 'app-icon.ico'), Buffer.concat([directory, ...images]))

// Modern ICNS representations contain PNG images with big-endian chunk headers.
const representations = [
  ['icp4', 16], ['icp5', 32], ['icp6', 64], ['ic07', 128],
  ['ic08', 256], ['ic09', 512], ['ic10', 1024],
  ['ic11', 32], ['ic12', 64], ['ic13', 256], ['ic14', 512],
]
const chunks = await Promise.all(representations.map(async ([type, size]) => {
  const image = await png(size)
  const header = Buffer.alloc(8)
  header.write(type, 0, 'ascii')
  header.writeUInt32BE(image.length + 8, 4)
  return Buffer.concat([header, image])
}))
const header = Buffer.alloc(8)
header.write('icns', 0, 'ascii')
header.writeUInt32BE(8 + chunks.reduce((sum, chunk) => sum + chunk.length, 0), 4)
await writeFile(path.join(assets, 'app-icon.icns'), Buffer.concat([header, ...chunks]))
console.log('Generated BGS app icons from the existing frontend mascot.')
