// Where the terminal can't draw pictures, a page is drawn in block characters:
// each cell holds 2 by 2 pixels in two colours, the quadrant glyph picking which
// pixels take the foreground. Bit 0 is top left, 1 top right, 2 bottom left, 3
// bottom right.
export const QUADRANTS = ' ▘▝▀▖▌▞▛▗▚▐▜▄▙▟█'

export type Rgb = [number, number, number]

// The pixels of an uncompressed 24- or 32-bit BMP, as cells.sh writes it, top
// row first; transparent pixels go on white.
export function readBmp(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (view.getUint16(0) !== 0x424d) {
    throw new Error('not a BMP')
  }
  const start = view.getUint32(10, true)
  const header = view.getUint32(14, true)
  const width = view.getInt32(18, true)
  const tall = view.getInt32(22, true)
  const bits = view.getUint16(28, true)
  if (bits !== 24 && bits !== 32) {
    throw new Error(`a ${bits}-bit BMP`)
  }
  // 32-bit pixels say where each channel is; 24-bit ones are blue, green, red.
  const masks = bits === 32 && header >= 56 && view.getUint32(30, true) === 3
    ? [0, 4, 8, 12].map(at => view.getUint32(54 + at, true))
    : [0xff0000, 0xff00, 0xff, bits === 32 ? 0xff000000 : 0]
  const channel = (value: number, mask: number) =>
    mask === 0 ? 255 : (((value & mask) >>> 0) / mask) * 255
  const height = Math.abs(tall)
  const stride = Math.ceil((width * bits) / 32) * 4
  const at = (x: number, y: number): Rgb => {
    const row = tall < 0 ? y : height - 1 - y
    const offset = start + row * stride + x * (bits / 8)
    const value = bits === 32
      ? view.getUint32(offset, true)
      : view.getUint8(offset) | (view.getUint8(offset + 1) << 8) | (view.getUint8(offset + 2) << 16)
    const alpha = masks[3] === 0 ? 1 : channel(value, masks[3]!) / 255
    const blend = (mask: number) => Math.round(channel(value, mask) * alpha + 255 * (1 - alpha))

    return [blend(masks[0]!), blend(masks[1]!), blend(masks[2]!)]
  }

  return { width, height, at }
}

// One cell from its four pixels: the split into two colours that strays least.
export function quadrant(pixels: Rgb[]): [number, number, number] {
  const pack = ([r, g, b]: Rgb) => (r << 16) | (g << 8) | b
  let best = { error: Number.POSITIVE_INFINITY, mask: 15, fg: pixels[0]!, bg: pixels[0]! }
  // A split and its complement are one split; bit 3 stays background.
  for (let mask = 0; mask < 8; mask++) {
    const groups: [Rgb[], Rgb[]] = [[], []]
    pixels.forEach((pixel, i) => groups[(mask >> i) & 1 ? 0 : 1].push(pixel))
    const mean = (group: Rgb[]): Rgb =>
      [0, 1, 2].map(c => group.reduce((sum, p) => sum + p[c]!, 0) / Math.max(1, group.length)) as Rgb
    const fg = mean(groups[0])
    const bg = mean(groups[1])
    let error = 0
    pixels.forEach((pixel, i) => {
      const centre = (mask >> i) & 1 ? fg : bg
      error += pixel.reduce((sum, v, c) => sum + (v - centre[c]!) ** 2, 0)
    })
    if (error < best.error) {
      best = { error, mask: mask === 0 ? 15 : mask, fg: mask === 0 ? bg : fg, bg }
    }
  }
  const round = (rgb: Rgb) => rgb.map(Math.round) as Rgb

  return [QUADRANTS.codePointAt(best.mask)!, pack(round(best.fg)), pack(round(best.bg))]
}

// In iTerm2, scripts/iterm_overlay.py draws the real picture over a block
// preview. It finds each box by a marker hidden in the first cells of every
// row: a check glyph, three for the box's id and one for the row, braille
// because nothing else draws it, in the cell's own colour so it doesn't show.
// Each glyph mixes in the row, so when a box moves every marker cell changes
// and Claude Code paints them all again. After inline-images (MIT).
export const MARKER_CELLS = 5
export const BRAILLE_BLANK = 0x2800

export function markerOf(png: string, columns: number, rows: number) {
  let hash = 0x811c9dc5
  for (const char of `${png}:${columns}:${rows}`) {
    hash = Math.imul(hash ^ char.charCodeAt(0), 0x01000193) >>> 0
  }

  return [hash & 0xff, (hash >>> 8) & 0xff, (hash >>> 16) & 0xff]
}

export function markerGlyphs(marker: number[], row: number) {
  const r = row & 0xff
  const shuffled = marker.map((byte, i) => (byte + r * 37 + (i + 1) * 11) & 0xff)
  const check = (marker[0]! + marker[1]! + marker[2]! + r * 37 + 0x5a) & 0xff

  return [check, ...shuffled, r].map(value => BRAILLE_BLANK + value)
}
