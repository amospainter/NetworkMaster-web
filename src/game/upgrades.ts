import type { Cable, CableTier, GameState } from '../types'
import {
  CABLE_TIERS,
  CACHE_HIT_RATE_COST,
  CACHE_HIT_RATE_MAX,
  CACHE_HIT_RATE_STEP,
  CACHE_HIT_CHANCE,
  FORWARDING_SPEED_COSTS,
  FORWARDING_SPEED_GAIN,
  UPS_COST,
  UPS_ELIGIBLE_KINDS,
  WIFI_STANDARDS,
} from './constants'
import { addEvent, canAfford, cloneState, discountedSiteCost, event, spendBudget } from './utils'

/**
 * Advances a cable by one tier and records its refundable player investment.
 *
 * @param state - Current game state.
 * @param cableId - Cable to upgrade.
 * @returns Updated state, or the original/event-bearing state when upgrade is unavailable.
 */
export function upgradeCable(state: GameState, cableId: string): GameState {
  const s = cloneState(state),
    c = s.cables.find((x) => x.id === cableId)
  if (!c) return state
  const i = CABLE_TIERS.findIndex((t) => t.name === c.tier),
    next = CABLE_TIERS[i + 1]
  if (!next) return state
  const cost = CABLE_TIERS[i].cost
  if (!canAfford(s, cost))
    return {
      ...state,
      events: [event(state, 'Insufficient budget for cable upgrade.'), ...state.events].slice(0, 6),
    }
  c.tier = next.name
  c.capacity = next.capacity
  c.upgradeSpend += cost
  spendBudget(s, cost)
  addEvent(s, `Cable upgraded to ${next.name}.`)
  return s
}

/**
 * Adds two physical ports to a router or switch.
 *
 * @param state - Current game state.
 * @param deviceId - Router or switch to upgrade.
 * @returns Updated state, or the original/event-bearing state when upgrade is unavailable.
 */
export function upgradeDevicePorts(state: GameState, deviceId: string): GameState {
  if (!canAfford(state, 50))
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
  spendBudget(s, 50)
  addEvent(s, `${d.label} expanded by 2 ports.`)
  return s
}

/**
 * Raises forwarding throughput for supported infrastructure.
 *
 * @param state - Current game state.
 * @param deviceId - Forwarding device to upgrade.
 * @returns Updated state, or the original state when upgrade is unavailable.
 */
export function upgradeDeviceSpeed(state: GameState, deviceId: string): GameState {
  const s = cloneState(state),
    d = s.devices.find((x) => x.id === deviceId)
  if (!d || !(d.kind in FORWARDING_SPEED_COSTS)) return state
  const upgradeCost = FORWARDING_SPEED_COSTS[d.kind]!
  if (!canAfford(s, upgradeCost)) return state
  d.pps += FORWARDING_SPEED_GAIN[d.kind]!
  d.upgradeSpend += upgradeCost
  spendBudget(s, upgradeCost)
  addEvent(s, `${d.label} forwarding capacity upgraded.`)
  return s
}

/**
 * Advances an access point to the next Wi-Fi generation. Applies only the
 * generation's pps delta (not an overwrite) so an access point's independent
 * `upgradeDeviceSpeed` throughput bonus survives a later generation upgrade.
 *
 * @param state - Current game state.
 * @param deviceId - Wireless access point to upgrade.
 * @returns Updated state, or the original state when upgrade is unavailable.
 */
export function upgradeWifi(state: GameState, deviceId: string): GameState {
  const s = cloneState(state),
    d = s.devices.find((x) => x.id === deviceId)
  if (!d || d.kind !== 'wireless' || d.wifiLevel >= WIFI_STANDARDS.length - 1) return state
  const cost = WIFI_STANDARDS[d.wifiLevel].cost
  if (!canAfford(s, cost)) return state
  const previousBasePps = WIFI_STANDARDS[d.wifiLevel].pps
  d.wifiLevel++
  d.pps += WIFI_STANDARDS[d.wifiLevel].pps - previousBasePps
  d.upgradeSpend += cost
  spendBudget(s, cost)
  addEvent(s, `${d.label} upgraded to ${WIFI_STANDARDS[d.wifiLevel].name}.`)
  return s
}

/**
 * Purchases a UPS for an eligible infrastructure device, immunizing it against
 * power-outage events.
 *
 * @param state - Current game state.
 * @param deviceId - Device to protect.
 * @returns Updated state, or the original state when the purchase is unavailable.
 */
export function upgradeUps(state: GameState, deviceId: string): GameState {
  const s = cloneState(state),
    d = s.devices.find((x) => x.id === deviceId)
  if (!d || d.ups || !UPS_ELIGIBLE_KINDS.includes(d.kind)) return state
  if (!canAfford(s, UPS_COST)) return state
  d.ups = true
  d.upgradeSpend += UPS_COST
  spendBudget(s, UPS_COST)
  addEvent(s, `${d.label} fitted with a UPS — immune to power outages.`)
  return s
}

/**
 * Raises a cache device's hit rate by one level, capped at `CACHE_HIT_RATE_MAX`.
 *
 * @param state - Current game state.
 * @param deviceId - Cache device to upgrade.
 * @returns Updated state, or the original state when the upgrade is unavailable.
 */
export function upgradeCacheHitRate(state: GameState, deviceId: string): GameState {
  const s = cloneState(state),
    d = s.devices.find((x) => x.id === deviceId)
  if (!d || d.kind !== 'cache') return state
  const maxLevel = Math.round((CACHE_HIT_RATE_MAX - CACHE_HIT_CHANCE) / CACHE_HIT_RATE_STEP)
  if (d.cacheLevel >= maxLevel) return state
  if (!canAfford(s, CACHE_HIT_RATE_COST)) return state
  d.cacheLevel++
  d.upgradeSpend += CACHE_HIT_RATE_COST
  spendBudget(s, CACHE_HIT_RATE_COST)
  addEvent(s, `${d.label} cache hit rate increased.`)
  return s
}

/**
 * Restores an infrastructure device while intentionally retaining accumulated wear.
 *
 * @param state - Current game state.
 * @param deviceId - Device to repair.
 * @returns Updated state, or the original state when the repair cannot be purchased.
 */
export function repairDevice(state: GameState, deviceId: string): GameState {
  if (!canAfford(state, 40)) return state
  const s = cloneState(state),
    d = s.devices.find((x) => x.id === deviceId)
  if (!d) return state
  d.health = 100
  d.offline = false
  spendBudget(s, 40)
  addEvent(s, `${d.label} repaired; accumulated wear remains.`)
  return s
}

/**
 * Tests whether a cable is the fixed-tier cloud uplink.
 *
 * @param state - Current game state.
 * @param cable - Cable to inspect.
 * @returns Whether either endpoint is the cloud device.
 */
const isCloudCable = (state: GameState, cable: Cable) => {
  const cloudId = state.devices.find((device) => device.kind === 'cloud')?.id
  return cable.from === cloudId || cable.to === cloudId
}

/**
 * Finds cables eligible for a site-wide tier upgrade.
 *
 * @param state - Current game state.
 * @param target - Desired cable tier.
 * @returns Non-cloud cables currently below the target tier.
 */
export function siteCableUpgradeTargets(state: GameState, target: CableTier): Cable[] {
  const targetIndex = CABLE_TIERS.findIndex((tier) => tier.name === target)
  return state.cables.filter(
    (cable) =>
      CABLE_TIERS.findIndex((tier) => tier.name === cable.tier) < targetIndex &&
      !isCloudCable(state, cable),
  )
}

/**
 * Calculates the undiscounted price to bring eligible cables to a target tier.
 *
 * @param state - Current game state.
 * @param target - Desired cable tier.
 * @returns Full price including every intervening tier for every eligible cable.
 */
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
 *
 * @param state - Current game state.
 * @param target - Desired site-wide cable tier.
 * @returns Updated state, or an event-bearing copy when no upgrade can be applied.
 */
export function upgradeAllCables(state: GameState, target: CableTier): GameState {
  const targets = siteCableUpgradeTargets(state, target)
  const cost = discountedSiteCost(siteCableUpgradeFullCost(state, target))
  const targetTier = CABLE_TIERS.find((tier) => tier.name === target)!
  if (!targets.length || !canAfford(state, cost))
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
  spendBudget(s, cost)
  addEvent(s, `Site upgrade: ${targets.length} links moved to ${target}.`)
  return s
}

/**
 * Applies the discounted two-port expansion to every router and switch.
 *
 * @param state - Current game state.
 * @returns Updated state, or an event-bearing copy when the upgrade cannot be applied.
 */
export function upgradeAllPorts(state: GameState): GameState {
  const targets = state.devices.filter((d) => ['router', 'switch'].includes(d.kind)),
    cost = discountedSiteCost(targets.length * 50)
  if (!targets.length || !canAfford(state, cost))
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
  spendBudget(s, cost)
  addEvent(s, 'Site upgrade: +2 ports on all network equipment.')
  return s
}

/**
 * Applies the discounted speed upgrade to every installed switch.
 *
 * @param state - Current game state.
 * @returns Updated state, or an event-bearing copy when the upgrade cannot be applied.
 */
export function upgradeAllSwitchSpeed(state: GameState): GameState {
  const switches = state.devices.filter((device) => device.kind === 'switch')
  const cost = discountedSiteCost(switches.length * 60)
  if (!switches.length || !canAfford(state, cost)) {
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
  spendBudget(nextState, cost)
  addEvent(nextState, `Site upgrade: faster forwarding on ${switches.length} switches.`)
  return nextState
}
