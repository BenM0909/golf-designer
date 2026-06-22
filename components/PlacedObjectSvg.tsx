import type { PlacedObject } from '@/types/drawing'
import { OBJECT_COLORS } from '@/types/drawing'

interface Props {
  obj: PlacedObject
  isHovered?: boolean
  isSelected?: boolean
  toolMode: string
  onPointerEnter?: () => void
  onPointerLeave?: () => void
  onClick?: (e: React.MouseEvent) => void
  onPointerDown?: (e: React.PointerEvent) => void
}

export default function PlacedObjectSvg({
  obj, isHovered, isSelected, toolMode,
  onPointerEnter, onPointerLeave, onClick, onPointerDown,
}: Props) {
  const color = OBJECT_COLORS[obj.objectType]
  const opacity = isHovered && toolMode === 'erase' ? 0.35 : 1
  const cursor = toolMode === 'erase' ? 'not-allowed' : toolMode === 'select' ? 'move' : 'default'

  const transform = `rotate(${obj.rotation}, ${obj.x}, ${obj.y})`

  return (
    <g
      transform={transform}
      opacity={opacity}
      style={{ cursor }}
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
      onClick={onClick}
      onPointerDown={onPointerDown}
    >
      {obj.objectType === 'teebox' ? (
        <>
          <rect
            x={obj.x - obj.width / 2}
            y={obj.y - obj.height / 2}
            width={obj.width}
            height={obj.height}
            rx={4}
            fill={color}
            stroke={isSelected ? '#2563eb' : '#8a6a3a'}
            strokeWidth={isSelected ? 2 : 1}
          />
          {/* T label */}
          <text
            x={obj.x} y={obj.y + 4}
            textAnchor="middle" fontSize={11} fontWeight="bold"
            fill="white" fontFamily="sans-serif" pointerEvents="none"
          >T</text>
        </>
      ) : (
        /* Pin: circle + flag */
        <>
          <circle
            cx={obj.x} cy={obj.y} r={obj.width / 2}
            fill={color}
            stroke={isSelected ? '#2563eb' : '#9b2c2c'}
            strokeWidth={isSelected ? 2 : 1}
          />
          {/* Flag pole + pennant */}
          <line
            x1={obj.x} y1={obj.y - obj.height / 2}
            x2={obj.x} y2={obj.y - obj.height / 2 - 16}
            stroke="white" strokeWidth={1.5}
          />
          <polygon
            points={`${obj.x},${obj.y - obj.height / 2 - 16} ${obj.x + 8},${obj.y - obj.height / 2 - 12} ${obj.x},${obj.y - obj.height / 2 - 8}`}
            fill="white"
          />
        </>
      )}
    </g>
  )
}
