export type Size = 'small' | 'medium' | 'large'

export type Frame = { png: string; ms: number }

export type Preview =
  | {
      kind: 'image'
      source: string
      png: string
      width: number
      height: number
      page: number
      pages: number
      frames?: Frame[]
      note?: string
      caption?: string
      size?: Size
    }
  | { kind: 'unsupported'; source: string; reason: string; caption?: string }

export type GridCell = { page: number; png: string; width: number; height: number }

export type Viewer = {
  preview: Extract<Preview, { kind: 'image' }>
  grid?: { start: number; cells: GridCell[] }
}

declare module 'claude-code' {
  interface PluginState {
    'asset-viewer': {
      previews: Record<string, Preview>
      viewer: Viewer | null
    }
  }
}
