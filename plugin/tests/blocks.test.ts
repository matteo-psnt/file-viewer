import { expect, test } from 'claude-code/testing'

import { markerGlyphs, markerOf, quadrant, QUADRANTS, readBmp, type Rgb } from '../hooks/blocks.ts'

// A 2 by 2 BMP of the given pixels, top row first, 24-bit or 32-bit with alpha.
function bmp(pixels: number[][], { bits = 24, bottomUp = false } = {}) {
  const stride = Math.ceil((2 * bits) / 32) * 4
  const start = bits === 32 ? 138 : 54
  const bytes = new Uint8Array(start + stride * 2)
  const view = new DataView(bytes.buffer)
  view.setUint16(0, 0x424d)
  view.setUint32(10, start, true)
  view.setUint32(14, bits === 32 ? 124 : 40, true)
  view.setInt32(18, 2, true)
  view.setInt32(22, bottomUp ? 2 : -2, true)
  view.setUint16(28, bits, true)
  if (bits === 32) {
    view.setUint32(30, 3, true)
    ;[0xff0000, 0xff00, 0xff, 0xff000000].forEach((mask, i) => view.setUint32(54 + i * 4, mask, true))
  }
  pixels.forEach((rgba, i) => {
    const y = Math.floor(i / 2)
    const row = bottomUp ? 1 - y : y
    const at = start + row * stride + (i % 2) * (bits / 8)
    const [r, g, b, a = 255] = rgba as [number, number, number, number?]
    bytes.set(bits === 32 ? [b, g, r, a] : [b, g, r], at)
  })

  return bytes
}

test('a BMP reads the same top-down and bottom-up', () => {
  const pixels = [[255, 0, 0], [0, 255, 0], [0, 0, 255], [9, 9, 9]]
  for (const bottomUp of [false, true]) {
    const read = readBmp(bmp(pixels, { bottomUp }))
    expect([read.at(0, 0), read.at(1, 0), read.at(0, 1), read.at(1, 1)]).toEqual(pixels)
  }
})

test('a transparent pixel goes on white', () => {
  const read = readBmp(bmp([[0, 0, 0, 0], [0, 0, 0, 255], [255, 0, 0, 128], [0, 0, 0, 255]], { bits: 32 }))
  expect(read.at(0, 0)).toEqual([255, 255, 255])
  expect(read.at(1, 0)).toEqual([0, 0, 0])
  expect(read.at(0, 1)).toEqual([255, 127, 127])
})

test('a cell splits its four pixels into the two colours that fit best', () => {
  const red: Rgb = [255, 0, 0]
  const blue: Rgb = [0, 0, 255]
  // Left column red: the left half block in red on blue.
  expect(quadrant([red, blue, red, blue])).toEqual([QUADRANTS.codePointAt(5), 0xff0000, 0x0000ff])
  // One colour: a full block.
  expect(quadrant([red, red, red, red])).toEqual([QUADRANTS.codePointAt(15), 0xff0000, 0xff0000])
})

test('a marker carries its box and row in braille the overlay reads back', () => {
  const marker = markerOf('/c/p1.png', 64, 32)
  // The same id iterm_overlay.py decodes for this box (checked against it).
  expect(marker.map(byte => byte.toString(16).padStart(2, '0')).join('')).toBe('79f909')
  for (const row of [0, 7, 255]) {
    const glyphs = markerGlyphs(marker, row)
    expect(glyphs.every(code => code >= 0x2800 && code <= 0x28ff)).toBe(true)
    expect(glyphs[4]).toBe(0x2800 + row)
  }
  // No marker cell repeats on the row below, so a moved box repaints them all.
  const [a, b] = [markerGlyphs(marker, 3), markerGlyphs(marker, 4)]
  expect(a.some((code, i) => code === b[i])).toBe(false)
})
