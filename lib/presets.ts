import type { Point } from '@/types/drawing'

export interface PresetDef {
  id: string
  label: string
  points: Point[]
}

// Traces a semicircle cap. cx/cy is the center, r is radius, from/to are degrees.
// outward=true means the arc bows away from the hole center (for end caps).
function arc(cx: number, cy: number, r: number, fromDeg: number, toDeg: number, steps = 10): Point[] {
  const pts: Point[] = []
  for (let i = 0; i <= steps; i++) {
    const a = (fromDeg + (toDeg - fromDeg) * (i / steps)) * (Math.PI / 180)
    pts.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r })
  }
  return pts
}

// Straight hole: tall rectangle, top cap bows up (negative y), bottom cap bows down.
function straightHole(): Point[] {
  const w = 40, h = 280
  const pts: Point[] = []
  // Left edge top → bottom
  for (let y = 0; y <= h; y += 12) pts.push({ x: -w, y })
  // Bottom cap: center at (0, h), arc from 180° → 0° (goes through 90° where sin=+1 → bows downward)
  pts.push(...arc(0, h, w, 180, 0))
  // Right edge bottom → top
  for (let y = h; y >= 0; y -= 12) pts.push({ x: w, y })
  // Top cap: center at (0, 0), arc from 0° → -180° (bows upward, negative y direction)
  pts.push(...arc(0, 0, w, 0, -180))
  return pts
}

// Dogleg left: shaft goes down then bends 90° to the left.
function doglegLeft(): Point[] {
  const sw = 38  // shaft half-width
  const sh = 180 // shaft height before bend
  const lw = 130 // leg length after bend
  const r  = 60  // bend radius

  const pts: Point[] = []

  // Right edge of shaft, top → bottom
  for (let y = 0; y <= sh; y += 12) pts.push({ x: sw, y })

  // Outer bend (right side of shaft → bottom of leg): 90° arc curving left-and-down
  // Center of outer arc: (sw, sh + r) — arc from 270° (up) to 180° (left)
  pts.push(...arc(sw + r, sh, r + sw, 180, 270))

  // Bottom of leg, left → right (we go left because dogleg bends left)
  for (let x = sw + r; x >= sw + r - lw; x -= 12) pts.push({ x, y: sh + sw })

  // Left cap of leg
  pts.push(...arc(sw + r - lw, sh, sw, 90, 270))

  // Top of leg, left → right back toward the bend
  for (let x = sw + r - lw; x <= sw + r; x += 12) pts.push({ x, y: sh - sw })

  // Inner bend (top of leg → left side of shaft): tight inner corner arc
  pts.push(...arc(sw + r, sh, r - sw, 270, 180, 6))

  // Left edge of shaft, bottom → top
  for (let y = sh; y >= 0; y -= 12) pts.push({ x: -sw, y })

  // Top cap
  pts.push(...arc(0, 0, sw, 180, 360))

  return pts
}

// Mirror dogleg left to get dogleg right.
function doglegRight(): Point[] {
  return doglegLeft().map((p) => ({ x: -p.x, y: p.y }))
}

// Par 3: shorter teardrop — wide rounded green end, narrower tee end.
function par3(): Point[] {
  const pts: Point[] = []
  // Teardrop outline: parametric ellipse with varying radius
  const steps = 60
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * Math.PI * 2
    // rx widens toward the bottom (green end), narrows at top (tee end)
    const rx = 55 + 25 * Math.pow(Math.sin(t / 2), 2)
    const ry = 90
    pts.push({ x: rx * Math.cos(t - Math.PI / 2), y: ry * Math.sin(t - Math.PI / 2) })
  }
  return pts
}

function translate(points: Point[], cx: number, cy: number): Point[] {
  const xs = points.map((p) => p.x)
  const ys = points.map((p) => p.y)
  const minX = Math.min(...xs), maxX = Math.max(...xs)
  const minY = Math.min(...ys), maxY = Math.max(...ys)
  const ox = cx - (minX + maxX) / 2
  const oy = cy - (minY + maxY) / 2
  return points.map((p) => ({ x: p.x + ox, y: p.y + oy }))
}

const CENTER = { x: 400, y: 300 }

export const PRESETS: PresetDef[] = [
  { id: 'straight',    label: 'Straight',  points: translate(straightHole(), CENTER.x, CENTER.y) },
  { id: 'dogleg-left', label: 'Dogleg L',  points: translate(doglegLeft(),   CENTER.x, CENTER.y) },
  { id: 'dogleg-right',label: 'Dogleg R',  points: translate(doglegRight(),  CENTER.x, CENTER.y) },
  { id: 'par3',        label: 'Par 3',     points: translate(par3(),         CENTER.x, CENTER.y) },
]
