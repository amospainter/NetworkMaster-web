import type { Device, GameState } from '../types'
import { DEVICE_RULES } from './constants'
import { cloneState } from './utils'
import { buildWirelessAssociations } from './wireless'

/**
 * Finds a shortest operational route using breadth-first search.
 *
 * The graph includes working cables plus current wireless associations. Offline
 * devices, failed cables, incompatible VLAN tags, and source-kind firewall
 * blocks are excluded before traversal.
 *
 * @param state - Current topology and operational state.
 * @param sourceId - Origin device identifier.
 * @param destinationId - Destination device identifier.
 * @param wirelessAssociations - Precomputed client-to-hub map for this state;
 *   built internally when omitted. Callers resolving many routes against the
 *   same state (a simulation tick) should build this once and share it.
 * @returns The shortest device-id path, or `null` when no route exists.
 */
export function findRoute(
  state: GameState,
  sourceId: string,
  destinationId: string,
  wirelessAssociations?: Map<string, string>,
): string[] | null {
  const source = state.devices.find((device) => device.id === sourceId)
  if (!source) return null
  const adjacency = new Map<string, string[]>()
  /**
   * Adds both directions of an operational edge to the transient routing graph.
   *
   * @param firstId - First endpoint identifier.
   * @param secondId - Second endpoint identifier.
   * @returns Nothing; the adjacency map is updated in place.
   */
  const addEdge = (firstId: string, secondId: string) => {
    adjacency.set(firstId, [...(adjacency.get(firstId) || []), secondId])
    adjacency.set(secondId, [...(adjacency.get(secondId) || []), firstId])
  }
  for (const networkCable of state.cables)
    if (networkCable.status !== 'failed') {
      const firstDevice = state.devices.find((device) => device.id === networkCable.from)
      const secondDevice = state.devices.find((device) => device.id === networkCable.to)
      const vlanAllowsTraffic = networkCable.vlan === null || networkCable.vlan === source.subnet
      const firstDeviceAllowsTraffic =
        firstDevice?.kind !== 'firewall' || firstDevice.firewallRule !== source.kind
      const secondDeviceAllowsTraffic =
        secondDevice?.kind !== 'firewall' || secondDevice.firewallRule !== source.kind
      if (
        firstDevice &&
        !firstDevice.offline &&
        firstDeviceAllowsTraffic &&
        secondDevice &&
        !secondDevice.offline &&
        secondDeviceAllowsTraffic &&
        vlanAllowsTraffic
      ) {
        addEdge(networkCable.from, networkCable.to)
      }
    }
  const associations = wirelessAssociations ?? buildWirelessAssociations(state)
  for (const [clientId, hubId] of associations) addEdge(clientId, hubId)

  // BFS otherwise always resolves a tie between equally-short branches the
  // same way (cable/device iteration order), so a load balancer with two
  // downstream paths of equal length (e.g. two router/Cloud uplinks) would
  // always send every packet down the same one. Shuffling a load balancer's
  // edge order per call means each independently resolved packet (simulate()
  // calls findRoute once per packet) races down a differently-ordered branch
  // list, so traffic actually spreads across the tied branches over time.
  // Regular forwarding devices keep deterministic shortest-path behavior.
  for (const device of state.devices) {
    if (device.kind !== 'loadBalancer') continue
    const neighbors = adjacency.get(device.id)
    if (!neighbors || neighbors.length < 2) continue
    for (let i = neighbors.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[neighbors[i], neighbors[j]] = [neighbors[j], neighbors[i]]
    }
  }

  const queue: [string, string[]][] = [[sourceId, [sourceId]]]
  const visited = new Set([sourceId])
  while (queue.length) {
    const [currentId, path] = queue.shift()!
    if (currentId === destinationId) return path
    for (const neighborId of adjacency.get(currentId) || [])
      if (!visited.has(neighborId)) {
        visited.add(neighborId)
        queue.push([neighborId, [...path, neighborId]])
      }
  }
  return null
}

/**
 * Returns 0, 1, or 2 depending on whether an edge-disjoint backup route exists.
 * The score intentionally caps at two because gameplay rewards redundancy,
 * rather than the exact maximum-flow path count.
 *
 * @param state - Current topology and operational state.
 * @param sourceId - Origin device identifier.
 * @param destinationId - Destination device identifier.
 * @param wirelessAssociations - Precomputed client-to-hub map; built internally
 *   when omitted. Safe to reuse across the cable-filtered clone below, since
 *   removing cable edges cannot change which hub a client associates with.
 * @returns Zero for no path, one for a single path, or two when a backup exists.
 */
export function independentPathCount(
  state: GameState,
  sourceId: string,
  destinationId: string,
  wirelessAssociations?: Map<string, string>,
) {
  const associations = wirelessAssociations ?? buildWirelessAssociations(state)
  const primaryRoute = findRoute(state, sourceId, destinationId, associations)
  if (!primaryRoute) return 0
  const primaryEdges = new Set(
    primaryRoute
      .slice(1)
      .map((deviceId, index) => [primaryRoute[index], deviceId].sort().join('|')),
  )
  const stateWithoutPrimaryRoute = cloneState(state)
  stateWithoutPrimaryRoute.cables = stateWithoutPrimaryRoute.cables.filter(
    (networkCable) => !primaryEdges.has([networkCable.from, networkCable.to].sort().join('|')),
  )
  return findRoute(stateWithoutPrimaryRoute, sourceId, destinationId, associations) ? 2 : 1
}

/**
 * Selects an operational device in another subnet to receive cross-subnet traffic.
 *
 * @param state - Current game state.
 * @param source - Traffic-generating source device.
 * @returns A randomly selected eligible destination, or `undefined` when none exists.
 */
export function pickCrossSubnetDest(state: GameState, source: Device): Device | undefined {
  const candidates = state.devices.filter(
    (device) =>
      device.subnet !== source.subnet &&
      (device.kind === 'server' || DEVICE_RULES[device.kind].rate > 0) &&
      !device.offline &&
      device.id !== source.id,
  )
  return candidates[Math.floor(Math.random() * candidates.length)]
}

/**
 * Finds a route from a source to a destination that must pass through another device.
 *
 * @param state - Current topology and operational state.
 * @param sourceId - Origin device identifier.
 * @param viaId - Required intermediate device identifier.
 * @param destinationId - Destination device identifier.
 * @param wirelessAssociations - Precomputed client-to-hub map; built internally
 *   when omitted, then shared across both route segments.
 * @returns The combined route, or `null` when either route segment is unavailable.
 */
export function findRouteThrough(
  state: GameState,
  sourceId: string,
  viaId: string,
  destinationId: string,
  wirelessAssociations?: Map<string, string>,
): string[] | null {
  const associations = wirelessAssociations ?? buildWirelessAssociations(state)
  const toVia = findRoute(state, sourceId, viaId, associations)
  const fromVia = findRoute(state, viaId, destinationId, associations)
  if (!toVia || !fromVia) return null
  return [...toVia, ...fromVia.slice(1)]
}
