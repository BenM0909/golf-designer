export interface Point {
  x: number
  y: number
}

export interface Shape {
  id: string
  rawPoints: Point[]
  svgPath: string
  isClosed: boolean
}
