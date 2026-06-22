export interface Point {
  x: number
  y: number
}

export type FillType = 'fairway' | 'green' | 'rough' | 'fescue' | 'bunker' | 'water' | 'none'

export const FILL_COLORS: Record<FillType, string> = {
  fairway: '#4a7c3f',
  green:   '#2d6a2d',
  rough:   '#5a7a3a',
  fescue:  '#8a9a3a',
  bunker:  '#c8b878',
  water:   '#4a8ab0',
  none:    '#1e293b',
}

export const FILL_LABELS: Record<FillType, string> = {
  fairway: 'Fairway',
  green:   'Green',
  rough:   'Rough',
  fescue:  'Fescue',
  bunker:  'Bunker',
  water:   'Water',
  none:    'Outline',
}

export interface Shape {
  id: string
  rawPoints: Point[]
  svgPath: string
  isClosed: boolean
  fillType: FillType
}

export type ObjectType = 'teebox' | 'pin'

// Default sizes in px (scale: 3px = 1 yard, placeholder until calibration)
export const OBJECT_DEFAULTS: Record<ObjectType, { width: number; height: number }> = {
  teebox: { width: 36, height: 54 },   // ~12x18 yards
  pin:    { width: 16, height: 16 },
}

export const OBJECT_COLORS: Record<ObjectType, string> = {
  teebox: '#d4a96a',
  pin:    '#e53e3e',
}

export interface PlacedObject {
  id: string
  objectType: ObjectType
  x: number        // center
  y: number        // center
  rotation: number // degrees
  width: number
  height: number
}

export interface SnapRef {
  entityId: string
  entityType: 'shape' | 'object'
  vertexIndex: number  // index into rawPoints for shapes; 0 = center for objects
}

export interface Measurement {
  id: string
  p1: Point
  p2: Point
  customYards: number | null  // null = derived from pixel distance
  p1Snap?: SnapRef
  p2Snap?: SnapRef
}

export interface HoleMetadata {
  holeNumber: number
  par: number
}

export type EntityType = 'shape' | 'object' | 'measurement'

export interface Hole {
  id: string
  metadata: HoleMetadata
  shapes: Shape[]
  objects: PlacedObject[]
  measurements: Measurement[]
}

export interface CourseLayout {
  holeId: string
  x: number
  y: number
  rotation: number
  scale: number
}

export interface Course {
  id: string
  name: string
  holes: Hole[]
  layout: CourseLayout[]
}
