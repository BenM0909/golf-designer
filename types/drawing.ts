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
