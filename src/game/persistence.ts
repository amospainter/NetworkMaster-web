import type { GameState } from '../types'
import { DEVICE_RULES, SCENARIOS } from './constants'
import { createScenarioTopology } from './factories'

/** Creates a fresh, serializable run for the requested scenario. */
export function newGame(scenario = 'home'): GameState {
  const scenarioConfig = SCENARIOS.find((candidate) => candidate.id === scenario) ?? SCENARIOS[0]
  const topology = createScenarioTopology(scenarioConfig.id)
  topology.devices.forEach(
    (device) =>
      (device.ports = topology.cables.filter(
        (cable) => cable.from === device.id || cable.to === device.id,
      ).length),
  )
  return {
    version: 8,
    phase: 'playing',
    scenario: scenarioConfig.id,
    tick: 0,
    score: 0,
    budget: scenarioConfig.budget,
    delivered: 0,
    dropped: 0,
    failure: 0,
    speed: 1,
    ...topology,
    packets: [],
    events: [{ tick: 0, text: 'Run initialized. Connect clients to bring them online.' }],
    recentDrops: [],
    multiplier: 1,
    combo: 1,
    cleanTicks: 0,
    rate: 1,
    spawned: topology.devices.filter((device) => DEVICE_RULES[device.kind].rate > 0).length,
    seed: Math.floor(Math.random() * 0xffffffff),
    unscored: false,
    milestonesReached: [],
    activeEvents: [],
    recentLatencyTicks: 0,
    recentQueueDelayTicks: 0,
  }
}

/**
 * Game-over score bonus rewarding a network that stayed intact and kept
 * delivering. Mirrors the native `calculateNetworkHealth`: the product of the
 * surviving-source ratio and the lifetime delivery ratio, scaled to 1000.
 */
export function networkHealthBonus(state: GameState): number {
  const sources = state.devices.filter((device) => DEVICE_RULES[device.kind].rate > 0)
  const totalGenerated = sources.reduce((total, device) => total + device.generated, 0)
  if (totalGenerated <= 0) return 0
  const totalDelivered = sources.reduce((total, device) => total + device.delivered, 0)
  const deviceRatio = sources.length / Math.max(1, state.spawned)
  const deliveryRatio = totalDelivered / totalGenerated
  return Math.round(deviceRatio * deliveryRatio * 1000)
}

/**
 * Upgrades a persisted save to the current schema, or returns null if it is too
 * old to migrate safely. Version 2 runs predate challenge events and milestones;
 * version 3 runs predate Wi-Fi interference; version 4 runs predate per-packet
 * queue admission; version 5 runs predate cable styles; version 6 runs predate
 * latency/queue-delay telemetry; version 7 runs predate per-event tick stamps.
 * Older or malformed saves are discarded.
 */
export function migrateSavedGame(
  savedGame: { version: number } & Partial<Omit<GameState, 'version'>>,
): GameState | null {
  if (savedGame.version === 2) {
    savedGame.devices?.forEach((device) => {
      device.upgradeSpend ??= 0
      device.firewallRule ??= null
    })
    savedGame.milestonesReached ??= []
    savedGame.activeEvents ??= []
    savedGame.version = 3
  }
  if (savedGame.version === 3) {
    savedGame.devices?.forEach((device) => {
      device.interference ??= 0
    })
    savedGame.version = 4
  }
  if (savedGame.version === 4) {
    // In-flight packets predate the queued-admission model; dropping them
    // loses no persisted progress since they are transient simulation state.
    savedGame.packets = []
    savedGame.version = 5
  }
  if (savedGame.version === 5) {
    savedGame.cables?.forEach((cable) => {
      cable.style ??= 'rightAngle'
    })
    savedGame.version = 6
  }
  if (savedGame.version === 6) {
    savedGame.recentLatencyTicks ??= 0
    savedGame.recentQueueDelayTicks ??= 0
    savedGame.version = 7
  }
  if (savedGame.version === 7) {
    // Legacy plain-string events predate per-event tick stamps; the original
    // tick each happened on isn't recoverable, so they're stamped with the
    // save's current tick as a one-time best-effort backfill.
    const legacyEvents = savedGame.events as unknown as string[] | undefined
    savedGame.events = (legacyEvents ?? []).map((text) => ({
      tick: savedGame.tick ?? 0,
      text,
    }))
    savedGame.version = 8
  }
  return savedGame.version === 8 ? (savedGame as GameState) : null
}
