import { expect, test } from 'claude-code/testing'

import { boxFor, cellRatioOf } from '../hooks/layout.ts'

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
