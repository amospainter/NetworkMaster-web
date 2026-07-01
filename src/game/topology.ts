import type { CableStyle, Device, DeviceKind, GameState } from '../types'
import { costs, SALVAGE_RATE, WIRELESS_ONLY_KINDS } from './constants'
import { createCable, createDevice } from './factories'
import { addEvent, cloneState, event } from './utils'

/** Validates topology rules and adds a new copper connection. */
export function addCable(
  state: GameState,
  from: string,
  to: string,
  style: CableStyle = 'rightAngle',
): GameState {
  const s = cloneState(state),
    a = s.devices.find((d) => d.id === from),
    b = s.devices.find((d) => d.id === to)
  if (!a || !b || from === to) return state
  if ([a, b].some((d) => WIRELESS_ONLY_KINDS.includes(d.kind)))
    return {
      ...state,
      events: [
        event(state, 'Phones and tablets connect through Wi-Fi coverage only.'),
        ...state.events,
      ].slice(0, 6),
    }
  if (s.cables.some((c) => (c.from === from && c.to === to) || (c.from === to && c.to === from)))
    return state
  if (a.ports >= a.maxPorts || b.ports >= b.maxPorts)
    return {
      ...state,
      events: [event(state, 'Connection rejected: no free ports.'), ...state.events].slice(0, 6),
    }
  const end = (d: Device) => ['pc', 'tv', 'console', 'server'].includes(d.kind)
  if (end(a) && end(b))
    return {
      ...state,
      events: [
        event(state, 'End devices need network equipment between them.'),
        ...state.events,
      ].slice(0, 6),
    }
  if ((a.kind === 'cloud' || b.kind === 'cloud') && a.kind !== 'router' && b.kind !== 'router')
    return {
      ...state,
      events: [event(state, 'Only a router may connect to the Cloud Edge.'), ...state.events].slice(
        0,
        6,
      ),
    }
  s.cables.push(createCable(a, b, 'Copper', null, style))
  a.ports++
  b.ports++
  s.packets = []
  addEvent(s, `${a.label} linked to ${b.label}.`)
  return s
}

/**
 * Moves one end of an existing cable to a new device, preserving its tier,
 * VLAN, style, and upgrade investment. Validation mirrors `addCable` while
 * keeping the fixed end untouched. Mirrors the native `rerouteCable`.
 */
export function rerouteCable(
  state: GameState,
  cableId: string,
  movingFromEnd: boolean,
  newDeviceId: string,
): GameState {
  const s = cloneState(state),
    cable = s.cables.find((c) => c.id === cableId)
  if (!cable) return state
  const fixedId = movingFromEnd ? cable.to : cable.from
  const movingId = movingFromEnd ? cable.from : cable.to
  if (newDeviceId === fixedId || newDeviceId === movingId) return state
  const fixed = s.devices.find((d) => d.id === fixedId),
    target = s.devices.find((d) => d.id === newDeviceId),
    moving = s.devices.find((d) => d.id === movingId)
  if (!fixed || !target || !moving) return state
  const end = (d: Device) => ['pc', 'tv', 'console', 'server'].includes(d.kind)
  if (end(fixed) && end(target))
    return {
      ...state,
      events: [
        event(state, 'End devices need network equipment between them.'),
        ...state.events,
      ].slice(0, 6),
    }
  if ([fixed, target].some((d) => WIRELESS_ONLY_KINDS.includes(d.kind)))
    return {
      ...state,
      events: [
        event(state, 'Phones and tablets connect through Wi-Fi coverage only.'),
        ...state.events,
      ].slice(0, 6),
    }
  if (
    (fixed.kind === 'cloud' || target.kind === 'cloud') &&
    fixed.kind !== 'router' &&
    target.kind !== 'router'
  )
    return {
      ...state,
      events: [event(state, 'Only a router may connect to the Cloud Edge.'), ...state.events].slice(
        0,
        6,
      ),
    }
  if (
    s.cables.some(
      (c) =>
        c.id !== cableId &&
        ((c.from === fixedId && c.to === newDeviceId) ||
          (c.from === newDeviceId && c.to === fixedId)),
    )
  )
    return {
      ...state,
      events: [event(state, 'That connection already exists.'), ...state.events].slice(0, 6),
    }
  if (target.ports >= target.maxPorts)
    return {
      ...state,
      events: [
        event(state, `${target.label} has no free ports for this connection.`),
        ...state.events,
      ].slice(0, 6),
    }
  moving.ports--
  target.ports++
  if (movingFromEnd) cable.from = newDeviceId
  else cable.to = newDeviceId
  s.packets = []
  addEvent(s, `Rerouted connection to ${target.label}.`)
  return s
}

/** Returns the native 90% salvage value for removable infrastructure. */
export function deviceRemovalRefund(device: Device): number {
  const buildCost = costs[device.kind]
  if (!buildCost) return 0
  return Math.floor((buildCost + device.upgradeSpend) * SALVAGE_RATE)
}

/** Purchases and places infrastructure at a canvas percentage coordinate. */
export function buildDevice(state: GameState, kind: DeviceKind, x = 50, y = 55): GameState {
  const cost = costs[kind] ?? 999
  if (state.budget < cost)
    return { ...state, events: [event(state, 'Insufficient budget.'), ...state.events].slice(0, 6) }
  const s = cloneState(state),
    count = s.devices.filter((d) => d.kind === kind).length + 1
  s.devices.push(createDevice(kind, `${kind[0].toUpperCase() + kind.slice(1)}-${count}`, x, y))
  s.budget -= cost
  addEvent(s, `${kind} placed. Drag it into position.`)
  return s
}

/** Removes a cable, clears in-flight traffic, and returns 90% of upgrade spend. */
export function deleteCable(state: GameState, cableId: string): GameState {
  const s = cloneState(state),
    c = s.cables.find((x) => x.id === cableId)
  if (!c) return state
  s.cables = s.cables.filter((x) => x.id !== cableId)
  for (const id of [c.from, c.to]) {
    const d = s.devices.find((x) => x.id === id)
    if (d) d.ports = Math.max(0, d.ports - 1)
  }
  const refund = Math.floor(c.upgradeSpend * 0.9)
  s.budget += refund
  s.packets = []
  addEvent(s, `Cable removed${refund ? ` · $${refund} salvaged` : ''}.`)
  return s
}

/** Cycles a cable through untagged and VLANs 1–4. */
export function cycleCableVlan(state: GameState, cableId: string): GameState {
  const nextState = cloneState(state)
  const networkCable = nextState.cables.find((candidate) => candidate.id === cableId)
  if (!networkCable) return state
  networkCable.vlan =
    networkCable.vlan === null ? 1 : networkCable.vlan >= 4 ? null : networkCable.vlan + 1
  nextState.packets = []
  addEvent(nextState, `Cable VLAN set to ${networkCable.vlan ?? 'untagged'}.`)
  return nextState
}

/** Cycles a firewall rule through no block, PC, TV, and console traffic. */
export function cycleFirewallRule(state: GameState, deviceId: string): GameState {
  const nextState = cloneState(state)
  const firewall = nextState.devices.find((device) => device.id === deviceId)
  if (!firewall || firewall.kind !== 'firewall') return state
  const rules: (DeviceKind | null)[] = [null, 'pc', 'tv', 'console']
  const nextRuleIndex = (rules.indexOf(firewall.firewallRule) + 1) % rules.length
  firewall.firewallRule = rules[nextRuleIndex]
  nextState.packets = []
  addEvent(nextState, `${firewall.label} block rule: ${firewall.firewallRule ?? 'none'}.`)
  return nextState
}

/**
 * Removes player-manageable equipment and every attached cable.
 *
 * The refund combines 90% of build and device-upgrade spend with the salvage
 * value of attached cable upgrades. End-user devices and the Cloud are fixed.
 */
export function removeDevice(state: GameState, deviceId: string): GameState {
  const device = state.devices.find((candidate) => candidate.id === deviceId)
  if (!device || !costs[device.kind]) return state

  const nextState = cloneState(state)
  const attachedCables = nextState.cables.filter(
    (networkCable) => networkCable.from === deviceId || networkCable.to === deviceId,
  )
  const cableRefund = attachedCables.reduce(
    (total, networkCable) => total + Math.floor(networkCable.upgradeSpend * SALVAGE_RATE),
    0,
  )
  const equipmentRefund = deviceRemovalRefund(device)
  const attachedCableIds = new Set(attachedCables.map((networkCable) => networkCable.id))

  nextState.cables = nextState.cables.filter(
    (networkCable) => !attachedCableIds.has(networkCable.id),
  )
  nextState.devices = nextState.devices.filter((candidate) => candidate.id !== deviceId)
  for (const remainingDevice of nextState.devices) {
    remainingDevice.ports = nextState.cables.filter(
      (networkCable) =>
        networkCable.from === remainingDevice.id || networkCable.to === remainingDevice.id,
    ).length
  }
  nextState.packets = []
  nextState.budget += equipmentRefund + cableRefund
  addEvent(nextState, `Removed ${device.label} (+$${equipmentRefund + cableRefund} salvage).`)
  return nextState
}

/** Moves a device while clamping it inside the playable canvas. */
export function moveDevice(state: GameState, deviceId: string, x: number, y: number): GameState {
  const s = cloneState(state),
    d = s.devices.find((v) => v.id === deviceId)
  if (!d) return state
  d.x = Math.max(5, Math.min(95, x))
  d.y = Math.max(7, Math.min(94, y))
  return s
}
