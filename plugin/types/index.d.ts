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
      isTest?: true
    }
  | { kind: 'unsupported'; source: string; reason: string; caption?: string }

export type Thumb = { page: number; png: string; width: number; height: number }

export type Viewer = {
  preview: Extract<Preview, { kind: 'image' }>
  thumbs?: Thumb[]
  // The footer holds a field for typing a page number.
  isGoing?: true
  // Where the thumbnails go, fixed for the file: a strip below or a column beside.
  layout?: 'strip' | 'column'
}

declare module 'claude-code' {
  interface PluginState {
    'file-viewer': {
      previews: Record<string, Preview>
      viewer: Viewer | null
    }
  }
}
