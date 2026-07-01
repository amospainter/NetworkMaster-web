import type { Cable, CableTier, GameState } from '../types'
import {
  CABLE_TIERS,
  FORWARDING_SPEED_COSTS,
  FORWARDING_SPEED_GAIN,
  WIFI_STANDARDS,
} from './constants'
import { addEvent, cloneState, discountedSiteCost, event } from './utils'

/** Advances a cable by one tier and records its refundable player investment. */
export function upgradeCable(state: GameState, cableId: string): GameState {
  const s = cloneState(state),
    c = s.cables.find((x) => x.id === cableId)
  if (!c) return state
  const i = CABLE_TIERS.findIndex((t) => t.name === c.tier),
    next = CABLE_TIERS[i + 1]
  if (!next) return state
  const cost = CABLE_TIERS[i].cost
  if (s.budget < cost)
    return {
      ...state,
      events: [event(state, 'Insufficient budget for cable upgrade.'), ...state.events].slice(0, 6),
    }
  c.tier = next.name
  c.capacity = next.capacity
  c.upgradeSpend += cost
  s.budget -= cost
  addEvent(s, `Cable upgraded to ${next.name}.`)
  return s
}

/** Adds two physical ports to a router or switch. */
export function upgradeDevicePorts(state: GameState, deviceId: string): GameState {
  if (state.budget < 50)
    return {
      ...state,
      events: [event(state, 'Insufficient budget for port expansion.'), ...state.events].slice(
        0,
        6,
      ),
    }
  const s = cloneState(state),
    d = s.devices.find((x) => x.id === deviceId)
  if (!d || !['router', 'switch'].includes(d.kind)) return state
  d.maxPorts += 2
  d.upgradeSpend += 50
  s.budget -= 50
  addEvent(s, `${d.label} expanded by 2 ports.`)
  return s
}

/** Raises forwarding throughput for a router, switch, or wireless access point. */
export function upgradeDeviceSpeed(state: GameState, deviceId: string): GameState {
  const s = cloneState(state),
    d = s.devices.find((x) => x.id === deviceId)
  if (!d || !(d.kind in FORWARDING_SPEED_COSTS)) return state
  const upgradeCost = FORWARDING_SPEED_COSTS[d.kind]!
  if (s.budget < upgradeCost) return state
  d.pps += FORWARDING_SPEED_GAIN[d.kind]!
  d.upgradeSpend += upgradeCost
  s.budget -= upgradeCost
  addEvent(s, `${d.label} forwarding capacity upgraded.`)
  return s
}

/**
 * Advances an access point to the next Wi-Fi generation. Applies only the
 * generation's pps delta (not an overwrite) so an access point's independent
 * `upgradeDeviceSpeed` throughput bonus survives a later generation upgrade.
 */
export function upgradeWifi(state: GameState, deviceId: string): GameState {
  const s = cloneState(state),
    d = s.devices.find((x) => x.id === deviceId)
  if (!d || d.kind !== 'wireless' || d.wifiLevel >= WIFI_STANDARDS.length - 1) return state
  const cost = WIFI_STANDARDS[d.wifiLevel].cost
  if (s.budget < cost) return state
  const previousBasePps = WIFI_STANDARDS[d.wifiLevel].pps
  d.wifiLevel++
  d.pps += WIFI_STANDARDS[d.wifiLevel].pps - previousBasePps
  d.upgradeSpend += cost
  s.budget -= cost
  addEvent(s, `${d.label} upgraded to ${WIFI_STANDARDS[d.wifiLevel].name}.`)
  return s
}

/** Restores an infrastructure device while intentionally retaining accumulated wear. */
export function repairDevice(state: GameState, deviceId: string): GameState {
  if (state.budget < 40) return state
  const s = cloneState(state),
    d = s.devices.find((x) => x.id === deviceId)
  if (!d) return state
  d.health = 100
  d.offline = false
  s.budget -= 40
  addEvent(s, `${d.label} repaired; accumulated wear remains.`)
  return s
}

/** True when a cable is the fixed-tier ISP uplink, excluded from site bulk-upgrades. */
const isCloudCable = (state: GameState, cable: Cable) => {
  const cloudId = state.devices.find((device) => device.kind === 'cloud')?.id
  return cable.from === cloudId || cable.to === cloudId
}

/** Cables (excluding the cloud uplink) below the given tier, eligible for a site upgrade. */
export function siteCableUpgradeTargets(state: GameState, target: CableTier): Cable[] {
  const targetIndex = CABLE_TIERS.findIndex((tier) => tier.name === target)
  return state.cables.filter(
    (cable) =>
      CABLE_TIERS.findIndex((tier) => tier.name === cable.tier) < targetIndex &&
      !isCloudCable(state, cable),
  )
}

/** Undiscounted price to bring every eligible cable up to `target`, every intervening tier included. */
export function siteCableUpgradeFullCost(state: GameState, target: CableTier): number {
  const targetIndex = CABLE_TIERS.findIndex((tier) => tier.name === target)
  return siteCableUpgradeTargets(state, target).reduce((total, cable) => {
    const fromIndex = CABLE_TIERS.findIndex((tier) => tier.name === cable.tier)
    const intervening = CABLE_TIERS.slice(fromIndex, targetIndex)
    return total + intervening.reduce((sum, tier) => sum + tier.cost, 0)
  }, 0)
}

/**
 * Applies a discounted bulk upgrade to every cable below `target`, paying for
 * every intervening tier per cable. Mirrors the native `upgradeAllCables`,
 * which exposes a 100 Mbps / 1 Gbps target picker; the cloud uplink is
 * excluded since its tier is fixed by the scenario.
 */
export function upgradeAllCables(state: GameState, target: CableTier): GameState {
  const targets = siteCableUpgradeTargets(state, target)
  const cost = discountedSiteCost(siteCableUpgradeFullCost(state, target))
  const targetTier = CABLE_TIERS.find((tier) => tier.name === target)!
  if (!targets.length || state.budget < cost)
    return {
      ...state,
      events: [
        event(
          state,
          targets.length
            ? 'Insufficient budget for site cable upgrade.'
            : `All connections already meet the ${target} standard.`,
        ),
        ...state.events,
      ].slice(0, 6),
    }
  const s = cloneState(state)
  const targetIds = new Set(targets.map((cable) => cable.id))
  s.cables
    .filter((cable) => targetIds.has(cable.id))
    .forEach((c) => {
      c.tier = targetTier.name
      c.capacity = targetTier.capacity
      c.upgradeSpend += Math.floor(cost / targets.length)
    })
  s.budget -= cost
  addEvent(s, `Site upgrade: ${targets.length} links moved to ${target}.`)
  return s
}

/** Applies the discounted two-port expansion to every router and switch. */
export function upgradeAllPorts(state: GameState): GameState {
  const targets = state.devices.filter((d) => ['router', 'switch'].includes(d.kind)),
    cost = discountedSiteCost(targets.length * 50)
  if (!targets.length || state.budget < cost)
    return {
      ...state,
      events: [event(state, 'Insufficient budget for site port expansion.'), ...state.events].slice(
        0,
        6,
      ),
    }
  const s = cloneState(state)
  s.devices
    .filter((d) => ['router', 'switch'].includes(d.kind))
    .forEach((d) => {
      d.maxPorts += 2
      d.upgradeSpend += Math.floor(cost / targets.length)
    })
  s.budget -= cost
  addEvent(s, 'Site upgrade: +2 ports on all network equipment.')
  return s
}

/** Applies the native 15%-discounted speed upgrade to every installed switch. */
export function upgradeAllSwitchSpeed(state: GameState): GameState {
  const switches = state.devices.filter((device) => device.kind === 'switch')
  const cost = discountedSiteCost(switches.length * 60)
  if (!switches.length || state.budget < cost) {
    return {
      ...state,
      events: [
        event(state, 'Insufficient budget for the site switch upgrade.'),
        ...state.events,
      ].slice(0, 6),
    }
  }
  const nextState = cloneState(state)
  nextState.devices
    .filter((device) => device.kind === 'switch')
    .forEach((networkSwitch) => {
      networkSwitch.pps += 4
      networkSwitch.upgradeSpend += Math.floor(cost / switches.length)
    })
  nextState.budget -= cost
  addEvent(nextState, `Site upgrade: faster forwarding on ${switches.length} switches.`)
  return nextState
}
