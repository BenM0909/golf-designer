import type { Course, Hole } from '@/types/drawing'
import { createBrowserClient } from '@/lib/supabase'

export async function saveCourse(course: Course): Promise<void> {
  const sb = createBrowserClient()

  const { error: courseErr } = await sb.from('courses').upsert({
    id: course.id,
    name: course.name,
    updated_at: new Date().toISOString(),
  })
  if (courseErr) throw courseErr

  for (const hole of course.holes) {
    const { error: holeErr } = await sb.from('holes').upsert({
      id: hole.id,
      course_id: course.id,
      hole_number: hole.metadata.holeNumber,
      par: hole.metadata.par,
      sort_order: hole.metadata.holeNumber,
    })
    if (holeErr) throw holeErr

    // Replace shapes
    await sb.from('hole_shapes').delete().eq('hole_id', hole.id)
    if (hole.shapes.length > 0) {
      const { error } = await sb.from('hole_shapes').insert(
        hole.shapes.map(s => ({
          id: s.id,
          hole_id: hole.id,
          raw_points: s.rawPoints,
          svg_path: s.svgPath,
          is_closed: s.isClosed,
          fill_type: s.fillType,
        })),
      )
      if (error) throw error
    }

    // Replace objects
    await sb.from('hole_objects').delete().eq('hole_id', hole.id)
    if (hole.objects.length > 0) {
      const { error } = await sb.from('hole_objects').insert(
        hole.objects.map(o => ({
          id: o.id,
          hole_id: hole.id,
          object_type: o.objectType,
          x: o.x,
          y: o.y,
          rotation: o.rotation,
          width: o.width,
          height: o.height,
        })),
      )
      if (error) throw error
    }

    // Replace measurements
    await sb.from('hole_measurements').delete().eq('hole_id', hole.id)
    if (hole.measurements.length > 0) {
      const { error } = await sb.from('hole_measurements').insert(
        hole.measurements.map(m => ({
          id: m.id,
          hole_id: hole.id,
          p1: m.p1,
          p2: m.p2,
          custom_yards: m.customYards,
          p1_snap: m.p1Snap ?? null,
          p2_snap: m.p2Snap ?? null,
        })),
      )
      if (error) throw error
    }
  }

  // Replace layout
  await sb.from('course_layout').delete().eq('course_id', course.id)
  if (course.layout.length > 0) {
    const { error } = await sb.from('course_layout').insert(
      course.layout.map(l => ({
        id: crypto.randomUUID(),
        course_id: course.id,
        hole_id: l.holeId,
        x: l.x,
        y: l.y,
        rotation: l.rotation,
        scale: l.scale,
      })),
    )
    if (error) throw error
  }
}

export async function loadCourse(courseId: string): Promise<Course> {
  const sb = createBrowserClient()

  const { data: course, error: courseErr } = await sb
    .from('courses')
    .select('*')
    .eq('id', courseId)
    .single()
  if (courseErr) throw courseErr

  const { data: holes, error: holesErr } = await sb
    .from('holes')
    .select('*')
    .eq('course_id', courseId)
    .order('sort_order')
  if (holesErr) throw holesErr

  const { data: layout, error: layoutErr } = await sb
    .from('course_layout')
    .select('*')
    .eq('course_id', courseId)
  if (layoutErr) throw layoutErr

  const hydratedHoles: Hole[] = await Promise.all(
    (holes ?? []).map(async h => {
      const [shapesRes, objectsRes, measRes] = await Promise.all([
        sb.from('hole_shapes').select('*').eq('hole_id', h.id),
        sb.from('hole_objects').select('*').eq('hole_id', h.id),
        sb.from('hole_measurements').select('*').eq('hole_id', h.id),
      ])

      return {
        id: h.id,
        metadata: { holeNumber: h.hole_number, par: h.par },
        shapes: (shapesRes.data ?? []).map(s => ({
          id: s.id,
          rawPoints: s.raw_points,
          svgPath: s.svg_path,
          isClosed: s.is_closed,
          fillType: s.fill_type,
        })),
        objects: (objectsRes.data ?? []).map(o => ({
          id: o.id,
          objectType: o.object_type,
          x: o.x,
          y: o.y,
          rotation: o.rotation,
          width: o.width,
          height: o.height,
        })),
        measurements: (measRes.data ?? []).map(m => ({
          id: m.id,
          p1: m.p1,
          p2: m.p2,
          customYards: m.custom_yards,
          p1Snap: m.p1_snap ?? undefined,
          p2Snap: m.p2_snap ?? undefined,
        })),
      }
    }),
  )

  return {
    id: course.id,
    name: course.name,
    holes: hydratedHoles,
    layout: (layout ?? []).map(l => ({
      holeId: l.hole_id,
      x: l.x,
      y: l.y,
      rotation: l.rotation,
      scale: l.scale,
    })),
  }
}

export async function listCourses(): Promise<{ id: string; name: string; updated_at: string }[]> {
  const sb = createBrowserClient()
  const { data, error } = await sb
    .from('courses')
    .select('id, name, updated_at')
    .order('updated_at', { ascending: false })
  if (error) throw error
  return data ?? []
}
