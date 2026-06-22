import type { HoleMetadata, Shape, PlacedObject } from '@/types/drawing'
import { centroid, dist, pxToYards } from '@/lib/geometry'

interface Props {
  metadata: HoleMetadata
  shapes: Shape[]
  objects: PlacedObject[]
  onChange: (m: HoleMetadata) => void
}

function autoYardage(shapes: Shape[], objects: PlacedObject[]): number | null {
  const tee = objects.find(o => o.objectType === 'teebox')
  if (!tee) return null

  // Prefer centroid of green shape; fall back to pin object
  const greenShape = shapes.find(s => s.fillType === 'green' && s.isClosed)
  const pin = objects.find(o => o.objectType === 'pin')

  let target: { x: number; y: number } | null = null
  if (greenShape) {
    target = centroid(greenShape.rawPoints)
  } else if (pin) {
    target = { x: pin.x, y: pin.y }
  }

  if (!target) return null

  const teeCenter = { x: tee.x, y: tee.y }
  return pxToYards(dist(teeCenter, target))
}

export default function HoleMetaPanel({ metadata, shapes, objects, onChange }: Props) {
  const yardage = autoYardage(shapes, objects)

  return (
    <div className="absolute bottom-4 right-4 bg-white border border-stone-200 rounded-lg shadow-md p-3 w-44 text-sm z-10">
      <div className="text-xs font-semibold text-stone-400 uppercase tracking-wide mb-2">Hole Info</div>

      <label className="flex items-center justify-between mb-1.5">
        <span className="text-stone-600">Hole #</span>
        <input
          type="number" min={1} max={18}
          value={metadata.holeNumber}
          onChange={e => onChange({ ...metadata, holeNumber: Number(e.target.value) })}
          className="w-14 text-right border border-stone-300 rounded px-1 py-0.5 text-sm"
        />
      </label>

      <label className="flex items-center justify-between mb-2">
        <span className="text-stone-600">Par</span>
        <input
          type="number" min={3} max={5}
          value={metadata.par}
          onChange={e => onChange({ ...metadata, par: Number(e.target.value) })}
          className="w-14 text-right border border-stone-300 rounded px-1 py-0.5 text-sm"
        />
      </label>

      <div className="border-t border-stone-100 pt-2">
        <div className="flex items-center justify-between">
          <span className="text-stone-500">Yardage</span>
          <span className="font-semibold text-stone-700">
            {yardage !== null ? `${yardage} yds` : '—'}
          </span>
        </div>
        {yardage === null && (
          <p className="text-[10px] text-stone-400 mt-1 leading-tight">
            Place a Tee Box and Pin (or Green shape) to calculate
          </p>
        )}
      </div>
    </div>
  )
}
