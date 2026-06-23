'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { EntityType, FillType, HoleMetadata, Measurement, ObjectType, PlacedObject, Point, SnapRef, Shape } from '@/types/drawing'
import { FILL_COLORS, FILL_LABELS, OBJECT_DEFAULTS } from '@/types/drawing'
import { CLOSE_THRESHOLD_PX, dist as smoothDist, pointsToFilledPath, pointsToStrokePath, shouldCloseShape } from '@/lib/smoothing'
import { BBox, dist, findSnap, objectBBox, PX_PER_YARD, pxToYards, rotatePoints, shapeBBox, SnapResult, translatePoints } from '@/lib/geometry'
import PlacedObjectSvg from './PlacedObjectSvg'
import SelectionHandles, { ScaleHandle } from './SelectionHandles'
import HoleMetaPanel from './HoleMetaPanel'

type ToolMode = 'draw' | 'fill' | 'erase' | 'measure' | 'select' | 'place'
type EraseMode = 'shape' | 'pen'

const MIN_DISTANCE_PX = 3
const ERASER_RADIUS = 20
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

function applyScaleToShape(shape: Shape, fx: number, fy: number, sx: number, sy: number): Shape {
  const pts = shape.rawPoints.map(p => ({ x: fx + (p.x - fx) * sx, y: fy + (p.y - fy) * sy }))
  return { ...shape, rawPoints: pts, svgPath: shape.isClosed ? pointsToFilledPath(pts) : pointsToStrokePath(pts) }
}

function applyRotateToShape(shape: Shape, cx: number, cy: number, angleDeg: number): Shape {
  const pts = rotatePoints(shape.rawPoints, cx, cy, angleDeg)
  return { ...shape, rawPoints: pts, svgPath: shape.isClosed ? pointsToFilledPath(pts) : pointsToStrokePath(pts) }
}

// ── Pen-erase helpers ─────────────────────────────────────────────────────────

function ptSegDist(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x, dy = b.y - a.y
  const lenSq = dx * dx + dy * dy
  if (lenSq === 0) return Math.hypot(p.x - a.x, p.y - a.y)
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq))
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy))
}

function isErasedByPath(p: Point, eraserPts: Point[]): boolean {
  for (let i = 0; i < eraserPts.length; i++) {
    const d = i === 0 ? Math.hypot(p.x - eraserPts[0].x, p.y - eraserPts[0].y) : ptSegDist(p, eraserPts[i - 1], eraserPts[i])
    if (d < ERASER_RADIUS) return true
  }
  return false
}

// ── Convex hull (Andrew's monotone chain) ─────────────────────────────────────

function convexHull(pts: Point[]): Point[] {
  if (pts.length < 3) return pts
  const sorted = [...pts].sort((a, b) => a.x !== b.x ? a.x - b.x : a.y - b.y)
  const cross = (o: Point, a: Point, b: Point) =>
    (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x)
  const lower: Point[] = []
  for (const p of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0)
      lower.pop()
    lower.push(p)
  }
  const upper: Point[] = []
  for (let i = sorted.length - 1; i >= 0; i--) {
    const p = sorted[i]
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0)
      upper.pop()
    upper.push(p)
  }
  lower.pop(); upper.pop()
  return [...lower, ...upper]
}

// ── Drag state ─────────────────────────────────────────────────────────────────

interface DragMoveState { kind: 'move'; startPt: Point; entityType: EntityType; entityId: string }
interface DragScaleState { kind: 'scale'; handle: ScaleHandle; startPt: Point; initBbox: BBox; entityType: EntityType; entityId: string }
interface DragRotateState { kind: 'rotate'; startPt: Point; initAngle: number; cx: number; cy: number; entityType: EntityType; entityId: string }
type DragState = DragMoveState | DragScaleState | DragRotateState

// ── Props ──────────────────────────────────────────────────────────────────────

export interface DrawingCanvasProps {
  // Controlled hole data
  shapes: Shape[]
  objects: PlacedObject[]
  measurements: Measurement[]
  holeMetadata: HoleMetadata
  onShapesChange: (shapes: Shape[]) => void
  onObjectsChange: (objects: PlacedObject[]) => void
  onMeasurementsChange: (measurements: Measurement[]) => void
  onHoleMetadataChange: (metadata: HoleMetadata) => void
  // Persistence UI (optional — wired up by page.tsx)
  courseName?: string
  onCourseNameChange?: (name: string) => void
  saveStatus?: 'idle' | 'saving' | 'saved' | 'error'
  onSave?: () => void
  onLoadOpen?: () => void
}

// ── Component ──────────────────────────────────────────────────────────────────

export default function DrawingCanvas({
  shapes, objects, measurements, holeMetadata,
  onShapesChange, onObjectsChange, onMeasurementsChange, onHoleMetadataChange,
  courseName = '', onCourseNameChange,
  saveStatus = 'idle', onSave, onLoadOpen,
}: DrawingCanvasProps) {
  // ── Transient UI state (resets per hole via key prop on parent)
  const [currentPoints, setCurrentPoints] = useState<Point[]>([])
  const [activeFill, setActiveFill] = useState<FillType>('fairway')
  const [toolMode, setToolMode] = useState<ToolMode>('draw')
  const [pendingObjectType, setPendingObjectType] = useState<ObjectType | null>(null)
  const [showMeta, setShowMeta] = useState(false)

  // ── Erase sub-mode
  const [eraseMode, setEraseMode] = useState<EraseMode>('shape')
  const [showEraseMenu, setShowEraseMenu] = useState(false)

  // ── Hover / erase
  const [hoverEntityId, setHoverEntityId] = useState<string | null>(null)
  const [pointerPos, setPointerPos] = useState<Point | null>(null)

  // ── Measure
  const [measureP1, setMeasureP1] = useState<{ point: Point; snap?: SnapRef } | null>(null)
  const [snapResult, setSnapResult] = useState<SnapResult | null>(null)
  const [editingMeasId, setEditingMeasId] = useState<string | null>(null)
  const [editingMeasValue, setEditingMeasValue] = useState('')

  // ── Select / transform
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [selectedType, setSelectedType] = useState<EntityType | null>(null)
  const [liveDelta, setLiveDelta] = useState<{ tx: number; ty: number } | null>(null)
  const [liveScale, setLiveScale] = useState<{ fx: number; fy: number; sx: number; sy: number } | null>(null)
  const [liveRotation, setLiveRotation] = useState<{ cx: number; cy: number; angle: number } | null>(null)

  // ── Group / multi-select (shift+click in select mode)
  const [groupIds, setGroupIds] = useState<string[]>([])

  const dragRef = useRef<DragState | null>(null)
  const isDrawing = useRef(false)
  const continuingShapeId = useRef<string | null>(null)
  const svgRef = useRef<SVGSVGElement>(null)

  // Sync currentPoints to ref so handlePointerUp always reads the latest value
  // without a stale closure (shapes don't change during a stroke, currentPoints do)
  const currentPointsRef = useRef<Point[]>([])
  currentPointsRef.current = currentPoints

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
    onShapesChange(shapes.filter(x => x.id !== selectedId))
    onObjectsChange(objects.filter(x => x.id !== selectedId))
    onMeasurementsChange(measurements.filter(x => x.id !== selectedId))
    clearSelection()
  }, [selectedId, clearSelection, shapes, objects, measurements, onShapesChange, onObjectsChange, onMeasurementsChange])

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
    if (e.shiftKey) { e.stopPropagation(); return }  // let click handler manage group selection
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
      if (drag.entityType === 'shape') onShapesChange(shapes.map(s => s.id === drag.entityId ? applyMoveToShape(s, tx, ty) : s))
      if (drag.entityType === 'object') onObjectsChange(objects.map(o => o.id === drag.entityId ? { ...o, x: o.x + tx, y: o.y + ty } : o))
      if (drag.entityType === 'measurement') onMeasurementsChange(measurements.map(m => m.id === drag.entityId ? { ...m, p1: { x: m.p1.x + tx, y: m.p1.y + ty }, p2: { x: m.p2.x + tx, y: m.p2.y + ty } } : m))
      setLiveDelta(null)
    }

    if (drag.kind === 'scale' && liveScale) {
      const { fx, fy, sx, sy } = liveScale
      if (drag.entityType === 'shape') onShapesChange(shapes.map(sh => sh.id === drag.entityId ? applyScaleToShape(sh, fx, fy, sx, sy) : sh))
      if (drag.entityType === 'object') onObjectsChange(objects.map(o => {
        if (o.id !== drag.entityId) return o
        return { ...o, x: fx + (o.x - fx) * sx, y: fy + (o.y - fy) * sy, width: o.width * sx, height: o.height * sy }
      }))
      if (drag.entityType === 'measurement') onMeasurementsChange(measurements.map(m => m.id === drag.entityId ? { ...m, p1: { x: fx + (m.p1.x - fx) * sx, y: fy + (m.p1.y - fy) * sy }, p2: { x: fx + (m.p2.x - fx) * sx, y: fy + (m.p2.y - fy) * sy } } : m))
      setLiveScale(null)
    }

    if (drag.kind === 'rotate' && liveRotation) {
      const { cx, cy, angle } = liveRotation
      if (drag.entityType === 'shape') onShapesChange(shapes.map(sh => sh.id === drag.entityId ? applyRotateToShape(sh, cx, cy, angle) : sh))
      if (drag.entityType === 'object') onObjectsChange(objects.map(o => o.id === drag.entityId ? { ...o, rotation: o.rotation + angle } : o))
      if (drag.entityType === 'measurement') {
        onMeasurementsChange(measurements.map(m => {
          if (m.id !== drag.entityId) return m
          const [p1, p2] = rotatePoints([m.p1, m.p2], cx, cy, angle)
          return { ...m, p1, p2 }
        }))
      }
      setLiveRotation(null)
    }
  }, [liveDelta, liveScale, liveRotation, shapes, objects, measurements, onShapesChange, onObjectsChange, onMeasurementsChange])

  // ── Global pointer move & up ───────────────────────────────────────────────

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    const pt = getCanvasPoint(e)

    if (toolMode === 'erase' && eraseMode === 'pen') setPointerPos(pt)

    if (dragRef.current) {
      const drag = dragRef.current
      if (drag.kind === 'move') {
        setLiveDelta({ tx: pt.x - drag.startPt.x, ty: pt.y - drag.startPt.y })
        return
      }
      if (drag.kind === 'scale') {
        const { handle, initBbox } = drag
        const bw = initBbox.maxX - initBbox.minX
        const bh = initBbox.maxY - initBbox.minY
        let fx: number, fy: number, sx: number, sy: number
        if (handle === 'r') {
          fx = initBbox.minX; fy = (initBbox.minY + initBbox.maxY) / 2
          sx = bw > 0 ? (pt.x - fx) / bw : 1; sy = 1
        } else if (handle === 'l') {
          fx = initBbox.maxX; fy = (initBbox.minY + initBbox.maxY) / 2
          sx = bw > 0 ? (fx - pt.x) / bw : 1; sy = 1
        } else if (handle === 'b') {
          fx = (initBbox.minX + initBbox.maxX) / 2; fy = initBbox.minY
          sx = 1; sy = bh > 0 ? (pt.y - fy) / bh : 1
        } else if (handle === 't') {
          fx = (initBbox.minX + initBbox.maxX) / 2; fy = initBbox.maxY
          sx = 1; sy = bh > 0 ? (fy - pt.y) / bh : 1
        } else {
          fx = handle === 'tl' || handle === 'bl' ? initBbox.maxX : initBbox.minX
          fy = handle === 'tl' || handle === 'tr' ? initBbox.maxY : initBbox.minY
          const origDist = dist(drag.startPt, { x: fx, y: fy })
          const newDist = dist(pt, { x: fx, y: fy })
          const s = origDist > 0 ? newDist / origDist : 1
          sx = s; sy = s
        }
        setLiveScale({ fx, fy, sx, sy })
        return
      }
      if (drag.kind === 'rotate') {
        const { cx, cy, initAngle } = drag
        const angle = Math.atan2(pt.y - cy, pt.x - cx) * (180 / Math.PI) - initAngle
        setLiveRotation({ cx, cy, angle })
        return
      }
    }

    if (isDrawing.current && toolMode === 'erase' && eraseMode === 'pen') {
      e.preventDefault()
      const lastPt = currentPointsRef.current[currentPointsRef.current.length - 1] ?? pt
      const nextShapes = shapes
        .map(shape => {
          const remaining = shape.rawPoints.filter(p => ptSegDist(p, lastPt, pt) >= ERASER_RADIUS)
          if (remaining.length < 2) return null
          return rebuildShape(shape, remaining, shape.isClosed)
        })
        .filter((s): s is Shape => s !== null)
      onShapesChange(nextShapes)
      setCurrentPoints(prev => {
        if (prev.length > 0 && smoothDist(prev[prev.length - 1], pt) < MIN_DISTANCE_PX) return prev
        return [...prev, pt]
      })
      return
    }

    if (isDrawing.current) {
      e.preventDefault()
      setCurrentPoints(prev => {
        if (prev.length > 0 && smoothDist(prev[prev.length - 1], pt) < MIN_DISTANCE_PX) return prev
        return [...prev, pt]
      })
      return
    }

    if (toolMode === 'measure') {
      setSnapResult(findSnap(pt, shapes, objects))
    }
  }, [getCanvasPoint, toolMode, eraseMode, shapes, objects, onShapesChange])

  const handlePointerUp = useCallback((_e: React.PointerEvent) => {
    setPointerPos(null)

    if (dragRef.current) {
      bakeTransform()
      return
    }

    if (!isDrawing.current) return
    isDrawing.current = false

    const pts = currentPointsRef.current
    setCurrentPoints([])

    if (toolMode === 'erase' && eraseMode === 'pen') {
      return
    }

    if (pts.length < 2) return
    const contId = continuingShapeId.current
    continuingShapeId.current = null

    if (contId) {
      const idx = shapes.findIndex(s => s.id === contId)
      if (idx !== -1) {
        const existing = shapes[idx]
        const combined = [...existing.rawPoints, ...pts]
        const closed = shouldCloseShape(combined)
        const updated = rebuildShape(existing, combined, closed)
        const next = [...shapes]; next[idx] = updated
        onShapesChange(next)
        return
      }
    }
    const closed = shouldCloseShape(pts)
    onShapesChange([...shapes, {
      id: crypto.randomUUID(), rawPoints: pts,
      svgPath: closed ? pointsToFilledPath(pts) : pointsToStrokePath(pts),
      isClosed: closed, fillType: activeFill,
    }])
  }, [bakeTransform, toolMode, eraseMode, shapes, onShapesChange])

  // ── Canvas pointer down ────────────────────────────────────────────────────

  const handleCanvasPointerDown = useCallback((e: React.PointerEvent) => {
    const pt = getCanvasPoint(e)

    if (toolMode === 'place' && pendingObjectType) {
      e.stopPropagation()
      const defaults = OBJECT_DEFAULTS[pendingObjectType]
      onObjectsChange([...objects, { id: crypto.randomUUID(), objectType: pendingObjectType, x: pt.x, y: pt.y, rotation: 0, ...defaults }])
      setPendingObjectType(null); setToolMode('draw')
      return
    }

    if (toolMode === 'select') {
      clearSelection()
      setGroupIds([])
      return
    }

    if (toolMode === 'measure') {
      const effective = snapResult?.point ?? pt
      if (!measureP1) {
        setMeasureP1({ point: effective, snap: snapResult?.ref })
      } else {
        const m: Measurement = {
          id: crypto.randomUUID(),
          p1: measureP1.point, p2: effective,
          customYards: null,
          p1Snap: measureP1.snap,
          p2Snap: snapResult?.ref,
        }
        onMeasurementsChange([...measurements, m])
        setMeasureP1(null); setSnapResult(null)
      }
      return
    }

    if (toolMode === 'draw') {
      e.preventDefault()
      ;(e.target as Element).setPointerCapture(e.pointerId)
      isDrawing.current = true
      continuingShapeId.current = null

      const lastOpen = [...shapes].reverse().find(s => !s.isClosed)
      if (lastOpen) {
        const lastPt = lastOpen.rawPoints[lastOpen.rawPoints.length - 1]
        if (smoothDist(pt, lastPt) < CLOSE_THRESHOLD_PX) continuingShapeId.current = lastOpen.id
      }
      setCurrentPoints([pt])
    }

    if (toolMode === 'erase' && eraseMode === 'pen') {
      e.preventDefault()
      ;(e.target as Element).setPointerCapture(e.pointerId)
      isDrawing.current = true
      setCurrentPoints([pt])
    }
  }, [toolMode, eraseMode, pendingObjectType, snapResult, measureP1, getCanvasPoint, clearSelection, shapes, objects, measurements, onObjectsChange, onMeasurementsChange])

  // ── Erase ──────────────────────────────────────────────────────────────────

  const eraseEntity = useCallback((id: string, type: EntityType, e: React.MouseEvent) => {
    if (toolMode !== 'erase') return
    e.stopPropagation()
    if (type === 'shape') onShapesChange(shapes.filter(s => s.id !== id))
    if (type === 'object') onObjectsChange(objects.filter(o => o.id !== id))
    if (type === 'measurement') onMeasurementsChange(measurements.filter(m => m.id !== id))
    setHoverEntityId(null)
  }, [toolMode, shapes, objects, measurements, onShapesChange, onObjectsChange, onMeasurementsChange])

  // ── Click on shape ─────────────────────────────────────────────────────────

  const handleShapeClick = useCallback((e: React.MouseEvent, shapeId: string) => {
    if (toolMode === 'erase') return
    if (toolMode === 'select') {
      e.stopPropagation()
      if (e.shiftKey) {
        setGroupIds(prev => prev.includes(shapeId) ? prev.filter(id => id !== shapeId) : [...prev, shapeId])
        return
      }
      setSelectedId(shapeId); setSelectedType('shape')
      return
    }
    if (toolMode === 'fill') { e.stopPropagation(); onShapesChange(shapes.map(s => s.id === shapeId && s.isClosed ? { ...s, fillType: activeFill } : s)) }
  }, [toolMode, activeFill, shapes, onShapesChange])

  // ── Join grouped shapes into one ──────────────────────────────────────────

  const joinShapes = useCallback(() => {
    if (groupIds.length < 2) return
    const toJoin = groupIds.map(id => shapes.find(s => s.id === id)).filter(Boolean) as Shape[]
    if (toJoin.length < 2) return

    const fillType = (toJoin.find(s => s.isClosed)?.fillType) ?? activeFill
    const allPoints = toJoin.flatMap(s => s.rawPoints)

    // Subsample then take the convex hull so the joined shape fills the full
    // enclosing region without spikes from angle-sort on dense overlapping points.
    const step = Math.max(1, Math.floor(allPoints.length / 300))
    const sampled = allPoints.filter((_, i) => i % step === 0)
    const boundary = convexHull(sampled)

    const joined: Shape = {
      id: crypto.randomUUID(),
      rawPoints: boundary,
      svgPath: pointsToFilledPath(boundary),
      isClosed: true,
      fillType,
    }
    onShapesChange([...shapes.filter(s => !groupIds.includes(s.id)), joined])
    setGroupIds([])
    clearSelection()
  }, [groupIds, shapes, activeFill, onShapesChange, clearSelection])

  // ── Measurement editing ────────────────────────────────────────────────────

  const commitMeasurementEdit = useCallback(() => {
    const yards = parseFloat(editingMeasValue)
    if (!isNaN(yards) && yards > 0) {
      let updatedShapes = shapes
      const updatedMeasurements = measurements.map(m => {
        if (m.id !== editingMeasId) return m
        const dx = m.p2.x - m.p1.x, dy = m.p2.y - m.p1.y
        const origLen = Math.sqrt(dx * dx + dy * dy)
        if (origLen === 0) return { ...m, customYards: yards }
        const newPxLen = yards * PX_PER_YARD
        const scale = newPxLen / origLen
        const newP2 = { x: m.p1.x + dx * scale, y: m.p1.y + dy * scale }

        if (m.p2Snap?.entityType === 'shape') {
          const { entityId } = m.p2Snap
          const ax = m.p1.x, ay = m.p1.y
          updatedShapes = updatedShapes.map(s => {
            if (s.id !== entityId) return s
            const pts = s.rawPoints.map(p => ({
              x: ax + (p.x - ax) * scale,
              y: ay + (p.y - ay) * scale,
            }))
            return rebuildShape(s, pts, s.isClosed)
          })
        }

        return { ...m, p2: newP2, customYards: yards }
      })
      onShapesChange(updatedShapes)
      onMeasurementsChange(updatedMeasurements)
    }
    setEditingMeasId(null); setEditingMeasValue('')
  }, [editingMeasId, editingMeasValue, shapes, measurements, onShapesChange, onMeasurementsChange])

  // ── Live transform string ──────────────────────────────────────────────────

  const liveTransformAttr = useCallback((entityId: string): string => {
    if (entityId !== selectedId) return ''
    if (liveDelta) return `translate(${liveDelta.tx}, ${liveDelta.ty})`
    if (liveScale) return `translate(${liveScale.fx}, ${liveScale.fy}) scale(${liveScale.sx}, ${liveScale.sy}) translate(${-liveScale.fx}, ${-liveScale.fy})`
    if (liveRotation) return `rotate(${liveRotation.angle}, ${liveRotation.cx}, ${liveRotation.cy})`
    return ''
  }, [selectedId, liveDelta, liveScale, liveRotation])

  const currentBbox = selectedBbox()
  const previewPath = currentPoints.length > 1 ? pointsToStrokePath(currentPoints) : ''

  // ── Toolbar helpers ────────────────────────────────────────────────────────

  const toolBtnClass = (active: boolean) =>
    `px-3 py-1.5 text-sm rounded-md border transition-colors ${active ? 'bg-slate-800 text-white border-slate-800' : 'border-stone-300 text-stone-700 bg-white hover:bg-stone-50'}`

  const setTool = (mode: ToolMode) => {
    setToolMode(mode); setMeasureP1(null); setSnapResult(null)
    if (mode !== 'select') { clearSelection(); setGroupIds([]) }
    if (mode !== 'place') setPendingObjectType(null)
  }

  const armObject = (type: ObjectType) => {
    setPendingObjectType(type); setToolMode('place')
    setMeasureP1(null); clearSelection()
  }

  const cursorClass = toolMode === 'erase' && eraseMode === 'pen' ? 'cursor-none' : toolMode === 'erase' ? 'cursor-not-allowed' : toolMode === 'place' ? 'cursor-cell' : toolMode === 'fill' ? 'cursor-pointer' : 'cursor-crosshair'

  return (
    <div className="flex flex-col flex-1 bg-stone-50 select-none relative min-h-0">
      {/* ── Toolbar ─────────────────────────────────────────────────────────── */}
      <header className="flex flex-wrap items-center gap-2 px-4 py-2 bg-white border-b border-stone-200 shrink-0 z-20">
        <span className="text-sm font-semibold text-stone-400 tracking-wide uppercase mr-1">Golf Designer</span>

        {/* Tool modes */}
        <div className="flex items-center gap-1 border-r border-stone-200 pr-3 mr-1">
          <button onClick={() => setTool('draw')} className={toolBtnClass(toolMode === 'draw')}>Draw</button>
          <button onClick={() => setTool('fill')} className={toolBtnClass(toolMode === 'fill')}>Fill</button>
          <button onClick={() => setTool('select')} className={toolBtnClass(toolMode === 'select')}>Select</button>
          <div className="relative"
            onMouseEnter={() => setShowEraseMenu(true)}
            onMouseLeave={() => setShowEraseMenu(false)}
          >
            <button onClick={() => setTool('erase')} className={toolBtnClass(toolMode === 'erase')}>
              {eraseMode === 'pen' ? 'Pen Erase ▾' : 'Erase ▾'}
            </button>
            {showEraseMenu && (
              <div className="absolute top-full left-0 mt-0.5 bg-white border border-stone-200 rounded-md shadow-lg z-50 overflow-hidden min-w-[120px]">
                <button
                  onClick={() => { setEraseMode('shape'); setTool('erase') }}
                  className={`block w-full text-left px-3 py-2 text-sm hover:bg-stone-50 ${eraseMode === 'shape' ? 'font-semibold' : ''}`}
                >Erase Shape</button>
                <button
                  onClick={() => { setEraseMode('pen'); setTool('erase') }}
                  className={`block w-full text-left px-3 py-2 text-sm hover:bg-stone-50 ${eraseMode === 'pen' ? 'font-semibold' : ''}`}
                >Pen Erase</button>
              </div>
            )}
          </div>
          <button onClick={() => setTool('measure')} className={toolBtnClass(toolMode === 'measure')}>Measure</button>
        </div>

        {/* Undo / Clear */}
        <button onClick={() => onShapesChange(shapes.slice(0, -1))} disabled={shapes.length === 0}
          className="px-3 py-1.5 text-sm rounded-md border border-stone-300 text-stone-700 bg-white hover:bg-stone-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">Undo</button>
        <button onClick={() => { onShapesChange([]); onObjectsChange([]); onMeasurementsChange([]); clearSelection() }} disabled={shapes.length === 0 && objects.length === 0 && measurements.length === 0}
          className="px-3 py-1.5 text-sm rounded-md border border-stone-300 text-stone-700 bg-white hover:bg-stone-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">Clear</button>

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

        {/* Save / Load — shown only when wired up by parent */}
        {(onSave || onLoadOpen) && (
          <div className="flex items-center gap-1 border-l border-stone-200 pl-3 ml-1">
            {onCourseNameChange && (
              <input
                value={courseName}
                onChange={e => onCourseNameChange(e.target.value)}
                onPointerDown={e => e.stopPropagation()}
                className="text-xs border border-stone-200 rounded px-2 py-1 w-28 focus:outline-none focus:border-slate-400"
                placeholder="Course name"
              />
            )}
            {onSave && <button onClick={onSave} className={toolBtnClass(false) + ' text-xs'}>Save</button>}
            {onLoadOpen && <button onClick={onLoadOpen} className={toolBtnClass(false) + ' text-xs'}>Load</button>}
            {saveStatus === 'saving' && <span className="text-xs text-stone-400">Saving…</span>}
            {saveStatus === 'saved'  && <span className="text-xs text-green-600">Saved</span>}
            {saveStatus === 'error'  && <span className="text-xs text-red-500">Error</span>}
          </div>
        )}

        {/* Join grouped shapes */}
        {groupIds.length >= 2 && (
          <button onClick={joinShapes} className="px-3 py-1.5 text-sm rounded-md border transition-colors bg-blue-600 text-white border-blue-600 hover:bg-blue-700">
            Join ({groupIds.length})
          </button>
        )}

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
        onPointerLeave={e => { handlePointerUp(e); setPointerPos(null) }}
      >
        {/* Shapes */}
        {shapes.map(shape => {
          const isHovered = hoverEntityId === shape.id && toolMode === 'erase'
          const isGrouped = groupIds.includes(shape.id)
          const fill = shape.isClosed ? FILL_COLORS[shape.fillType] : FILL_COLORS['none']
          const xf = liveTransformAttr(shape.id)
          // Split compound paths (joined shapes) so each subpath fills independently,
          // avoiding winding-direction cancellation between overlapping regions.
          const subPaths = shape.svgPath.split(/(?=M )/).filter(Boolean)
          return (
            <g
              key={shape.id}
              transform={xf || undefined}
              opacity={isHovered ? 0.35 : 1}
              style={{ cursor: toolMode === 'erase' ? 'not-allowed' : toolMode === 'select' ? 'move' : toolMode === 'fill' && shape.isClosed ? 'pointer' : 'default' }}
              onPointerEnter={() => (toolMode === 'erase' && eraseMode === 'shape' || toolMode === 'select' || toolMode === 'fill') && setHoverEntityId(shape.id)}
              onPointerLeave={() => setHoverEntityId(null)}
              onPointerDown={e => toolMode === 'select' && handleMoveStart(e, 'shape', shape.id)}
              onClick={e => {
                if (toolMode === 'erase' && eraseMode === 'shape') return eraseEntity(shape.id, 'shape', e)
                if (toolMode === 'erase') return
                handleShapeClick(e, shape.id)
              }}
            >
              {subPaths.map((d, i) => (
                <path
                  key={i}
                  d={d}
                  fill={fill}
                  stroke={isGrouped ? '#2563eb' : 'none'}
                  strokeWidth={isGrouped ? 2 : 0}
                  strokeDasharray={isGrouped ? '6 3' : undefined}
                />
              ))}
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
                onClick={e => {
                  if (toolMode === 'erase' && eraseMode === 'shape') return eraseEntity(obj.id, 'object', e)
                  if (toolMode === 'erase') return
                  if (toolMode === 'select') { e.stopPropagation(); setSelectedId(obj.id); setSelectedType('object') }
                }}
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
              onPointerDown={e => {
                if (toolMode === 'select') handleMoveStart(e, 'measurement', m.id)
                else e.stopPropagation()
              }}
              onClick={e => {
                if (toolMode === 'erase' && eraseMode === 'shape') { eraseEntity(m.id, 'measurement', e); return }
                if (toolMode === 'erase') return
                if (toolMode === 'select') { e.stopPropagation(); setSelectedId(m.id); setSelectedType('measurement'); return }
                e.stopPropagation()
                setEditingMeasId(m.id); setEditingMeasValue(String(yds))
              }}
            >
              <line x1={m.p1.x} y1={m.p1.y} x2={m.p2.x} y2={m.p2.y}
                stroke={isSelected ? '#2563eb' : '#f59e0b'} strokeWidth={2} strokeDasharray="6 3" />
              <circle cx={m.p1.x} cy={m.p1.y} r={5} fill={isSelected ? '#2563eb' : '#f59e0b'} />
              <circle cx={m.p2.x} cy={m.p2.y} r={5} fill={isSelected ? '#2563eb' : '#f59e0b'} />
              {/* Invisible wide hit area */}
              <line x1={m.p1.x} y1={m.p1.y} x2={m.p2.x} y2={m.p2.y} stroke="transparent" strokeWidth={14} />
              {editingMeasId === m.id ? (
                <foreignObject x={mid.x - 32} y={mid.y - 14} width={64} height={28}>
                  <input
                    autoFocus
                    value={editingMeasValue}
                    onChange={e => setEditingMeasValue(e.target.value)}
                    onBlur={commitMeasurementEdit}
                    onKeyDown={e => { if (e.key === 'Enter') commitMeasurementEdit(); if (e.key === 'Escape') { setEditingMeasId(null) } }}
                    className="w-full h-full text-center text-xs border border-amber-400 rounded px-1 bg-white"
                    onPointerDown={e => e.stopPropagation()}
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
        {toolMode === 'draw' && previewPath && <path d={previewPath} fill="#475569" stroke="none" opacity={0.5} />}

        {/* Pen eraser stroke preview */}
        {toolMode === 'erase' && eraseMode === 'pen' && currentPoints.length > 1 && (
          <path
            d={pointsToStrokePath(currentPoints)}
            fill="none"
            stroke="rgba(148,163,184,0.45)"
            strokeWidth={ERASER_RADIUS * 2}
            strokeLinecap="round"
            strokeLinejoin="round"
            pointerEvents="none"
          />
        )}

        {/* Pen eraser cursor circle */}
        {toolMode === 'erase' && eraseMode === 'pen' && pointerPos && (
          <circle
            cx={pointerPos.x} cy={pointerPos.y} r={ERASER_RADIUS}
            fill="rgba(255,255,255,0.5)" stroke="#94a3b8" strokeWidth={1.5}
            pointerEvents="none"
          />
        )}

        {/* Measure in-progress */}
        {toolMode === 'measure' && measureP1 && (
          <circle cx={measureP1.point.x} cy={measureP1.point.y} r={5} fill="#f59e0b" pointerEvents="none" />
        )}

        {/* Snap indicator */}
        {toolMode === 'measure' && snapResult && (
          <circle cx={snapResult.point.x} cy={snapResult.point.y} r={8} fill="none" stroke="#2563eb" strokeWidth={2} pointerEvents="none" />
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
          onChange={onHoleMetadataChange}
        />
      )}
    </div>
  )
}
