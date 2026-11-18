import { expect, test } from 'claude-code/testing'

import { boxFor, cellRatioOf, inlineMaxRows } from '../hooks/layout.ts'

test('an inline portrait page fits a short terminal', () => {
  // A letter page in a 40-row window: 36 rows would make a card taller than
  // the screen, and the picture would spill out below it.
  const page = { width: 1020, height: 1320 }
  const box = boxFor(page, 108, inlineMaxRows(36, 40), 64)
  expect(box.rows).toBe(24)
  expect(box.columns).toBeLessThan(64)
  // A tall window keeps the size's own cap, and an unknown height too.
  expect(inlineMaxRows(36, 80)).toBe(36)
  expect(inlineMaxRows(16, undefined)).toBe(16)
  // A tiny window still gets a picture.
  expect(inlineMaxRows(36, 12)).toBe(6)
})

test('a cell ratio comes from the terminal size, or not at all', () => {
  // 53 rows by 186 columns over 2984 by 1818 pixels: 16 px wide, 34.3 tall.
  expect(Math.round((cellRatioOf('53 186 2984 1818\n') ?? 0) * 100)).toBe(214)
  expect(cellRatioOf('')).toBeUndefined()
  // Terminals that report no pixels, and sizes no font has (tmux, ssh).
  expect(cellRatioOf('53 186 0 0')).toBeUndefined()
  expect(cellRatioOf('50 100 800 4000')).toBeUndefined()
})

test('a taller cell takes fewer rows for the same picture', () => {
  const page = { width: 1000, height: 750 }
  expect(boxFor(page, 100, 50, 64)).toEqual({ columns: 64, rows: 24 })
  expect(boxFor(page, 100, 50, 64, 2.4)).toEqual({ columns: 64, rows: 20 })
})
