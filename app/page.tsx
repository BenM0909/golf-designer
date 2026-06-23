'use client'

import { useEffect, useId, useRef, useState } from 'react'
import type { Hole, CourseLayout } from '@/types/drawing'
import DrawingCanvas from '@/components/DrawingCanvas'
import CourseView from '@/components/CourseView'
import { saveCourse, loadCourse } from '@/lib/courseDb'

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

const STORAGE_KEY = 'golf-designer-course-id'
const AUTOSAVE_DELAY = 1500

// ── Page ───────────────────────────────────────────────────────────────────────

export default function Home() {
  const baseId = useId()
  const initialHoleId = `${baseId}-h1`

  const [state, setState] = useState<AppState>(() => ({
    holes: [makeHole(initialHoleId, 1)],
    layout: [makeLayout(initialHoleId, 0)],
    activeTab: initialHoleId,
  }))

  const [courseId, setCourseId] = useState<string | null>(null)
  const [courseName, setCourseName] = useState('My Course')
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [loading, setLoading] = useState(true)

  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const clearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ── Load on mount ──────────────────────────────────────────────────────────

  useEffect(() => {
    const freshStart = () => {
      const id = crypto.randomUUID()
      const holeId = crypto.randomUUID()
      localStorage.setItem(STORAGE_KEY, id)
      setCourseId(id)
      setState({
        holes: [makeHole(holeId, 1)],
        layout: [makeLayout(holeId, 0)],
        activeTab: holeId,
      })
      setLoading(false)
    }

    const savedId = localStorage.getItem(STORAGE_KEY)
    if (savedId) {
      loadCourse(savedId)
        .then(course => {
          // If layout wasn't persisted, regenerate default positions so holes appear in CourseView
          const layout = course.layout.length > 0
            ? course.layout
            : course.holes.map((h, i) => makeLayout(h.id, i))
          setCourseId(course.id)
          setCourseName(course.name)
          setState({
            holes: course.holes,
            layout,
            activeTab: course.holes[0]?.id ?? 'course',
          })
          setLoading(false)
        })
        .catch(freshStart)
    } else {
      freshStart()
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Auto-save (debounced) ──────────────────────────────────────────────────

  useEffect(() => {
    if (loading || !courseId) return

    setSaveStatus('saving')
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    if (clearTimerRef.current) clearTimeout(clearTimerRef.current)

    saveTimerRef.current = setTimeout(async () => {
      try {
        await saveCourse({
          id: courseId,
          name: courseName,
          holes: state.holes,
          layout: state.layout,
        })
        setSaveStatus('saved')
        clearTimerRef.current = setTimeout(() => setSaveStatus('idle'), 2000)
      } catch (err) {
        console.error('Auto-save failed:', err)
        setSaveStatus('error')
      }
    }, AUTOSAVE_DELAY)

    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    }
  }, [state, courseName, courseId, loading])

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

  const { holes, layout, activeTab } = state
  const activeHole = holes.find(h => h.id === activeTab)

  // ── Tab bar class helpers ──────────────────────────────────────────────────

  const tabCls = (active: boolean) =>
    `px-5 py-2.5 text-sm font-medium border-t-2 transition-colors ${
      active
        ? 'border-slate-700 text-slate-800 bg-white'
        : 'border-transparent text-stone-500 bg-stone-100 hover:text-stone-700 hover:bg-stone-50'
    }`

  // ── Loading overlay ────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-stone-50 text-stone-400 text-sm">
        Loading…
      </div>
    )
  }

  return (
    <div className="flex flex-col h-screen select-none">
      {/* ── Main content ─────────────────────────────────────────────────────── */}
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
            courseName={courseName}
            onCourseNameChange={setCourseName}
            saveStatus={saveStatus}
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
