import type { Preview, Size } from '../types'

export type ImagePreview = Extract<Preview, { kind: 'image' }>

export const TOOL = 'preview'
export const FULL_TOOL = 'mcp__file-viewer__preview'
export const PANE = 'file-viewer'
export const TEXT = /\.(md|markdown|txt|csv|tsv|json|ya?ml|toml|xml|html?|css|log|ipynb|py|ts|tsx|js|jsx|java|c|h|cpp|hpp|cc|rs|go|rb|sh|zsh|sql|tex|scala|kt|swift|hs)$/i
export const SUPPORTED =
  'PDF; Word, PowerPoint and Excel (every page); images (png, jpg, heic, avif, webp, tiff, ' +
  'bmp, psd, camera raw); animated gif/webp; svg; Keynote, Pages and Numbers (first page)'
export const WIDTH: Record<Size, number> = { small: 36, medium: 64, large: 100 }
export const FORMAT: Record<string, string> = {
  pdf: 'PDF', docx: 'Word', doc: 'Word', rtf: 'Rich Text', odt: 'Document',
  pptx: 'PowerPoint', ppt: 'PowerPoint', odp: 'Presentation',
  xlsx: 'Excel', xls: 'Excel', ods: 'Spreadsheet',
  key: 'Keynote', pages: 'Pages', numbers: 'Numbers', svg: 'SVG', svgz: 'SVG',
  gif: 'GIF', webp: 'WebP', heic: 'HEIC', heif: 'HEIF',
}

export function nameOf(path: string) {
  return path.split('/').pop() ?? path
}

export function extOf(path: string) {
  const name = nameOf(path)

  return name.includes('.') ? (name.split('.').pop() ?? '').toLowerCase() : ''
}

export function formatOf(path: string) {
  const ext = extOf(path)

  return FORMAT[ext] ?? (ext === '' ? 'File' : ext.toUpperCase())
}

export function clampPage(p: ImagePreview, page: number) {
  return Math.min(Math.max(1, page), p.pages)
}

export function pageLabel(p: ImagePreview) {
  return p.pages > 1 ? ` · page ${p.page}/${p.pages}` : ''
}

export function unsupportedText(value: Extract<Preview, { kind: 'unsupported' }>) {
  return `Can't preview ${nameOf(value.source)}: ${value.reason}. Supported: ${SUPPORTED}.`
}
