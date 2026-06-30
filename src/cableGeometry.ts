import type { Cable, Device } from './types'

export type CanvasPoint = { x: number; y: number }
export type CableRoute = { cableId: string; points: CanvasPoint[] }

type Segment = { start: CanvasPoint; end: CanvasPoint }

const DEVICE_HALF_WIDTH = 4.5
const DEVICE_HALF_HEIGHT = 6
const LANE_OFFSETS = [0, -4, 4, -8, 8]

const segmentsFor = (points: CanvasPoint[]): Segment[] =>
  points.slice(1).map((end, index) => ({ start: points[index], end }))

const segmentLength = ({ start, end }: Segment) => Math.hypot(end.x - start.x, end.y - start.y)

function segmentCrossesDevice(segment: Segment, device: Device): boolean {
  const left = device.x - DEVICE_HALF_WIDTH
  const right = device.x + DEVICE_HALF_WIDTH
  const top = device.y - DEVICE_HALF_HEIGHT
  const bottom = device.y + DEVICE_HALF_HEIGHT
  if (segment.start.x === segment.end.x) {
    const minY = Math.min(segment.start.y, segment.end.y)
    const maxY = Math.max(segment.start.y, segment.end.y)
    return segment.start.x >= left && segment.start.x <= right && maxY >= top && minY <= bottom
  }
  const minX = Math.min(segment.start.x, segment.end.x)
  const maxX = Math.max(segment.start.x, segment.end.x)
  return segment.start.y >= top && segment.start.y <= bottom && maxX >= left && minX <= right
}

function sharedLength(first: Segment, second: Segment): number {
  const firstVertical = first.start.x === first.end.x
  const secondVertical = second.start.x === second.end.x
  if (firstVertical !== secondVertical) return 0
  if (firstVertical) {
    if (first.start.x !== second.start.x) return 0
    return Math.max(
      0,
      Math.min(Math.max(first.start.y, first.end.y), Math.max(second.start.y, second.end.y)) -
        Math.max(Math.min(first.start.y, first.end.y), Math.min(second.start.y, second.end.y)),
    )
  }
  if (first.start.y !== second.start.y) return 0
  return Math.max(
    0,
    Math.min(Math.max(first.start.x, first.end.x), Math.max(second.start.x, second.end.x)) -
      Math.max(Math.min(first.start.x, first.end.x), Math.min(second.start.x, second.end.x)),
  )
}

function segmentsCross(first: Segment, second: Segment): boolean {
  const firstVertical = first.start.x === first.end.x
  const secondVertical = second.start.x === second.end.x
  if (firstVertical === secondVertical) return false
  const vertical = firstVertical ? first : second
  const horizontal = firstVertical ? second : first
  return (
    vertical.start.x > Math.min(horizontal.start.x, horizontal.end.x) &&
    vertical.start.x < Math.max(horizontal.start.x, horizontal.end.x) &&
    horizontal.start.y > Math.min(vertical.start.y, vertical.end.y) &&
    horizontal.start.y < Math.max(vertical.start.y, vertical.end.y)
  )
}

function routeCandidates(start: CanvasPoint, end: CanvasPoint): CanvasPoint[][] {
  const middleX = (start.x + end.x) / 2
  const middleY = (start.y + end.y) / 2
  return [
    [start, { x: start.x, y: end.y }, end],
    [start, { x: end.x, y: start.y }, end],
    ...LANE_OFFSETS.map((offset) => [
      start,
      { x: middleX + offset, y: start.y },
      { x: middleX + offset, y: end.y },
      end,
    ]),
    ...LANE_OFFSETS.map((offset) => [
      start,
      { x: start.x, y: middleY + offset },
      { x: end.x, y: middleY + offset },
      end,
    ]),
  ]
}

/**
 * Routes all cables in display order using orthogonal lanes.
 *
 * Device collisions are treated as effectively forbidden. Shared cable runs
 * are the next-highest penalty, followed by crossings, bends, and total length.
 */
export function computeCableRoutes(devices: Device[], cables: Cable[]): Map<string, CableRoute> {
  const routes = new Map<string, CableRoute>()
  const occupiedSegments: Segment[] = []

  for (const cable of cables) {
    const startDevice = devices.find((device) => device.id === cable.from)
    const endDevice = devices.find((device) => device.id === cable.to)
    if (!startDevice || !endDevice) continue
    if (cable.style === 'diagonal') {
      // Diagonal cables draw a direct line through the lane grid rather than
      // routing around obstacles, so they never enter the orthogonal scoring
      // or occupancy tracking below.
      routes.set(cable.id, { cableId: cable.id, points: [startDevice, endDevice] })
      continue
    }
    const obstacles = devices.filter(
      (device) => device.id !== startDevice.id && device.id !== endDevice.id,
    )
    const candidates = routeCandidates(startDevice, endDevice)
    const bestRoute = candidates.reduce(
      (best, candidate) => {
        const candidateSegments = segmentsFor(candidate)
        const deviceCollisions = candidateSegments.reduce(
          (total, segment) =>
            total + obstacles.filter((device) => segmentCrossesDevice(segment, device)).length,
          0,
        )
        const overlap = candidateSegments.reduce(
          (total, segment) =>
            total +
            occupiedSegments.reduce((sum, occupied) => sum + sharedLength(segment, occupied), 0),
          0,
        )
        const crossings = candidateSegments.reduce(
          (total, segment) =>
            total + occupiedSegments.filter((occupied) => segmentsCross(segment, occupied)).length,
          0,
        )
        const length = candidateSegments.reduce(
          (total, segment) => total + segmentLength(segment),
          0,
        )
        const score =
          deviceCollisions * 10_000 + overlap * 100 + crossings * 25 + candidate.length * 2 + length
        return score < best.score ? { points: candidate, score } : best
      },
      { points: candidates[0], score: Number.POSITIVE_INFINITY },
    )

    routes.set(cable.id, { cableId: cable.id, points: bestRoute.points })
    occupiedSegments.push(...segmentsFor(bestRoute.points))
  }
  return routes
}

export const routeToSvgPath = (route: CableRoute): string =>
  route.points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`).join(' ')

/** Returns a constant-speed position along a multi-segment cable route. */
export function pointAlongRoute(points: CanvasPoint[], progress: number): CanvasPoint {
  const segments = segmentsFor(points)
  const totalLength = segments.reduce((total, segment) => total + segmentLength(segment), 0)
  let remainingDistance = Math.max(0, Math.min(1, progress)) * totalLength
  for (const segment of segments) {
    const length = segmentLength(segment)
    if (remainingDistance <= length) {
      const segmentProgress = length === 0 ? 1 : remainingDistance / length
      return {
        x: segment.start.x + (segment.end.x - segment.start.x) * segmentProgress,
        y: segment.start.y + (segment.end.y - segment.start.y) * segmentProgress,
      }
    }
    remainingDistance -= length
  }
  return points.at(-1) ?? { x: 0, y: 0 }
}
