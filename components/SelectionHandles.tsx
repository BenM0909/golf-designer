import type { BBox } from '@/lib/geometry'

export type ScaleHandle = 'tl' | 'tr' | 'bl' | 'br' | 't' | 'b' | 'l' | 'r'

interface Props {
  bbox: BBox
  onMoveStart: (e: React.PointerEvent) => void
  onScaleStart: (handle: ScaleHandle, e: React.PointerEvent) => void
  onRotateStart: (e: React.PointerEvent) => void
  onDelete: () => void
}

const HANDLE_R = 5
const ROTATE_OFFSET = 22

export default function SelectionHandles({ bbox, onMoveStart, onScaleStart, onRotateStart, onDelete }: Props) {
  const { minX, minY, maxX, maxY } = bbox
  const midX = (minX + maxX) / 2
  const midY = (minY + maxY) / 2

  const corners: [ScaleHandle, number, number, string][] = [
    ['tl', minX, minY, 'nwse-resize'],
    ['tr', maxX, minY, 'nesw-resize'],
    ['bl', minX, maxY, 'nesw-resize'],
    ['br', maxX, maxY, 'nwse-resize'],
  ]

  const edges: [ScaleHandle, number, number, string, number, number][] = [
    ['t',  midX, minY, 'ns-resize', 8, 4],
    ['b',  midX, maxY, 'ns-resize', 8, 4],
    ['l',  minX, midY, 'ew-resize', 4, 8],
    ['r',  maxX, midY, 'ew-resize', 4, 8],
  ]

  const rotateY = minY - ROTATE_OFFSET

  return (
    <g pointerEvents="all">
      {/* Invisible body hit area for move */}
      <rect
        x={minX} y={minY}
        width={maxX - minX} height={maxY - minY}
        fill="transparent"
        style={{ cursor: 'move' }}
        onPointerDown={onMoveStart}
      />

      {/* Bounding box outline */}
      <rect
        x={minX} y={minY}
        width={maxX - minX} height={maxY - minY}
        fill="none"
        stroke="#2563eb"
        strokeWidth={1.5}
        strokeDasharray="5 3"
        pointerEvents="none"
      />

      {/* Rotate connector line */}
      <line x1={midX} y1={minY} x2={midX} y2={rotateY} stroke="#2563eb" strokeWidth={1} pointerEvents="none" />

      {/* Rotate handle */}
      <circle
        cx={midX} cy={rotateY} r={HANDLE_R + 1}
        fill="white" stroke="#2563eb" strokeWidth={1.5}
        style={{ cursor: 'grab' }}
        onPointerDown={onRotateStart}
      />

      {/* Corner scale handles (circles — uniform scale) */}
      {corners.map(([id, x, y, cursor]) => (
        <circle
          key={id}
          cx={x} cy={y} r={HANDLE_R}
          fill="white" stroke="#2563eb" strokeWidth={1.5}
          style={{ cursor }}
          onPointerDown={(e) => { e.stopPropagation(); onScaleStart(id, e) }}
        />
      ))}

      {/* Edge scale handles (rectangles — single-axis stretch) */}
      {edges.map(([id, x, y, cursor, w, h]) => (
        <rect
          key={id}
          x={x - w / 2} y={y - h / 2}
          width={w} height={h}
          fill="white" stroke="#2563eb" strokeWidth={1.5}
          style={{ cursor }}
          onPointerDown={(e) => { e.stopPropagation(); onScaleStart(id, e) }}
        />
      ))}

      {/* Delete button (×) at top-right */}
      <g
        transform={`translate(${maxX + 6}, ${minY - 6})`}
        style={{ cursor: 'pointer' }}
        onClick={(e) => { e.stopPropagation(); onDelete() }}
      >
        <circle cx={0} cy={0} r={8} fill="#ef4444" />
        <text x={0} y={4} textAnchor="middle" fontSize={11} fill="white" fontFamily="sans-serif" pointerEvents="none">×</text>
      </g>
    </g>
  )
}
