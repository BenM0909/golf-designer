import getStroke from 'perfect-freehand'
import type { Point } from '@/types/drawing'

// Tune these to change how the drawn stroke looks.
// size: overall stroke width; thinning: how much the stroke tapers at low pressure;
// smoothing: how aggressively the raw points are smoothed.
const STROKE_OPTIONS = {
  size: 12,
  thinning: 0.4,
  smoothing: 0.6,
  streamline: 0.5,
  easing: (t: number) => Math.sin((t * Math.PI) / 2),
  simulatePressure: true,
}

// Threshold (px) within which start and end points are treated as "the same" for auto-closing.
export const CLOSE_THRESHOLD_PX = 40
// Minimum number of raw points before we bother checking for closure or continuation.
const MIN_POINTS_TO_CLOSE = 15

function outlineToSvgPath(outline: number[][]): string {
  if (outline.length < 2) return ''

  const d: (string | number)[] = ['M', outline[0][0], outline[0][1], 'Q']

  for (let i = 0; i < outline.length; i++) {
    const [x0, y0] = outline[i]
    const [x1, y1] = outline[(i + 1) % outline.length]
    d.push(x0, y0, (x0 + x1) / 2, (y0 + y1) / 2)
  }

  d.push('Z')
  return d.join(' ')
}

// Used for live drawing preview — produces a variable-width brush stroke.
export function pointsToStrokePath(points: Point[]): string {
  const input = points.map((p) => [p.x, p.y])
  const outline = getStroke(input, STROKE_OPTIONS)
  return outlineToSvgPath(outline)
}

// Used for finalized closed shapes — produces a smooth filled polygon directly
// from the raw boundary points. Uses midpoint quadratic beziers so the fill
// interior is clean. Intentionally bypasses perfect-freehand (which creates a
// variable-width stroke outline, not a fillable polygon).
export function pointsToFilledPath(points: Point[]): string {
  if (points.length < 3) return ''
  const n = points.length
  // Start at the midpoint between the last and first point so the curve closes smoothly.
  const startMid = { x: (points[n - 1].x + points[0].x) / 2, y: (points[n - 1].y + points[0].y) / 2 }
  const d: (string | number)[] = ['M', startMid.x, startMid.y]
  for (let i = 0; i < n; i++) {
    const cur = points[i]
    const next = points[(i + 1) % n]
    const mid = { x: (cur.x + next.x) / 2, y: (cur.y + next.y) / 2 }
    d.push('Q', cur.x, cur.y, mid.x, mid.y)
  }
  d.push('Z')
  return d.join(' ')
}

// Legacy alias kept so any future callers compile without change.
export const pointsToSvgPath = pointsToStrokePath

export function dist(a: Point, b: Point): number {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2)
}

export function shouldCloseShape(points: Point[]): boolean {
  if (points.length < MIN_POINTS_TO_CLOSE) return false
  return dist(points[0], points[points.length - 1]) < CLOSE_THRESHOLD_PX
}
