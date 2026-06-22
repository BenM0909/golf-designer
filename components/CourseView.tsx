'use client'

import { useCallback, useRef, useState } from 'react'
import type { Hole, CourseLayout } from '@/types/drawing'
import { FILL_COLORS, OBJECT_COLORS } from '@/types/drawing'

interface Props {
  holes: Hole[]
  layout: CourseLayout[]
  onLayoutChange: (layout: CourseLayout[]) => void
}

type Interaction =
  | { type: 'pan';    startPan: {x:number;y:number}; startPtr: {x:number;y:number} }
  | { type: 'move';   holeId: string; startPos: {x:number;y:number}; startPtr: {x:number;y:number} }
  | { type: 'rotate'; holeId: string; startRot: number; pivot: {x:number;y:number}; startAngle: number }

const HANDLE_R = 7
const ROT_OFFSET = 32  // world px above bbox top for rotation handle

function localToWorld(lx: number, ly: number, l: CourseLayout) {
  const rad = l.rotation * Math.PI / 180
  const sx = lx * l.scale, sy = ly * l.scale
  return {
    x: l.x + sx * Math.cos(rad) - sy * Math.sin(rad),
    y: l.y + sx * Math.sin(rad) + sy * Math.cos(rad),
  }
}

function holeBBox(hole: Hole) {
  const xs: number[] = [], ys: number[] = []
  for (const s of hole.shapes) for (const p of s.rawPoints) { xs.push(p.x); ys.push(p.y) }
  for (const o of hole.objects) {
    xs.push(o.x - o.width / 2, o.x + o.width / 2)
    ys.push(o.y - o.height / 2, o.y + o.height / 2)
  }
  if (xs.length === 0) return { minX: 0, minY: 0, maxX: 440, maxY: 440 }
  return { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) }
}

export default function CourseView({ holes, layout, onLayoutChange }: Props) {
  const svgRef = useRef<SVGSVGElement>(null)
  const [pan, setPan] = useState({ x: 80, y: 60 })
  const [livePan, setLivePan] = useState<{x:number;y:number}|null>(null)
  const [selectedId, setSelectedId] = useState<string|null>(null)
  const [ia, setIa] = useState<Interaction|null>(null)
  const [liveL, setLiveL] = useState<CourseLayout|null>(null)

  const svgPt = useCallback((e: React.PointerEvent) => {
    const r = svgRef.current!.getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top }
  }, [])

  const onBgDown = useCallback((e: React.PointerEvent) => {
    if (e.button !== 0) return
    e.stopPropagation()
    ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
    setSelectedId(null)
    setIa({ type: 'pan', startPan: pan, startPtr: svgPt(e) })
  }, [svgPt, pan])

  const onHoleDown = useCallback((e: React.PointerEvent, holeId: string) => {
    if (e.button !== 0) return
    e.stopPropagation()
    ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
    const l = layout.find(lo => lo.holeId === holeId)
    if (!l) return
    setSelectedId(holeId)
    setLiveL({ ...l })
    setIa({ type: 'move', holeId, startPos: { x: l.x, y: l.y }, startPtr: svgPt(e) })
  }, [svgPt, layout])

  const onRotateDown = useCallback((e: React.PointerEvent, holeId: string) => {
    if (e.button !== 0) return
    e.stopPropagation()
    ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
    const cl = liveL?.holeId === holeId ? liveL : layout.find(lo => lo.holeId === holeId)
    if (!cl) return
    const hole = holes.find(h => h.id === holeId)
    if (!hole) return
    const bbox = holeBBox(hole)
    const pivot = localToWorld((bbox.minX + bbox.maxX) / 2, (bbox.minY + bbox.maxY) / 2, cl)
    const curPan = livePan ?? pan
    const ptr = svgPt(e)
    const pWorld = { x: ptr.x - curPan.x, y: ptr.y - curPan.y }
    setLiveL({ ...cl })
    setIa({ type: 'rotate', holeId, startRot: cl.rotation, pivot, startAngle: Math.atan2(pWorld.y - pivot.y, pWorld.x - pivot.x) })
  }, [svgPt, holes, layout, liveL, livePan, pan])

  const onMove = useCallback((e: React.PointerEvent) => {
    if (!ia) return
    const ptr = svgPt(e)
    const curPan = livePan ?? pan

    if (ia.type === 'pan') {
      setLivePan({ x: ia.startPan.x + ptr.x - ia.startPtr.x, y: ia.startPan.y + ptr.y - ia.startPtr.y })
      return
    }

    const base = layout.find(lo => lo.holeId === ia.holeId)
    if (!base) return

    if (ia.type === 'move') {
      setLiveL({ ...base, x: ia.startPos.x + ptr.x - ia.startPtr.x, y: ia.startPos.y + ptr.y - ia.startPtr.y })
    } else if (ia.type === 'rotate') {
      const pw = { x: ptr.x - curPan.x, y: ptr.y - curPan.y }
      const angle = Math.atan2(pw.y - ia.pivot.y, pw.x - ia.pivot.x)
      setLiveL({ ...base, rotation: ia.startRot + (angle - ia.startAngle) * 180 / Math.PI })
    }
  }, [ia, svgPt, layout, livePan, pan])

  const onUp = useCallback(() => {
    if (!ia) return
    if (ia.type === 'pan') {
      if (livePan) { setPan(livePan); setLivePan(null) }
    } else if (liveL) {
      onLayoutChange(layout.map(l => l.holeId === liveL.holeId ? liveL : l))
      setLiveL(null)
    }
    setIa(null)
  }, [ia, livePan, liveL, layout, onLayoutChange])

  const displayPan = livePan ?? pan

  return (
    <div className="flex-1 bg-stone-100 min-h-0 overflow-hidden">
      <svg
        ref={svgRef}
        width="100%"
        height="100%"
        className="touch-none select-none"
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerLeave={onUp}
      >
        <g transform={`translate(${displayPan.x},${displayPan.y})`}>
          {/* Infinite pannable background */}
          <rect
            x={-10000} y={-10000} width={30000} height={30000}
            fill="#e5ede0"
            style={{ cursor: ia?.type === 'pan' ? 'grabbing' : 'grab' }}
            onPointerDown={onBgDown}
          />

          {holes.map(hole => {
            const l = liveL?.holeId === hole.id ? liveL : layout.find(lo => lo.holeId === hole.id)
            if (!l) return null
            const isEmpty = hole.shapes.length === 0 && hole.objects.length === 0
            const isSelected = selectedId === hole.id

            const bbox = holeBBox(hole)
            const bcx = (bbox.minX + bbox.maxX) / 2
            const corners = [
              localToWorld(bbox.minX, bbox.minY, l),
              localToWorld(bbox.maxX, bbox.minY, l),
              localToWorld(bbox.maxX, bbox.maxY, l),
              localToWorld(bbox.minX, bbox.maxY, l),
            ]
            const topCenter = localToWorld(bcx, bbox.minY, l)
            const rotHandle = localToWorld(bcx, bbox.minY - ROT_OFFSET / l.scale, l)

            return (
              <g key={hole.id}>
                {/* Hole content — own transform */}
                <g
                  transform={`translate(${l.x},${l.y}) rotate(${l.rotation}) scale(${l.scale})`}
                  style={{ cursor: ia?.type === 'move' && ia.holeId === hole.id ? 'grabbing' : 'grab' }}
                  onPointerDown={e => onHoleDown(e, hole.id)}
                >
                  {isEmpty && (
                    <rect x={0} y={0} width={440} height={440}
                      fill="rgba(255,255,255,0.3)" rx={8}
                      stroke="#94a3b8" strokeDasharray="8 4" strokeWidth={1.5}
                    />
                  )}
                  {hole.shapes.map(s => (
                    <path key={s.id} d={s.svgPath} fill={FILL_COLORS[s.fillType]} pointerEvents="none" />
                  ))}
                  {hole.objects.map(obj => (
                    <g key={obj.id} transform={`translate(${obj.x},${obj.y}) rotate(${obj.rotation})`} pointerEvents="none">
                      {obj.objectType === 'teebox'
                        ? <rect x={-obj.width/2} y={-obj.height/2} width={obj.width} height={obj.height} fill={OBJECT_COLORS.teebox} rx={3} />
                        : <circle r={obj.width/2} fill={OBJECT_COLORS.pin} />
                      }
                    </g>
                  ))}
                  <text
                    x={isEmpty ? 220 : 0} y={-16}
                    fontSize={13} fontWeight="700" fill="#1e293b" fontFamily="sans-serif"
                    textAnchor={isEmpty ? 'middle' : 'start'}
                    pointerEvents="none"
                  >
                    H{hole.metadata.holeNumber} · Par {hole.metadata.par}
                  </text>
                  {isEmpty && (
                    <text x={220} y={230} fontSize={11} fill="#94a3b8" fontFamily="sans-serif" textAnchor="middle" pointerEvents="none">
                      Draw in the Hole {hole.metadata.holeNumber} tab
                    </text>
                  )}
                </g>

                {/* Selection overlay — world space, outside hole transform */}
                {isSelected && (
                  <g>
                    <polygon
                      points={corners.map(c => `${c.x},${c.y}`).join(' ')}
                      fill="none" stroke="#3b82f6" strokeWidth={1.5} strokeDasharray="5 3"
                      pointerEvents="none"
                    />
                    <line
                      x1={topCenter.x} y1={topCenter.y} x2={rotHandle.x} y2={rotHandle.y}
                      stroke="#3b82f6" strokeWidth={1.5} pointerEvents="none"
                    />
                    {/* Rotation handle */}
                    <circle
                      cx={rotHandle.x} cy={rotHandle.y} r={HANDLE_R}
                      fill="white" stroke="#3b82f6" strokeWidth={2}
                      style={{ cursor: 'crosshair' }}
                      onPointerDown={e => onRotateDown(e, hole.id)}
                    />
                  </g>
                )}
              </g>
            )
          })}
        </g>
      </svg>
    </div>
  )
}
