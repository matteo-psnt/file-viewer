// Terminal cells are about twice as tall as wide, so halve the row count.
export function boxFor(
  size: { width: number; height: number },
  columnsAvailable: number,
  maxRows: number,
  width: number,
) {
  let columns = Math.max(1, Math.min(width, columnsAvailable, 255))
  let rows = Math.round((columns * size.height) / size.width / 2)
  if (rows > maxRows) {
    columns = Math.max(1, Math.round((columns * maxRows) / rows))
    rows = maxRows
  }

  return { columns, rows: Math.max(1, Math.min(rows, 255)) }
}

export const SIDEBAR = 5

// The pages around `page` that the viewer's sidebar shows, centred on it.
export function sidebarPages(page: number, pages: number) {
  const first = Math.min(Math.max(1, page - Math.floor(SIDEBAR / 2)), Math.max(1, pages - SIDEBAR + 1))

  return Array.from({ length: Math.min(SIDEBAR, pages) }, (_, i) => first + i)
}

export function footerHints(isFocused: boolean, isPaged: boolean) {
  if (!isFocused) {
    return ['ctrl+x tab to use keys', 'ctrl+x tab']
  }

  return [isPaged ? '↑↓ pages · esc close' : '', 'esc close']
}
