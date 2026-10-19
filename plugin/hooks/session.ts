import type { Timer } from 'claude-code'

import { MARKER_CELLS } from './blocks.ts'
import type { Blocked } from './deny.ts'

// What this load of the plugin holds between hooks: the probe's verdict, how
// pictures travel, the iTerm2 helper's state, running animations and caches.
// The functions that act on it take $, so they live in register.tsx.

// How a picture reaches the terminal: by path, which the terminal reads itself,
// or as bytes in the drawing. A terminal on another machine (ssh), Warp and
// a Windows terminal in front of WSL cannot read this machine's files.
export type Transport = 'file' | 'bytes'
// The transport once chosen, and the setting that can force one.
export const link: { transport?: Transport; setting: unknown } = { setting: 'auto' }

// What the terminal showed when the plugin drew a one-cell picture in the band
// above the prompt at session start and swapped it: Claude Code refuses a swap
// onto a picture it is drawing as alt text, and says why.
export type Probe = {
  phase: 'idle' | 'drawing' | 'done'
  bandId?: string
  verdict?: Transport | 'none'
  blocked?: Blocked
}
export const probe: Probe = { phase: 'idle' }
export const PROBE_BYTES =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNgAAIAAAUAAen63NgAAAAASUVORK5CYII='

export const bytesOf = new Map<string, string>()

// Whether pictures go out as block characters: the probe found the terminal
// can't draw them.
export function isBlocks() {
  return probe.blocked !== undefined
}

// The helper's state; `overlay.state`, so other modules see it change.
export const overlay: { state: 'off' | 'starting' | 'live' | 'failed' } = { state: 'off' }
export const registered = new Set<string>()

// Whether block previews carry markers: the overlay runs or is starting.
export function isMarked(columns: number) {
  return (overlay.state === 'starting' || overlay.state === 'live') && columns >= MARKER_CELLS
}

// Animation: a keyed Image whose source a timer swaps frame by frame.
export type Animation = { timer?: Timer; frame: number; loops: number; misses: number }
export const animations = new Map<string, Animation>()
// Animations started this load: a redraw must not restart one that finished.
export const started = new Set<string>()

export function stopAnimation(id: string) {
  animations.get(id)?.timer?.cancel()
  animations.delete(id)
}

export const cellsOf = new Map<string, string>()

export type Draw = { key: string; png: string; columns: number; rows: number; alt: string }

// What a click on a picture opens, by the drawing and the click layer's key:
// the layer's message names no path, so nothing it sends picks the file.
export const clickTargets = new Map<string, string>()

// A preview whose PNG the cache lost is rendered again, outside the draw.
export const rerendering = new Set<string>()

// Deliveries being rendered, and overlay records already written.
export const delivering = new Set<string>()

// A cell's height over its width, and the column count it was measured at: a
// font zoom changes the columns, so a new count measures again.
export const cell: { ratio: number; measuredAt?: number; isMeasuring: boolean } = { ratio: 2, isMeasuring: false }
