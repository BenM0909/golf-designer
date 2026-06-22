'use client'

import { useCallback, useRef, useState } from 'react'
import type { Point, Shape } from '@/types/drawing'
import { pointsToSvgPath, shouldCloseShape } from '@/lib/smoothing'

// How far apart pointer events need to be (px) before we record a new point.
// Prevents storing duplicate points during slow mouse movement.
const MIN_DISTANCE_PX = 3

function distance(a: Point, b: Point): number {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2)
}

export default function DrawingCanvas() {
  const [shapes, setShapes] = useState<Shape[]>([])
  const [currentPoints, setCurrentPoints] = useState<Point[]>([])
  const isDrawing = useRef(false)
  const svgRef = useRef<SVGSVGElement>(null)

  const getCanvasPoint = useCallback((e: React.PointerEvent): Point => {
    const rect = svgRef.current!.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }, [])

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault()
      ;(e.target as Element).setPointerCapture(e.pointerId)
      isDrawing.current = true
      const pt = getCanvasPoint(e)
      setCurrentPoints([pt])
    },
    [getCanvasPoint],
  )

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!isDrawing.current) return
      e.preventDefault()
      const pt = getCanvasPoint(e)
      setCurrentPoints((prev) => {
        if (prev.length > 0 && distance(prev[prev.length - 1], pt) < MIN_DISTANCE_PX) {
          return prev
        }
        return [...prev, pt]
      })
    },
    [getCanvasPoint],
  )

  const finalizeStroke = useCallback((points: Point[]) => {
    if (points.length < 2) return

    const isClosed = shouldCloseShape(points)
    // When closing, append the starting point so perfect-freehand loops back cleanly.
    const strokePoints = isClosed ? [...points, points[0]] : points
    const svgPath = pointsToSvgPath(strokePoints)

    const shape: Shape = {
      id: crypto.randomUUID(),
      rawPoints: points,
      svgPath,
      isClosed,
    }

    setShapes((prev) => [...prev, shape])
  }, [])

  const handlePointerUp = useCallback(
    (e: React.PointerEvent) => {
      if (!isDrawing.current) return
      isDrawing.current = false
      setCurrentPoints((pts) => {
        finalizeStroke(pts)
        return []
      })
    },
    [finalizeStroke],
  )

  // Live preview path while drawing
  const previewPath = currentPoints.length > 1 ? pointsToSvgPath(currentPoints) : ''

  return (
    <div className="flex flex-col h-screen bg-stone-50 select-none">
      {/* Toolbar */}
      <header className="flex items-center gap-2 px-4 py-2 bg-white border-b border-stone-200 shrink-0">
        <span className="text-sm font-semibold text-stone-400 tracking-wide uppercase mr-3">
          Golf Designer
        </span>
        <button
          onClick={() => setShapes((s) => s.slice(0, -1))}
          disabled={shapes.length === 0}
          className="px-3 py-1.5 text-sm rounded-md border border-stone-300 text-stone-700 bg-white hover:bg-stone-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          Undo
        </button>
        <button
          onClick={() => setShapes([])}
          disabled={shapes.length === 0}
          className="px-3 py-1.5 text-sm rounded-md border border-stone-300 text-stone-700 bg-white hover:bg-stone-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          Clear
        </button>
        <span className="ml-auto text-xs text-stone-400">
          {shapes.length} shape{shapes.length !== 1 ? 's' : ''}
          {' · '}Draw to sketch · Close loop to auto-seal
        </span>
      </header>

      {/* SVG canvas */}
      <svg
        ref={svgRef}
        className="flex-1 w-full cursor-crosshair touch-none"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerUp}
      >
        {/* Finished shapes */}
        {shapes.map((shape) => (
          <path key={shape.id} d={shape.svgPath} fill="#1e293b" stroke="none" />
        ))}

        {/* Live preview while drawing */}
        {previewPath && (
          <path d={previewPath} fill="#475569" stroke="none" opacity={0.6} />
        )}
      </svg>
    </div>
  )
}
