'use client'

import { useId, useState } from 'react'
import type { Hole, CourseLayout } from '@/types/drawing'
import DrawingCanvas from '@/components/DrawingCanvas'
import CourseView from '@/components/CourseView'

// ── State shape ────────────────────────────────────────────────────────────────

interface AppState {
  holes: Hole[]
  layout: CourseLayout[]
  activeTab: string | 'course'
}

function makeHole(id: string, holeNumber: number): Hole {
  return { id, metadata: { holeNumber, par: 4 }, shapes: [], objects: [], measurements: [] }
}

function makeLayout(holeId: string, index: number): CourseLayout {
  const col = index % 3
  const row = Math.floor(index / 3)
  return { holeId, x: 60 + col * 680, y: 60 + row * 680, rotation: 0, scale: 1 }
}

// ── Page ───────────────────────────────────────────────────────────────────────

export default function Home() {
  // useId() is stable across server/client renders — safe initial hole ID
  const baseId = useId()
  const initialHoleId = `${baseId}-h1`

  const [state, setState] = useState<AppState>(() => ({
    holes: [makeHole(initialHoleId, 1)],
    layout: [makeLayout(initialHoleId, 0)],
    activeTab: initialHoleId,
  }))

  const { holes, layout, activeTab } = state

  // ── Hole data updaters ─────────────────────────────────────────────────────

  const updateHole = (holeId: string, patch: Partial<Omit<Hole, 'id'>>) =>
    setState(s => ({
      ...s,
      holes: s.holes.map(h => h.id === holeId ? { ...h, ...patch } : h),
    }))

  const addHole = () =>
    setState(s => {
      const id = crypto.randomUUID()
      const n = s.holes.length + 1
      return {
        ...s,
        holes: [...s.holes, makeHole(id, n)],
        layout: [...s.layout, makeLayout(id, s.holes.length)],
        activeTab: id,
      }
    })

  const activeHole = holes.find(h => h.id === activeTab)

  // ── Tab bar class helpers ──────────────────────────────────────────────────

  const tabCls = (active: boolean) =>
    `px-5 py-2.5 text-sm font-medium border-t-2 transition-colors ${
      active
        ? 'border-slate-700 text-slate-800 bg-white'
        : 'border-transparent text-stone-500 bg-stone-100 hover:text-stone-700 hover:bg-stone-50'
    }`

  return (
    <div className="flex flex-col h-screen select-none">
      {/* ── Main content (fills all space above the tab bar) ─────────────────── */}
      <div className="flex-1 flex flex-col min-h-0">
        {activeTab === 'course' ? (
          <CourseView
            holes={holes}
            layout={layout}
            onLayoutChange={l => setState(s => ({ ...s, layout: l }))}
          />
        ) : activeHole ? (
          <DrawingCanvas
            key={activeHole.id}
            shapes={activeHole.shapes}
            objects={activeHole.objects}
            measurements={activeHole.measurements}
            holeMetadata={activeHole.metadata}
            onShapesChange={shapes => updateHole(activeHole.id, { shapes })}
            onObjectsChange={objects => updateHole(activeHole.id, { objects })}
            onMeasurementsChange={measurements => updateHole(activeHole.id, { measurements })}
            onHoleMetadataChange={metadata => updateHole(activeHole.id, { metadata })}
          />
        ) : null}
      </div>

      {/* ── Bottom tab bar ────────────────────────────────────────────────────── */}
      <nav className="flex items-stretch bg-stone-100 border-t border-stone-200 shrink-0 overflow-x-auto">
        {holes.map(h => (
          <button
            key={h.id}
            onClick={() => setState(s => ({ ...s, activeTab: h.id }))}
            className={tabCls(activeTab === h.id)}
          >
            Hole {h.metadata.holeNumber}
          </button>
        ))}
        <button
          onClick={() => setState(s => ({ ...s, activeTab: 'course' }))}
          className={tabCls(activeTab === 'course')}
        >
          Course
        </button>
        <button
          onClick={addHole}
          className="px-4 py-2.5 text-sm text-stone-400 hover:text-stone-600 transition-colors border-t-2 border-transparent"
        >
          + Add Hole
        </button>
      </nav>
    </div>
  )
}
