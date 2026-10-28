import { REPORT_KINDS, type ReportKind } from './reports'

/**
 * The reports' icons on the map and in the alert, Waze's way: a round badge in the kind's colour with a white
 * edge and a glyph, drawn here when the map first asks for them (`report-<kind>`, style.ts).
 */

export const REPORT_COLOURS: Record<ReportKind, string> = {
  police: '#0a84ff',
  camera: '#5e5ce6',
  accident: '#ff3b30',
  roadworks: '#ff9f0a',
  closure: '#ff3b30',
  hazard: '#ffcc00',
  vehicle: '#8e8e93',
}

/** Each kind's glyph, on a 24-unit square (filled, even-odd). */
export const REPORT_GLYPHS: Record<ReportKind, string> = {
  police:
    'M12 2.5 4.5 5.5v5.5c0 4.6 3.2 8.7 7.5 10.5 4.3-1.8 7.5-5.9 7.5-10.5V5.5Zm0 5 1.4 2.9 3.1.4-2.3 2.2.6 3.1-2.8-1.5-2.8 1.5.6-3.1-2.3-2.2 3.1-.4Z',
  camera: 'M4 7.5h3.2L9 5.5h6l1.8 2H20v11H4Zm8 2.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Z',
  accident:
    'M12 2.5l2 5.5 5.5-2.5-2.5 5.5 5.5 2-5.5 2 2.5 5.5-5.5-2.5-2 5.5-2-5.5-5.5 2.5 2.5-5.5-5.5-2 5.5-2-2.5-5.5L10 8Z',
  roadworks: 'M10.2 3h3.6l1.1 4H9.1Zm-1.6 6h6.8l1.1 4H7.5Zm-1.6 6h10l1.4 4.5H5.6ZM3.5 19.5h17V21h-17Z',
  closure: 'M5 10.5h14v3H5Z',
  hazard: 'M12 3 22 20.5H2Zm-1.2 6v6h2.4V9Zm0 7.5v2.2h2.4v-2.2Z',
  vehicle:
    'M6.5 6h11l2.5 6v6.5h-2.5V20h-2.5v-1.5H9V20H6.5v-1.5H4V12Zm1.6 2-1.4 3.5h10.6L15.9 8ZM7 13.5a1.3 1.3 0 1 0 0 2.6 1.3 1.3 0 0 0 0-2.6Zm10 0a1.3 1.3 0 1 0 0 2.6 1.3 1.3 0 0 0 0-2.6Z',
}

/** The badge's size on the map, CSS pixels (at its nearest: style.ts shrinks it as the map zooms out). Large,
 * to be seen at a glance from the driver's seat. */
export const REPORT_ICON_SIZE = 60

/** `report-<kind>`'s kind, or `null` for another image's name. */
export function parseReportIcon(id: string): ReportKind | null {
  const kind = id.startsWith('report-') ? id.slice('report-'.length) : ''
  return (REPORT_KINDS as readonly string[]).includes(kind) ? (kind as ReportKind) : null
}

/** A kind's badge, at `pixelRatio`. */
export function drawReportIcon(kind: ReportKind, pixelRatio: number): ImageData {
  const size = Math.round(REPORT_ICON_SIZE * pixelRatio)
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const context = canvas.getContext('2d')
  if (!context) return new ImageData(size, size)
  const centre = size / 2
  context.shadowColor = 'rgba(0, 0, 0, 0.35)'
  context.shadowBlur = 3 * pixelRatio
  context.shadowOffsetY = 1 * pixelRatio
  context.beginPath()
  context.arc(centre, centre, centre - 3 * pixelRatio, 0, Math.PI * 2)
  context.fillStyle = '#ffffff'
  context.fill()
  context.shadowColor = 'transparent'
  context.beginPath()
  context.arc(centre, centre, centre - 5 * pixelRatio, 0, Math.PI * 2)
  context.fillStyle = REPORT_COLOURS[kind]
  context.fill()
  const glyph = size * 0.56
  context.translate(centre - glyph / 2, centre - glyph / 2)
  context.scale(glyph / 24, glyph / 24)
  context.fillStyle = kind === 'hazard' ? '#1c1c1e' : '#ffffff'
  context.fill(new Path2D(REPORT_GLYPHS[kind]), 'evenodd')
  return context.getImageData(0, 0, size, size)
}
