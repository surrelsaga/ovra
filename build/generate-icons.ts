// Run: npx tsx build/generate-icons.ts. No image libraries; reuse the orb's cells and palette.
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { deflateSync } from 'node:zlib'
import { moonPixels, TONES } from '../src/renderer/ui/moonPixels'

const theme = readFileSync('src/shared/theme.css', 'utf8')
const moonCss = readFileSync('src/renderer/ui/moon.css', 'utf8')
const rgb = (hex: string): number[] => hex.match(/\w\w/g)!.map((v) => parseInt(v, 16))
const token = (name: string): number[] => rgb(theme.match(new RegExp(`--${name}: #(\\w{6})`))![1])
const bg = token('bg')
const core = token('orb-calm')
const ink = rgb(moonCss.match(/--ink: #(\w{6})/)![1])
const mix = (a: number[], b: number[], weight: number): number[] =>
  a.map((v, i) => Math.round(v * weight + b[i] * (1 - weight)))
const palette = {
  outline: bg,
  crater: mix(core, ink, 0.32),
  shade: mix(core, ink, 0.52),
  base: mix(core, ink, 0.74),
  light: core,
  rim: mix(core, [255, 255, 255], 0.45)
}
const sizes = [16, 32, 48, 64, 128, 256, 512, 1024]

function chunk(type: string, data: Buffer): Buffer {
  const bytes = Buffer.concat([Buffer.from(type), data])
  let crc = 0xffffffff
  for (const b of bytes) {
    crc ^= b
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
  }
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const checksum = Buffer.alloc(4)
  checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0)
  return Buffer.concat([length, bytes, checksum])
}

function png(size: number): Buffer {
  // Like the orb's small logo, use fewer cells at tiny sizes so the moon still reads.
  const grid = size <= 32 ? 16 : 32
  const disk = size <= 32 ? 12 : 22
  const art = moonPixels(disk, grid)
  const cells = new Map<string, number[]>()
  const paint = (path: string, color: number[]): void => {
    for (const m of path.matchAll(/M(\d+) (\d+)h1v1h-1z/g)) cells.set(`${m[1]},${m[2]}`, color)
  }
  paint(art.haloDither, mix([150, 185, 255], bg, 0.15))
  paint(art.halo, mix([150, 185, 255], bg, 0.3))
  for (const tone of TONES) paint(art.tones[tone], palette[tone])
  assert(cells.size > 0)

  const stride = size * 4 + 1
  const pixels = Buffer.alloc(size * stride)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const color =
        cells.get(`${Math.floor((x * grid) / size)},${Math.floor((y * grid) / size)}`) ?? bg
      // Rounded square with transparent outer margin, matching macOS app-icon proportions.
      const dx = Math.max(0, Math.abs((x + 0.5) / size - 0.5) - 0.25)
      const dy = Math.max(0, Math.abs((y + 0.5) / size - 0.5) - 0.25)
      const alpha = Math.min(1, Math.max(0, (0.1875 - Math.hypot(dx, dy)) * size + 0.5))
      pixels.set([...color, Math.round(alpha * 255)], y * stride + 1 + x * 4)
    }
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(size, 0)
  header.writeUInt32BE(size, 4)
  header[8] = 8
  header[9] = 6 // RGBA
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(pixels)),
    chunk('IEND', Buffer.alloc(0))
  ])
}

const images = new Map(sizes.map((size) => [size, png(size)]))
writeFileSync('build/icon.png', images.get(1024)!)
writeFileSync('resources/icon.png', images.get(1024)!)

// Let macOS encode the small ICNS representations and their Retina variants.
const temp = mkdtempSync(join(tmpdir(), 'ovra-icons-'))
const iconset = join(temp, 'Ovra.iconset')
mkdirSync(iconset)
try {
  for (const size of [16, 32, 128, 256, 512]) {
    writeFileSync(join(iconset, `icon_${size}x${size}.png`), images.get(size)!)
    writeFileSync(join(iconset, `icon_${size}x${size}@2x.png`), images.get(size * 2)!)
  }
  execFileSync('iconutil', ['-c', 'icns', iconset, '-o', 'build/icon.icns'])
} finally {
  rmSync(temp, { recursive: true, force: true })
}

// ICO supports PNG, including its 256 px entry.
const icoSizes = sizes.filter((size) => size <= 256)
const icoHeader = Buffer.alloc(6 + 16 * icoSizes.length)
icoHeader.writeUInt16LE(1, 2)
icoHeader.writeUInt16LE(icoSizes.length, 4)
let offset = icoHeader.length
icoSizes.forEach((size, i) => {
  const image = images.get(size)!
  const at = 6 + i * 16
  icoHeader[at] = icoHeader[at + 1] = size === 256 ? 0 : size
  icoHeader.writeUInt16LE(1, at + 4)
  icoHeader.writeUInt16LE(32, at + 6)
  icoHeader.writeUInt32LE(image.length, at + 8)
  icoHeader.writeUInt32LE(offset, at + 12)
  offset += image.length
})
const ico = Buffer.concat([icoHeader, ...icoSizes.map((size) => images.get(size)!)])
assert.equal(ico.length, offset)
assert.equal(images.get(1024)!.readUInt32BE(16), 1024)
writeFileSync('build/icon.ico', ico)
console.info('Generated Ovra PNG (1024), ICNS (16–1024), ICO (16–256), and runtime icon.')
