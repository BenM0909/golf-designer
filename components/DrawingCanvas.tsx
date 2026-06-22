'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { EntityType, FillType, HoleMetadata, Measurement, ObjectType, PlacedObject, Point, Shape } from '@/types/drawing'
import { FILL_COLORS, FILL_LABELS, OBJECT_DEFAULTS } from '@/types/drawing'
import { CLOSE_THRESHOLD_PX, dist as smoothDist, pointsToFilledPath, pointsToStrokePath, shouldCloseShape } from '@/lib/smoothing'
import { bbox, BBox, centroid, dist, objectBBox, pxToYards, rotatePoints, scalePoints, shapeBBox, snapToNearestVertex, translatePoints } from '@/lib/geometry'
import { PRESETS } from '@/lib/presets'
import PlacedObjectSvg from './PlacedObjectSvg'
import SelectionHandles, { ScaleHandle } from './SelectionHandles'
import HoleMetaPanel from './HoleMetaPanel'

type ToolMode = 'draw' | 'erase' | 'measure' | 'select' | 'place'

const MIN_DISTANCE_PX = 3
const FILL_TYPES: FillType[] = ['fairway', 'green', 'rough', 'fescue', 'bunker', 'water', 'none']

// ── Shape helpers ──────────────────────────────────────────────────────────────

function rebuildShape(shape: Shape, pts: Point[], closed: boolean): Shape {
  return { ...shape, rawPoints: pts, isClosed: closed, svgPath: closed ? pointsToFilledPath(pts) : pointsToStrokePath(pts) }
}

// ── Transform baking ───────────────────────────────────────────────────────────

function applyMoveToShape(shape: Shape, dx: number, dy: number): Shape {
  const pts = translatePoints(shape.rawPoints, dx, dy)
  return { ...shape, rawPoints: pts, svgPath: shape.isClosed ? pointsToFilledPath(pts) : pointsToStrokePath(pts) }
}

function applyScaleToShape(shape: Shape, fx: number, fy: number, s: number): Shape {
  const pts = scalePoints(shape.rawPoints, fx, fy, s)
  return { ...shape, rawPoints: pts, svgPath: shape.isClosed ? pointsToFilledPath(pts) : pointsToStrokePath(pts) }
}

function applyRotateToShape(shape: Shape, cx: number, cy: number, angleDeg: number): Shape {
  const pts = rotatePoints(shape.rawPoints, cx, cy, angleDeg)
  return { ...shape, rawPoints: pts, svgPath: shape.isClosed ? pointsToFilledPath(pts) : pointsToStrokePath(pts) }
}

// ── Drag state ─────────────────────────────────────────────────────────────────

interface DragMoveState { kind: 'move'; startPt: Point; entityType: EntityType; entityId: string }
interface DragScaleState { kind: 'scale'; handle: ScaleHandle; startPt: Point; initBbox: BBox; entityType: EntityType; entityId: string }
interface DragRotateState { kind: 'rotate'; startPt: Point; initAngle: number; cx: number; cy: number; entityType: EntityType; entityId: string }
type DragState = DragMoveState | DragScaleState | DragRotateState

// ── Component ──────────────────────────────────────────────────────────────────

export default function DrawingCanvas() {
  // ── Core state
  const [shapes, setShapes] = useState<Shape[]>([])
  const [objects, setObjects] = useState<PlacedObject[]>([])
  const [measurements, setMeasurements] = useState<Measurement[]>([])
  const [currentPoints, setCurrentPoints] = useState<Point[]>([])
  const [activeFill, setActiveFill] = useState<FillType>('fairway')
  const [toolMode, setToolMode] = useState<ToolMode>('draw')
  const [pendingObjectType, setPendingObjectType] = useState<ObjectType | null>(null)
  const [holeMetadata, setHoleMetadata] = useState<HoleMetadata>({ holeNumber: 1, par: 4 })
  const [showMeta, setShowMeta] = useState(false)

  // ── Hover / erase
  const [hoverEntityId, setHoverEntityId] = useState<string | null>(null)

  // ── Measure
  const [measureP1, setMeasureP1] = useState<Point | null>(null)
  const [snapPoint, setSnapPoint] = useState<Point | null>(null)
  const [editingMeasId, setEditingMeasId] = useState<string | null>(null)
  const [editingMeasValue, setEditingMeasValue] = useState('')

  // ── Select / transform
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [selectedType, setSelectedType] = useState<EntityType | null>(null)
  const [liveDelta, setLiveDelta] = useState<{ tx: number; ty: number } | null>(null)
  const [liveScale, setLiveScale] = useState<{ fx: number; fy: number; s: number } | null>(null)
  const [liveRotation, setLiveRotation] = useState<{ cx: number; cy: number; angle: number } | null>(null)

  const dragRef = useRef<DragState | null>(null)
  const isDrawing = useRef(false)
  const continuingShapeId = useRef<string | null>(null)
  const svgRef = useRef<SVGSVGElement>(null)

  // ── Utilities ──────────────────────────────────────────────────────────────

  const getCanvasPoint = useCallback((e: React.PointerEvent | React.MouseEvent): Point => {
    const rect = svgRef.current!.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }, [])

  const clearSelection = useCallback(() => {
    setSelectedId(null); setSelectedType(null)
    setLiveDelta(null); setLiveScale(null); setLiveRotation(null)
  }, [])

  const deleteSelected = useCallback(() => {
    if (!selectedId) return
    setShapes(s => s.filter(x => x.id !== selectedId))
    setObjects(o => o.filter(x => x.id !== selectedId))
    setMeasurements(m => m.filter(x => x.id !== selectedId))
    clearSelection()
  }, [selectedId, clearSelection])

  // Delete key while something is selected
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId && document.activeElement?.tagName !== 'INPUT') {
        e.preventDefault()
        deleteSelected()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [selectedId, deleteSelected])

  // ── Selected entity bounding box ───────────────────────────────────────────

  const selectedBbox = useCallback((): BBox | null => {
    if (!selectedId || !selectedType) return null
    if (selectedType === 'shape') {
      const s = shapes.find(x => x.id === selectedId)
      return s ? shapeBBox(s) : null
    }
    if (selectedType === 'object') {
      const o = objects.find(x => x.id === selectedId)
      return o ? objectBBox(o) : null
    }
    if (selectedType === 'measurement') {
      const m = measurements.find(x => x.id === selectedId)
      if (!m) return null
      return { minX: Math.min(m.p1.x, m.p2.x), minY: Math.min(m.p1.y, m.p2.y), maxX: Math.max(m.p1.x, m.p2.x), maxY: Math.max(m.p1.y, m.p2.y) }
    }
    return null
  }, [selectedId, selectedType, shapes, objects, measurements])

  // ── Transform handlers ─────────────────────────────────────────────────────

  const handleMoveStart = useCallback((e: React.PointerEvent, entityType: EntityType, entityId: string) => {
    if (toolMode !== 'select') return
    e.stopPropagation()
    ;(e.target as Element).setPointerCapture(e.pointerId)
    const startPt = getCanvasPoint(e)
    dragRef.current = { kind: 'move', startPt, entityType, entityId }
    setSelectedId(entityId); setSelectedType(entityType)
  }, [toolMode, getCanvasPoint])

  const handleScaleStart = useCallback((handle: ScaleHandle, e: React.PointerEvent) => {
    if (toolMode !== 'select' || !selectedId || !selectedType) return
    e.stopPropagation()
    ;(e.target as Element).setPointerCapture(e.pointerId)
    const bb = selectedBbox()
    if (!bb) return
    const startPt = getCanvasPoint(e)
    dragRef.current = { kind: 'scale', handle, startPt, initBbox: bb, entityType: selectedType, entityId: selectedId }
  }, [toolMode, selectedId, selectedType, selectedBbox, getCanvasPoint])

  const handleRotateStart = useCallback((e: React.PointerEvent) => {
    if (toolMode !== 'select' || !selectedId || !selectedType) return
    e.stopPropagation()
    ;(e.target as Element).setPointerCapture(e.pointerId)
    const bb = selectedBbox()
    if (!bb) return
    const cx = (bb.minX + bb.maxX) / 2, cy = (bb.minY + bb.maxY) / 2
    const startPt = getCanvasPoint(e)
    const initAngle = Math.atan2(startPt.y - cy, startPt.x - cx) * (180 / Math.PI)
    dragRef.current = { kind: 'rotate', startPt, initAngle, cx, cy, entityType: selectedType, entityId: selectedId }
  }, [toolMode, selectedId, selectedType, selectedBbox, getCanvasPoint])

  const bakeTransform = useCallback(() => {
    const drag = dragRef.current
    if (!drag) return
    dragRef.current = null

    if (drag.kind === 'move' && liveDelta) {
      const { tx, ty } = liveDelta
      if (drag.entityType === 'shape') setShapes(prev => prev.map(s => s.id === drag.entityId ? applyMoveToShape(s, tx, ty) : s))
      if (drag.entityType === 'object') setObjects(prev => prev.map(o => o.id === drag.entityId ? { ...o, x: o.x + tx, y: o.y + ty } : o))
      if (drag.entityType === 'measurement') setMeasurements(prev => prev.map(m => m.id === drag.entityId ? { ...m, p1: { x: m.p1.x + tx, y: m.p1.y + ty }, p2: { x: m.p2.x + tx, y: m.p2.y + ty } } : m))
      setLiveDelta(null)
    }

    if (drag.kind === 'scale' && liveScale) {
      const { fx, fy, s } = liveScale
      if (drag.entityType === 'shape') setShapes(prev => prev.map(sh => sh.id === drag.entityId ? applyScaleToShape(sh, fx, fy, s) : sh))
      if (drag.entityType === 'object') setObjects(prev => prev.map(o => {
        if (o.id !== drag.entityId) return o
        const newCx = fx + (o.x - fx) * s, newCy = fy + (o.y - fy) * s
        return { ...o, x: newCx, y: newCy, width: o.width * s, height: o.height * s }
      }))
      if (drag.entityType === 'measurement') setMeasurements(prev => prev.map(m => m.id === drag.entityId ? { ...m, p1: { x: fx + (m.p1.x - fx) * s, y: fy + (m.p1.y - fy) * s }, p2: { x: fx + (m.p2.x - fx) * s, y: fy + (m.p2.y - fy) * s } } : m))
      setLiveScale(null)
    }

    if (drag.kind === 'rotate' && liveRotation) {
      const { cx, cy, angle } = liveRotation
      if (drag.entityType === 'shape') setShapes(prev => prev.map(sh => sh.id === drag.entityId ? applyRotateToShape(sh, cx, cy, angle) : sh))
      if (drag.entityType === 'object') setObjects(prev => prev.map(o => o.id === drag.entityId ? { ...o, rotation: o.rotation + angle } : o))
      if (drag.entityType === 'measurement') {
        setMeasurements(prev => prev.map(m => {
          if (m.id !== drag.entityId) return m
          const [p1, p2] = rotatePoints([m.p1, m.p2], cx, cy, angle)
          return { ...m, p1, p2 }
        }))
      }
      setLiveRotation(null)
    }
  }, [liveDelta, liveScale, liveRotation])

  // ── Global pointer move & up (handles drawing + transform dragging) ────────

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    const pt = getCanvasPoint(e)

    // Transform drag
    if (dragRef.current) {
      const drag = dragRef.current
      if (drag.kind === 'move') {
        setLiveDelta({ tx: pt.x - drag.startPt.x, ty: pt.y - drag.startPt.y })
        return
      }
      if (drag.kind === 'scale') {
        const { handle, initBbox } = drag
        // Fixed corner is the opposite of the dragged corner
        const fx = handle === 'tl' || handle === 'bl' ? initBbox.maxX : initBbox.minX
        const fy = handle === 'tl' || handle === 'tr' ? initBbox.maxY : initBbox.minY
        const origDist = dist({ x: drag.startPt.x, y: drag.startPt.y }, { x: fx, y: fy })
        const newDist = dist(pt, { x: fx, y: fy })
        const s = origDist > 0 ? newDist / origDist : 1
        setLiveScale({ fx, fy, s })
        return
      }
      if (drag.kind === 'rotate') {
        const { cx, cy, initAngle } = drag
        const angle = Math.atan2(pt.y - cy, pt.x - cx) * (180 / Math.PI) - initAngle
        setLiveRotation({ cx, cy, angle })
        return
      }
    }

    // Drawing stroke
    if (isDrawing.current) {
      e.preventDefault()
      setCurrentPoints(prev => {
        if (prev.length > 0 && smoothDist(prev[prev.length - 1], pt) < MIN_DISTANCE_PX) return prev
        return [...prev, pt]
      })
      return
    }

    // Measure snap preview
    if (toolMode === 'measure') {
      const snapped = snapToNearestVertex(pt, shapes, objects)
      setSnapPoint(snapped)
    }
  }, [getCanvasPoint, toolMode, shapes, objects])

  const handlePointerUp = useCallback((e: React.PointerEvent) => {
    // Bake a transform drag
    if (dragRef.current) {
      bakeTransform()
      return
    }

    // Finalize a drawing stroke
    if (!isDrawing.current) return
    isDrawing.current = false

    setCurrentPoints(newPts => {
      if (newPts.length < 2) return []
      const contId = continuingShapeId.current
      continuingShapeId.current = null

      setShapes(prev => {
        if (contId) {
          const idx = prev.findIndex(s => s.id === contId)
          if (idx !== -1) {
            const existing = prev[idx]
            const combined = [...existing.rawPoints, ...newPts]
            const closed = shouldCloseShape(combined)
            const updated = rebuildShape(existing, combined, closed)
            if (closed) updated.fillType = activeFill
            const next = [...prev]; next[idx] = updated; return next
          }
        }
        const closed = shouldCloseShape(newPts)
        return [...prev, {
          id: crypto.randomUUID(), rawPoints: newPts,
          svgPath: closed ? pointsToFilledPath(newPts) : pointsToStrokePath(newPts),
          isClosed: closed, fillType: closed ? activeFill : 'none',
        }]
      })
      return []
    })
  }, [bakeTransform, activeFill])

  // ── Canvas pointer down (dispatch by tool mode) ───────────────────────────

  const handleCanvasPointerDown = useCallback((e: React.PointerEvent) => {
    const pt = getCanvasPoint(e)

    if (toolMode === 'place' && pendingObjectType) {
      e.stopPropagation()
      const defaults = OBJECT_DEFAULTS[pendingObjectType]
      setObjects(prev => [...prev, { id: crypto.randomUUID(), objectType: pendingObjectType, x: pt.x, y: pt.y, rotation: 0, ...defaults }])
      setPendingObjectType(null); setToolMode('draw')
      return
    }

    if (toolMode === 'select') {
      clearSelection()
      return
    }

    if (toolMode === 'measure') {
      const effective = snapPoint ?? pt
      if (!measureP1) {
        setMeasureP1(effective)
      } else {
        const m: Measurement = { id: crypto.randomUUID(), p1: measureP1, p2: effective, customYards: null }
        setMeasurements(prev => [...prev, m])
        setMeasureP1(null); setSnapPoint(null)
      }
      return
    }

    if (toolMode === 'draw') {
      e.preventDefault()
      ;(e.target as Element).setPointerCapture(e.pointerId)
      isDrawing.current = true
      continuingShapeId.current = null

      setShapes(prev => {
        const lastOpen = [...prev].reverse().find(s => !s.isClosed)
        if (lastOpen) {
          const lastPt = lastOpen.rawPoints[lastOpen.rawPoints.length - 1]
          if (smoothDist(pt, lastPt) < CLOSE_THRESHOLD_PX) continuingShapeId.current = lastOpen.id
        }
        return prev
      })
      setCurrentPoints([pt])
    }
  }, [toolMode, pendingObjectType, snapPoint, measureP1, getCanvasPoint, clearSelection])

  // ── Erase ──────────────────────────────────────────────────────────────────

  const eraseEntity = useCallback((id: string, type: EntityType, e: React.MouseEvent) => {
    if (toolMode !== 'erase') return
    e.stopPropagation()
    if (type === 'shape') setShapes(prev => prev.filter(s => s.id !== id))
    if (type === 'object') setObjects(prev => prev.filter(o => o.id !== id))
    if (type === 'measurement') setMeasurements(prev => prev.filter(m => m.id !== id))
    setHoverEntityId(null)
  }, [toolMode])

  // ── Click on shape (select or fill-reassign) ───────────────────────────────

  const handleShapeClick = useCallback((e: React.MouseEvent, shapeId: string) => {
    if (toolMode === 'erase') return
    if (toolMode === 'select') { e.stopPropagation(); setSelectedId(shapeId); setSelectedType('shape'); return }
    if (toolMode === 'draw') { e.stopPropagation(); setShapes(prev => prev.map(s => s.id === shapeId && s.isClosed ? { ...s, fillType: activeFill } : s)) }
  }, [toolMode, activeFill])

  // ── Measurement editing ────────────────────────────────────────────────────

  const commitMeasurementEdit = useCallback(() => {
    const yards = parseFloat(editingMeasValue)
    if (!isNaN(yards) && yards > 0) {
      setMeasurements(prev => prev.map(m => {
        if (m.id !== editingMeasId) return m
        // Move p2 along the direction p1→p2 to match new distance
        const dx = m.p2.x - m.p1.x, dy = m.p2.y - m.p1.y
        const origLen = Math.sqrt(dx * dx + dy * dy)
        if (origLen === 0) return { ...m, customYards: yards }
        const newPxLen = yards * 3 // PX_PER_YARD
        const scale = newPxLen / origLen
        const newP2 = { x: m.p1.x + dx * scale, y: m.p1.y + dy * scale }
        return { ...m, p2: newP2, customYards: yards }
      }))
    }
    setEditingMeasId(null); setEditingMeasValue('')
  }, [editingMeasId, editingMeasValue])

  // ── Preset drop ────────────────────────────────────────────────────────────

  const dropPreset = useCallback((presetId: string) => {
    const preset = PRESETS.find(p => p.id === presetId)
    if (!preset) return
    const pts = preset.points
    setShapes(prev => [...prev, { id: crypto.randomUUID(), rawPoints: pts, svgPath: pointsToFilledPath(pts), isClosed: true, fillType: activeFill }])
  }, [activeFill])

  // ── Live transform string for the selected entity ─────────────────────────

  const liveTransformAttr = useCallback((entityId: string): string => {
    if (entityId !== selectedId) return ''
    if (liveDelta) return `translate(${liveDelta.tx}, ${liveDelta.ty})`
    if (liveScale) return `translate(${liveScale.fx}, ${liveScale.fy}) scale(${liveScale.s}) translate(${-liveScale.fx}, ${-liveScale.fy})`
    if (liveRotation) return `rotate(${liveRotation.angle}, ${liveRotation.cx}, ${liveRotation.cy})`
    return ''
  }, [selectedId, liveDelta, liveScale, liveRotation])

  // ── Computed bbox for selection handles ────────────────────────────────────

  const currentBbox = selectedBbox()

  // ── Preview paths ──────────────────────────────────────────────────────────

  const previewPath = currentPoints.length > 1 ? pointsToStrokePath(currentPoints) : ''

  // ── Toolbar helpers ────────────────────────────────────────────────────────

  const toolActive = (mode: ToolMode) =>
    mode === 'place'
      ? toolMode === 'place'
      : toolMode === mode

  const toolBtnClass = (active: boolean) =>
    `px-3 py-1.5 text-sm rounded-md border transition-colors ${active ? 'bg-slate-800 text-white border-slate-800' : 'border-stone-300 text-stone-700 bg-white hover:bg-stone-50'}`

  const setTool = (mode: ToolMode) => {
    setToolMode(mode); setMeasureP1(null); setSnapPoint(null)
    if (mode !== 'select') clearSelection()
    if (mode !== 'place') setPendingObjectType(null)
  }

  const armObject = (type: ObjectType) => {
    setPendingObjectType(type); setToolMode('place')
    setMeasureP1(null); clearSelection()
  }

  const cursorClass = toolMode === 'erase' ? 'cursor-not-allowed' : toolMode === 'place' ? 'cursor-cell' : 'cursor-crosshair'

  return (
    <div className="flex flex-col h-screen bg-stone-50 select-none relative">
      {/* ── Toolbar ─────────────────────────────────────────────────────────── */}
      <header className="flex flex-wrap items-center gap-2 px-4 py-2 bg-white border-b border-stone-200 shrink-0 z-20">
        <span className="text-sm font-semibold text-stone-400 tracking-wide uppercase mr-1">Golf Designer</span>

        {/* Tool modes */}
        <div className="flex items-center gap-1 border-r border-stone-200 pr-3 mr-1">
          <button onClick={() => setTool('draw')} className={toolBtnClass(toolMode === 'draw')}>Draw</button>
          <button onClick={() => setTool('select')} className={toolBtnClass(toolMode === 'select')}>Select</button>
          <button onClick={() => setTool('erase')} className={toolBtnClass(toolMode === 'erase')}>Erase</button>
          <button onClick={() => setTool('measure')} className={toolBtnClass(toolMode === 'measure')}>Measure</button>
        </div>

        {/* Undo / Clear */}
        <button onClick={() => setShapes(s => s.slice(0, -1))} disabled={shapes.length === 0}
          className="px-3 py-1.5 text-sm rounded-md border border-stone-300 text-stone-700 bg-white hover:bg-stone-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">Undo</button>
        <button onClick={() => { setShapes([]); setObjects([]); setMeasurements([]); clearSelection() }} disabled={shapes.length === 0 && objects.length === 0 && measurements.length === 0}
          className="px-3 py-1.5 text-sm rounded-md border border-stone-300 text-stone-700 bg-white hover:bg-stone-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">Clear</button>

        {/* Hole outline presets */}
        <div className="flex items-center gap-1 border-l border-stone-200 pl-3 ml-1">
          <span className="text-xs text-stone-400 mr-1">Hole:</span>
          {PRESETS.map(p => (
            <button key={p.id} onClick={() => dropPreset(p.id)}
              className="px-2 py-1.5 text-xs rounded-md border border-stone-300 text-stone-700 bg-white hover:bg-stone-50 transition-colors">{p.label}</button>
          ))}
        </div>

        {/* Placeable objects */}
        <div className="flex items-center gap-1 border-l border-stone-200 pl-3 ml-1">
          <span className="text-xs text-stone-400 mr-1">Objects:</span>
          <button
            onClick={() => armObject('teebox')}
            className={toolBtnClass(toolMode === 'place' && pendingObjectType === 'teebox') + ' text-xs px-2'}
          >Tee Box</button>
          <button
            onClick={() => armObject('pin')}
            className={toolBtnClass(toolMode === 'place' && pendingObjectType === 'pin') + ' text-xs px-2'}
          >Pin</button>
        </div>

        {/* Fill types */}
        <div className="flex items-center gap-1 border-l border-stone-200 pl-3 ml-1">
          <span className="text-xs text-stone-400 mr-1">Fill:</span>
          {FILL_TYPES.map(ft => (
            <button key={ft} title={FILL_LABELS[ft]} onClick={() => setActiveFill(ft)}
              className={`w-6 h-6 rounded border-2 transition-all ${activeFill === ft ? 'border-slate-800 scale-110' : 'border-transparent hover:border-stone-400'}`}
              style={{ backgroundColor: FILL_COLORS[ft] }} />
          ))}
          <span className="text-xs text-stone-500 ml-1">{FILL_LABELS[activeFill]}</span>
        </div>

        {/* Hole info toggle */}
        <button onClick={() => setShowMeta(v => !v)}
          className={toolBtnClass(showMeta) + ' ml-auto text-xs'}>Hole Info</button>
      </header>

      {/* ── SVG Canvas ──────────────────────────────────────────────────────── */}
      <svg
        ref={svgRef}
        className={`flex-1 w-full touch-none ${cursorClass}`}
        onPointerDown={handleCanvasPointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerUp}
      >
        {/* Outline shapes */}
        {shapes.map(shape => {
          const isHovered = hoverEntityId === shape.id && toolMode === 'erase'
          const fill = shape.isClosed ? FILL_COLORS[shape.fillType] : FILL_COLORS['none']
          const xf = liveTransformAttr(shape.id)
          return (
            <g key={shape.id} transform={xf || undefined}>
              <path
                d={shape.svgPath}
                fill={fill}
                stroke={selectedId === shape.id && toolMode === 'select' ? 'none' : 'none'}
                opacity={isHovered ? 0.35 : 1}
                style={{ cursor: toolMode === 'erase' ? 'not-allowed' : toolMode === 'select' ? 'move' : shape.isClosed ? 'pointer' : 'default' }}
                onPointerEnter={() => (toolMode === 'erase' || toolMode === 'select') && setHoverEntityId(shape.id)}
                onPointerLeave={() => setHoverEntityId(null)}
                onPointerDown={e => toolMode === 'select' && handleMoveStart(e, 'shape', shape.id)}
                onClick={e => toolMode === 'erase' ? eraseEntity(shape.id, 'shape', e) : handleShapeClick(e, shape.id)}
              />
            </g>
          )
        })}

        {/* Placed objects */}
        {objects.map(obj => {
          const xf = liveTransformAttr(obj.id)
          return (
            <g key={obj.id} transform={xf || undefined}>
              <PlacedObjectSvg
                obj={obj}
                isHovered={hoverEntityId === obj.id}
                isSelected={selectedId === obj.id}
                toolMode={toolMode}
                onPointerEnter={() => (toolMode === 'erase' || toolMode === 'select') && setHoverEntityId(obj.id)}
                onPointerLeave={() => setHoverEntityId(null)}
                onPointerDown={e => toolMode === 'select' && handleMoveStart(e, 'object', obj.id)}
                onClick={e => toolMode === 'erase' ? eraseEntity(obj.id, 'object', e) : (toolMode === 'select' && (e.stopPropagation(), setSelectedId(obj.id), setSelectedType('object')))}
              />
            </g>
          )
        })}

        {/* Measurements */}
        {measurements.map(m => {
          const yds = m.customYards ?? pxToYards(dist(m.p1, m.p2))
          const mid = { x: (m.p1.x + m.p2.x) / 2, y: (m.p1.y + m.p2.y) / 2 }
          const isHovered = hoverEntityId === m.id
          const isSelected = selectedId === m.id
          const xf = liveTransformAttr(m.id)
          return (
            <g key={m.id} transform={xf || undefined}
              opacity={isHovered && toolMode === 'erase' ? 0.4 : 1}
              style={{ cursor: toolMode === 'erase' ? 'not-allowed' : toolMode === 'select' ? 'move' : 'default' }}
              onPointerEnter={() => (toolMode === 'erase' || toolMode === 'select') && setHoverEntityId(m.id)}
              onPointerLeave={() => setHoverEntityId(null)}
              onPointerDown={e => toolMode === 'select' && handleMoveStart(e, 'measurement', m.id)}
              onClick={e => {
                if (toolMode === 'erase') { eraseEntity(m.id, 'measurement', e); return }
                if (toolMode === 'select') { e.stopPropagation(); setSelectedId(m.id); setSelectedType('measurement'); return }
                // Click in any other mode → open edit input
                e.stopPropagation()
                setEditingMeasId(m.id); setEditingMeasValue(String(yds))
              }}
            >
              <line x1={m.p1.x} y1={m.p1.y} x2={m.p2.x} y2={m.p2.y}
                stroke={isSelected ? '#2563eb' : '#f59e0b'} strokeWidth={isSelected ? 2 : 2} strokeDasharray="6 3" />
              <circle cx={m.p1.x} cy={m.p1.y} r={5} fill={isSelected ? '#2563eb' : '#f59e0b'} />
              <circle cx={m.p2.x} cy={m.p2.y} r={5} fill={isSelected ? '#2563eb' : '#f59e0b'} />
              {/* Invisible wide hit area */}
              <line x1={m.p1.x} y1={m.p1.y} x2={m.p2.x} y2={m.p2.y} stroke="transparent" strokeWidth={14} />
              {/* Label */}
              {editingMeasId === m.id ? (
                <foreignObject x={mid.x - 32} y={mid.y - 14} width={64} height={28}>
                  <input
                    autoFocus
                    value={editingMeasValue}
                    onChange={e => setEditingMeasValue(e.target.value)}
                    onBlur={commitMeasurementEdit}
                    onKeyDown={e => { if (e.key === 'Enter') commitMeasurementEdit(); if (e.key === 'Escape') { setEditingMeasId(null) } }}
                    className="w-full h-full text-center text-xs border border-amber-400 rounded px-1 bg-white"
                    onClick={e => e.stopPropagation()}
                  />
                </foreignObject>
              ) : (
                <>
                  <rect x={mid.x - 24} y={mid.y - 11} width={48} height={18} rx={4} fill="white" stroke={isSelected ? '#2563eb' : '#f59e0b'} strokeWidth={1} />
                  <text x={mid.x} y={mid.y + 4} textAnchor="middle" fontSize={10} fill={isSelected ? '#1d4ed8' : '#92400e'} fontFamily="sans-serif">{yds} yds</text>
                </>
              )}
            </g>
          )
        })}

        {/* Selection handles */}
        {toolMode === 'select' && selectedId && currentBbox && (
          <SelectionHandles
            bbox={currentBbox}
            onMoveStart={e => { if (selectedId && selectedType) handleMoveStart(e, selectedType, selectedId) }}
            onScaleStart={(handle, e) => handleScaleStart(handle, e)}
            onRotateStart={e => handleRotateStart(e)}
            onDelete={deleteSelected}
          />
        )}

        {/* Live draw preview */}
        {previewPath && <path d={previewPath} fill="#475569" stroke="none" opacity={0.5} />}

        {/* Measure in-progress line */}
        {toolMode === 'measure' && measureP1 && (
          <circle cx={measureP1.x} cy={measureP1.y} r={5} fill="#f59e0b" pointerEvents="none" />
        )}

        {/* Snap indicator */}
        {toolMode === 'measure' && snapPoint && (
          <circle cx={snapPoint.x} cy={snapPoint.y} r={8} fill="none" stroke="#2563eb" strokeWidth={2} pointerEvents="none" />
        )}

        {/* Placement cursor hint */}
        {toolMode === 'place' && (
          <text x={8} y={24} fontSize={12} fill="#64748b" fontFamily="sans-serif" pointerEvents="none">
            Click to place {pendingObjectType === 'teebox' ? 'Tee Box' : 'Pin'} — Esc to cancel
          </text>
        )}
      </svg>

      {/* ── Hole meta panel ──────────────────────────────────────────────────── */}
      {showMeta && (
        <HoleMetaPanel
          metadata={holeMetadata}
          shapes={shapes}
          objects={objects}
          onChange={setHoleMetadata}
        />
      )}
    </div>
  )
}
