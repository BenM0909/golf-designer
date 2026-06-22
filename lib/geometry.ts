import type { Point, Shape, PlacedObject, SnapRef } from '@/types/drawing'

export interface SnapResult {
  point: Point
  ref: SnapRef
}

export interface BBox {
  minX: number; minY: number; maxX: number; maxY: number
}

// Scale placeholder: 3 px = 1 yard. Replace with real calibration in a future milestone.
export const PX_PER_YARD = 3

export function pxToYards(px: number): number {
  return Math.round(px / PX_PER_YARD)
}

export function dist(a: Point, b: Point): number {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2)
}

export function centroid(points: Point[]): Point {
  const n = points.length
  let sx = 0, sy = 0
  for (const p of points) { sx += p.x; sy += p.y }
  return { x: sx / n, y: sy / n }
}

export function bbox(points: Point[]): BBox {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const p of points) {
    if (p.x < minX) minX = p.x
    if (p.y < minY) minY = p.y
    if (p.x > maxX) maxX = p.x
    if (p.y > maxY) maxY = p.y
  }
  return { minX, minY, maxX, maxY }
}

export function shapeBBox(shape: Shape): BBox {
  return bbox(shape.rawPoints)
}

export function objectBBox(obj: PlacedObject): BBox {
  const hw = obj.width / 2, hh = obj.height / 2
  return { minX: obj.x - hw, minY: obj.y - hh, maxX: obj.x + hw, maxY: obj.y + hh }
}

export function translatePoints(points: Point[], dx: number, dy: number): Point[] {
  return points.map(p => ({ x: p.x + dx, y: p.y + dy }))
}

export function scalePoints(points: Point[], cx: number, cy: number, s: number): Point[] {
  return points.map(p => ({ x: cx + (p.x - cx) * s, y: cy + (p.y - cy) * s }))
}

export function rotatePoints(points: Point[], cx: number, cy: number, angleDeg: number): Point[] {
  const rad = (angleDeg * Math.PI) / 180
  const cos = Math.cos(rad), sin = Math.sin(rad)
  return points.map(p => ({
    x: cx + (p.x - cx) * cos - (p.y - cy) * sin,
    y: cy + (p.x - cx) * sin + (p.y - cy) * cos,
  }))
}

// Snap threshold in px
const SNAP_THRESHOLD = 18

// Returns the nearest snappable point and a reference to which entity/vertex it belongs to.
// Returns null if nothing is within the snap threshold.
export function findSnap(
  cursor: Point,
  shapes: Shape[],
  objects: PlacedObject[],
): SnapResult | null {
  let best: SnapResult | null = null
  let bestDist = SNAP_THRESHOLD

  for (const shape of shapes) {
    for (let i = 0; i < shape.rawPoints.length; i++) {
      const p = shape.rawPoints[i]
      const d = dist(cursor, p)
      if (d < bestDist) {
        bestDist = d
        best = { point: p, ref: { entityId: shape.id, entityType: 'shape', vertexIndex: i } }
      }
    }
  }

  // Snap to object centers (vertexIndex 0 = center)
  for (const obj of objects) {
    const center: Point = { x: obj.x, y: obj.y }
    const d = dist(cursor, center)
    if (d < bestDist) {
      bestDist = d
      best = { point: center, ref: { entityId: obj.id, entityType: 'object', vertexIndex: 0 } }
    }
  }

  return best
}
