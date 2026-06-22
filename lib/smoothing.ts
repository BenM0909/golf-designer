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
const CLOSE_THRESHOLD_PX = 40
// Minimum number of raw points before we bother checking for closure.
const MIN_POINTS_TO_CLOSE = 15

// Standard helper to turn the perfect-freehand outline (array of [x,y]) into an SVG path string.
// Uses quadratic beziers for smooth curves between consecutive midpoints.
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

export function pointsToSvgPath(points: Point[]): string {
  const input = points.map((p) => [p.x, p.y])
  const outline = getStroke(input, STROKE_OPTIONS)
  return outlineToSvgPath(outline)
}

export function shouldCloseShape(points: Point[]): boolean {
  if (points.length < MIN_POINTS_TO_CLOSE) return false
  const first = points[0]
  const last = points[points.length - 1]
  const dx = last.x - first.x
  const dy = last.y - first.y
  return Math.sqrt(dx * dx + dy * dy) < CLOSE_THRESHOLD_PX
}
