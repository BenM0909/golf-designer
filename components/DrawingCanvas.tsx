'use client'

import { useCallback, useRef, useState } from 'react'
import type { FillType, Point, Shape } from '@/types/drawing'
import { FILL_COLORS, FILL_LABELS } from '@/types/drawing'
import { CLOSE_THRESHOLD_PX, dist, pointsToFilledPath, pointsToStrokePath, shouldCloseShape } from '@/lib/smoothing'
import { PRESETS } from '@/lib/presets'

type ToolMode = 'draw' | 'erase' | 'measure'

const MIN_DISTANCE_PX = 3

// Scale placeholder: 1 px = 1 foot. Replace with real calibration in a future milestone.
const PX_PER_YARD = 3

const FILL_TYPES: FillType[] = ['fairway', 'green', 'rough', 'fescue', 'bunker', 'water', 'none']

function rebuildShape(shape: Shape, newPoints: Point[], closed: boolean): Shape {
  const svgPath = closed ? pointsToFilledPath(newPoints) : pointsToStrokePath(newPoints)
  return { ...shape, rawPoints: newPoints, svgPath, isClosed: closed }
}

export default function DrawingCanvas() {
  const [shapes, setShapes] = useState<Shape[]>([])
  const [currentPoints, setCurrentPoints] = useState<Point[]>([])
  const [activeFill, setActiveFill] = useState<FillType>('fairway')
  const [toolMode, setToolMode] = useState<ToolMode>('draw')
  const [hoverShapeId, setHoverShapeId] = useState<string | null>(null)
  const [measurePoints, setMeasurePoints] = useState<Point[]>([])
  // id of the open shape the current stroke is continuing
  const continuingShapeId = useRef<string | null>(null)
  const isDrawing = useRef(false)
  const svgRef = useRef<SVGSVGElement>(null)

  const getCanvasPoint = useCallback((e: React.PointerEvent): Point => {
    const rect = svgRef.current!.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }, [])

  // ── Draw handlers ──────────────────────────────────────────────────────────

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (toolMode !== 'draw') return
      e.preventDefault()
      ;(e.target as Element).setPointerCapture(e.pointerId)
      isDrawing.current = true
      continuingShapeId.current = null

      const pt = getCanvasPoint(e)

      // Check if this stroke starts near the endpoint of the last open shape.
      setShapes((prev) => {
        const lastOpen = [...prev].reverse().find((s) => !s.isClosed)
        if (lastOpen) {
          const lastPt = lastOpen.rawPoints[lastOpen.rawPoints.length - 1]
          if (dist(pt, lastPt) < CLOSE_THRESHOLD_PX) {
            continuingShapeId.current = lastOpen.id
          }
        }
        return prev
      })

      setCurrentPoints([pt])
    },
    [toolMode, getCanvasPoint],
  )

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!isDrawing.current) return
      e.preventDefault()
      const pt = getCanvasPoint(e)
      setCurrentPoints((prev) => {
        if (prev.length > 0 && dist(prev[prev.length - 1], pt) < MIN_DISTANCE_PX) return prev
        return [...prev, pt]
      })
    },
    [getCanvasPoint],
  )

  const handlePointerUp = useCallback(
    (_e: React.PointerEvent) => {
      if (!isDrawing.current) return
      isDrawing.current = false

      setCurrentPoints((newPts) => {
        if (newPts.length < 2) return []

        const contId = continuingShapeId.current
        continuingShapeId.current = null

        setShapes((prev) => {
          if (contId) {
            // Append to the existing open shape and re-smooth the whole thing.
            const idx = prev.findIndex((s) => s.id === contId)
            if (idx !== -1) {
              const existing = prev[idx]
              const combined = [...existing.rawPoints, ...newPts]
              const closed = shouldCloseShape(combined)
              const updated = rebuildShape(existing, combined, closed)
              if (closed) updated.fillType = activeFill
              const next = [...prev]
              next[idx] = updated
              return next
            }
          }

          // Brand-new shape.
          const closed = shouldCloseShape(newPts)
          const shape: Shape = {
            id: crypto.randomUUID(),
            rawPoints: newPts,
            svgPath: closed ? pointsToFilledPath(newPts) : pointsToStrokePath(newPts),
            isClosed: closed,
            fillType: closed ? activeFill : 'none',
          }
          return [...prev, shape]
        })

        return []
      })
    },
    [activeFill],
  )

  // ── Measure handlers ───────────────────────────────────────────────────────

  const handleMeasureClick = useCallback(
    (e: React.PointerEvent) => {
      if (toolMode !== 'measure') return
      const pt = getCanvasPoint(e)
      setMeasurePoints((prev) => {
        if (prev.length === 0) return [pt]
        if (prev.length === 1) return [prev[0], pt]
        return [pt] // start fresh on third click
      })
    },
    [toolMode, getCanvasPoint],
  )

  // ── Erase handlers ─────────────────────────────────────────────────────────

  const handleEraseClick = useCallback(
    (shapeId: string) => {
      if (toolMode !== 'erase') return
      setShapes((prev) => prev.filter((s) => s.id !== shapeId))
      setHoverShapeId(null)
    },
    [toolMode],
  )

  // ── Fill reassignment ──────────────────────────────────────────────────────

  const handleShapeClick = useCallback(
    (e: React.MouseEvent, shapeId: string) => {
      if (toolMode === 'erase') return // handled by handleEraseClick
      if (toolMode !== 'draw') return
      e.stopPropagation()
      setShapes((prev) =>
        prev.map((s) => (s.id === shapeId && s.isClosed ? { ...s, fillType: activeFill } : s)),
      )
    },
    [toolMode, activeFill],
  )

  // ── Canvas click (measure / clear measure) ────────────────────────────────

  const handleCanvasPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (toolMode === 'measure') {
        handleMeasureClick(e)
        return
      }
      if (toolMode === 'draw') {
        handlePointerDown(e)
      }
    },
    [toolMode, handleMeasureClick, handlePointerDown],
  )

  // ── Derived values ─────────────────────────────────────────────────────────

  const previewPath = currentPoints.length > 1 ? pointsToStrokePath(currentPoints) : ''

  const measureDistance =
    measurePoints.length === 2
      ? Math.round(dist(measurePoints[0], measurePoints[1]) / PX_PER_YARD)
      : null

  const measureMid =
    measurePoints.length === 2
      ? { x: (measurePoints[0].x + measurePoints[1].x) / 2, y: (measurePoints[0].y + measurePoints[1].y) / 2 }
      : null

  // ── Presets ────────────────────────────────────────────────────────────────

  const dropPreset = useCallback(
    (presetId: string) => {
      const preset = PRESETS.find((p) => p.id === presetId)
      if (!preset) return
      const pts = preset.points
      const shape: Shape = {
        id: crypto.randomUUID(),
        rawPoints: pts,
        svgPath: pointsToFilledPath(pts),
        isClosed: true,
        fillType: activeFill,
      }
      setShapes((prev) => [...prev, shape])
    },
    [activeFill],
  )

  // ── Toolbar helpers ────────────────────────────────────────────────────────

  const toolBtn = (mode: ToolMode, label: string) => (
    <button
      onClick={() => { setToolMode(mode); setMeasurePoints([]) }}
      className={`px-3 py-1.5 text-sm rounded-md border transition-colors ${
        toolMode === mode
          ? 'bg-slate-800 text-white border-slate-800'
          : 'border-stone-300 text-stone-700 bg-white hover:bg-stone-50'
      }`}
    >
      {label}
    </button>
  )

  const cursorClass =
    toolMode === 'erase' ? 'cursor-not-allowed' :
    toolMode === 'measure' ? 'cursor-crosshair' :
    'cursor-crosshair'

  return (
    <div className="flex flex-col h-screen bg-stone-50 select-none">
      {/* ── Toolbar ── */}
      <header className="flex flex-wrap items-center gap-2 px-4 py-2 bg-white border-b border-stone-200 shrink-0">
        <span className="text-sm font-semibold text-stone-400 tracking-wide uppercase mr-1">
          Golf Designer
        </span>

        {/* Tool modes */}
        <div className="flex items-center gap-1 border-r border-stone-200 pr-3 mr-1">
          {toolBtn('draw', 'Draw')}
          {toolBtn('erase', 'Erase')}
          {toolBtn('measure', 'Measure')}
        </div>

        {/* Undo / Clear */}
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

        {/* Presets */}
        <div className="flex items-center gap-1 border-l border-stone-200 pl-3 ml-1">
          <span className="text-xs text-stone-400 mr-1">Preset:</span>
          {PRESETS.map((p) => (
            <button
              key={p.id}
              onClick={() => dropPreset(p.id)}
              className="px-2 py-1.5 text-xs rounded-md border border-stone-300 text-stone-700 bg-white hover:bg-stone-50 transition-colors"
            >
              {p.label}
            </button>
          ))}
        </div>

        {/* Fill types */}
        <div className="flex items-center gap-1 border-l border-stone-200 pl-3 ml-1">
          <span className="text-xs text-stone-400 mr-1">Fill:</span>
          {FILL_TYPES.map((ft) => (
            <button
              key={ft}
              title={FILL_LABELS[ft]}
              onClick={() => setActiveFill(ft)}
              className={`w-6 h-6 rounded border-2 transition-all ${
                activeFill === ft ? 'border-slate-800 scale-110' : 'border-transparent hover:border-stone-400'
              }`}
              style={{ backgroundColor: FILL_COLORS[ft] }}
            />
          ))}
          <span className="text-xs text-stone-500 ml-1">{FILL_LABELS[activeFill]}</span>
        </div>

        <span className="ml-auto text-xs text-stone-400 hidden sm:block">
          {shapes.length} shape{shapes.length !== 1 ? 's' : ''}
        </span>
      </header>

      {/* ── SVG Canvas ── */}
      <svg
        ref={svgRef}
        className={`flex-1 w-full touch-none ${cursorClass}`}
        onPointerDown={handleCanvasPointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerUp}
      >
        {/* Finished shapes */}
        {shapes.map((shape) => {
          const isHovered = hoverShapeId === shape.id
          const fill = shape.isClosed ? FILL_COLORS[shape.fillType] : FILL_COLORS['none']
          return (
            <path
              key={shape.id}
              d={shape.svgPath}
              fill={fill}
              stroke="none"
              opacity={isHovered && toolMode === 'erase' ? 0.35 : 1}
              className={toolMode === 'erase' ? 'cursor-not-allowed' : toolMode === 'draw' && shape.isClosed ? 'cursor-pointer' : ''}
              onPointerEnter={() => toolMode === 'erase' && setHoverShapeId(shape.id)}
              onPointerLeave={() => setHoverShapeId(null)}
              onClick={(e) => {
                if (toolMode === 'erase') { e.stopPropagation(); handleEraseClick(shape.id) }
                else handleShapeClick(e, shape.id)
              }}
            />
          )
        })}

        {/* Live draw preview */}
        {previewPath && (
          <path d={previewPath} fill="#475569" stroke="none" opacity={0.5} />
        )}

        {/* Measure line */}
        {measurePoints.length >= 1 && (
          <circle cx={measurePoints[0].x} cy={measurePoints[0].y} r={5} fill="#f59e0b" />
        )}
        {measurePoints.length === 2 && (
          <>
            <line
              x1={measurePoints[0].x} y1={measurePoints[0].y}
              x2={measurePoints[1].x} y2={measurePoints[1].y}
              stroke="#f59e0b" strokeWidth={2} strokeDasharray="6 3"
            />
            <circle cx={measurePoints[1].x} cy={measurePoints[1].y} r={5} fill="#f59e0b" />
            {measureMid && (
              <>
                <rect
                  x={measureMid.x - 28} y={measureMid.y - 12}
                  width={56} height={20} rx={4}
                  fill="white" stroke="#f59e0b" strokeWidth={1}
                />
                <text
                  x={measureMid.x} y={measureMid.y + 4}
                  textAnchor="middle" fontSize={11} fill="#92400e" fontFamily="sans-serif"
                >
                  {measureDistance} yds
                </text>
              </>
            )}
          </>
        )}
      </svg>
    </div>
  )
}
