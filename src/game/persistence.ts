import type { Device, GameState } from '../types'
import { DEVICE_RULES, SCENARIOS } from './constants'
import { createScenarioTopology } from './factories'

/**
 * Creates a fresh, serializable run for the requested scenario.
 *
 * @param scenario - Scenario identifier; unknown values use the first configured scenario.
 * @param mode - Sandbox runs skip budget gating and game over, and never write scores.
 * @returns A version-current game state with a newly generated topology.
 */
export function newGame(scenario = 'home', mode: GameState['mode'] = 'normal'): GameState {
  const scenarioConfig = SCENARIOS.find((candidate) => candidate.id === scenario) ?? SCENARIOS[0]
  const topology = createScenarioTopology(scenarioConfig.id)
  topology.devices.forEach(
    (device) =>
      (device.ports = topology.cables.filter(
        (cable) => cable.from === device.id || cable.to === device.id,
      ).length),
  )
  return {
    version: 13,
    phase: 'playing',
    mode,
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
    history: [],
    historyStride: 1,
    challengeRollCount: 0,
    windowIncomeCents: 0,
    slaContract: null,
  }
}

/**
 * Game-over score bonus rewarding a network that stayed intact and kept
 * delivering. Mirrors the native `calculateNetworkHealth`: the product of the
 * surviving-source ratio and the lifetime delivery ratio, scaled to 1000.
 *
 * @param state - Completed or in-progress game state to score.
 * @returns A whole-number bonus from 0 through 1000.
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
 * latency/queue-delay telemetry; version 7 runs predate per-event tick stamps;
 * version 8 runs predate multi-select firewall rules; version 9 runs predate
 * sandbox mode and run-history telemetry; version 10 runs predate DDoS/power-outage
 * events, honeypots, and UPS upgrades; version 11 runs predate cache/repeater devices
 * and metered income; version 12 runs predate QoS boosts and SLA contracts.
 * Older or malformed saves are discarded.
 *
 * @param savedGame - Parsed persisted state with a schema version.
 * @returns A current `GameState`, or `null` when migration is unsafe.
 */
export function migrateSavedGame(
  savedGame: { version: number } & Partial<Omit<GameState, 'version'>>,
): GameState | null {
  if (savedGame.version === 2) {
    savedGame.devices?.forEach((device) => {
      device.upgradeSpend ??= 0
      ;(device as typeof device & { firewallRule?: string | null }).firewallRule ??= null
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
  if (savedGame.version === 8) {
    savedGame.devices?.forEach((device) => {
      const legacyRule = (device as typeof device & { firewallRule?: Device['kind'] | null })
        .firewallRule
      device.firewallRules = legacyRule ? [legacyRule] : []
      delete (device as typeof device & { firewallRule?: Device['kind'] | null }).firewallRule
    })
    // Transient packets may predate the firewall-drop animation state.
    savedGame.packets = []
    savedGame.version = 9
  }
  if (savedGame.version === 9) {
    savedGame.mode ??= 'normal'
    savedGame.history ??= []
    savedGame.historyStride ??= 1
    savedGame.version = 10
  }
  if (savedGame.version === 10) {
    savedGame.devices?.forEach((device) => {
      device.ups ??= false
    })
    savedGame.challengeRollCount ??= 0
    // Transient packets may predate the junk-packet shape.
    savedGame.packets = []
    savedGame.version = 11
  }
  if (savedGame.version === 11) {
    savedGame.devices?.forEach((device) => {
      device.cacheLevel ??= 0
    })
    savedGame.windowIncomeCents ??= 0
    savedGame.version = 12
  }
  if (savedGame.version === 12) {
    savedGame.devices?.forEach((device) => {
      device.qosBoost ??= null
    })
    savedGame.slaContract ??= null
    savedGame.version = 13
  }
  return savedGame.version === 13 ? (savedGame as GameState) : null
}
