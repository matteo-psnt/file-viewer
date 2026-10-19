// The box of cells a picture takes. `cellRatio` is a cell's height over its
// width: about 2 in most fonts, measured where the terminal says (cellRatioOf).
export function boxFor(
  size: { width: number; height: number },
  columnsAvailable: number,
  maxRows: number,
  width: number,
  cellRatio = 2,
) {
  let columns = Math.max(1, Math.min(width, columnsAvailable, 255))
  let rows = Math.round((columns * size.height) / size.width / cellRatio)
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

// A cell's height over its width from the terminal's size in cells and pixels
// (cell.sh), or undefined when it doesn't say. Real fonts fall between 1.25 and
// 3.4; outside that the report is wrong (tmux, ssh), so it's not used.
export function cellRatioOf(report: string) {
  const [rows = 0, columns = 0, width = 0, height = 0] = report.trim().split(/\s+/).map(Number)
  if (!(rows > 0 && columns > 0 && width > 0 && height > 0)) {
    return undefined
  }
  const ratio = height / rows / (width / columns)

  return ratio >= 1.25 && ratio <= 3.4 ? ratio : undefined
}
