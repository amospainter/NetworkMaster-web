import type { Device, GameState, Packet, Scenario } from '../types'
import {
  DEVICE_RULES,
  FORWARDING_KINDS,
  MILESTONES,
  PRIORITY_WEIGHT,
  QUEUE_CAPACITY_TICKS,
  SCENARIOS,
  SOURCE_SPAWN_ORDER,
  WIRELESS_CAPABLE_KINDS,
  WIRELESS_ONLY_KINDS,
} from './constants'
import { createDevice } from './factories'
import { networkHealthBonus } from './persistence'
import { findRoute, findRouteThrough, independentPathCount, pickCrossSubnetDest } from './routing'
import { addEvent, cloneState, createId, distanceBetween } from './utils'
import { buildWirelessAssociations, deviceCapacity, hubRange } from './wireless'

/**
 * Eases demand in over a scenario's opening ticks so the network starts quiet
 * and the player can connect devices before traffic reaches full intensity.
 * Mirrors the native `warmupFactor`.
 *
 * @param tick - Current simulation tick.
 * @param scenario - Active scenario pacing configuration.
 * @returns Demand multiplier between the scenario floor and 1.
 */
function warmupFactor(tick: number, scenario: Scenario): number {
  if (tick >= scenario.warmupTicks) return 1
  const progress = tick / scenario.warmupTicks
  return scenario.warmupFloor + (1 - scenario.warmupFloor) * progress
}

/**
 * Returns the active traffic-spike multiplier for a device.
 *
 * @param state - Current game state.
 * @param deviceId - Traffic source identifier.
 * @returns Two while the source is spiked, otherwise one.
 */
function trafficSpikeMultiplier(state: GameState, deviceId: string): number {
  return state.activeEvents.some(
    (event) => event.kind === 'trafficSpike' && event.targetId === deviceId,
  )
    ? 2
    : 1
}

/**
 * Creates an in-flight packet at the beginning of a resolved route.
 *
 * @param source - Actual endpoint at the beginning of the route.
 * @param path - Precomputed device-id route.
 * @param tick - Generation tick used for latency accounting.
 * @param owner - Client whose demand created the request/response traffic.
 * @returns A new packet positioned at the start of its route.
 */
function packet(source: Device, path: string[], tick: number, owner: Device = source): Packet {
  return {
    id: createId(),
    path,
    hop: 0,
    progress: 0,
    priority: DEVICE_RULES[owner.kind].priority,
    owner: owner.id,
    source: source.id,
    generatedTick: tick,
    queuedTicks: 0,
  }
}

/**
 * Adds the next end-user device in the configured spawn rotation.
 *
 * @param s - Mutable simulation draft.
 * @returns Nothing; the supplied draft is updated in place.
 */
function spawnDevice(s: GameState) {
  if (s.devices.length >= 20) return
  const kind = SOURCE_SPAWN_ORDER[s.spawned % SOURCE_SPAWN_ORDER.length],
    router = s.devices.find((d) => d.kind === 'router')!,
    angle = (s.spawned * 2.4) % 6.28,
    d = createDevice(
      kind,
      `${kind[0].toUpperCase() + kind.slice(1)}-${s.spawned + 1}`,
      Math.max(8, Math.min(92, router.x + Math.cos(angle) * 34)),
      Math.max(38, Math.min(92, router.y + 45 + Math.sin(angle) * 18)),
      1,
    )
  s.devices.push(d)
  s.spawned++
  addEvent(
    s,
    `${d.label} joined — ${WIRELESS_ONLY_KINDS.includes(kind) ? 'move it into Wi-Fi coverage' : 'draw a cable, or move it into Wi-Fi coverage'}.`,
  )
}

/**
 * Rolls a single challenge event, mirroring the native `rollChallengeEvent`
 * weighting. Equipment-failure events only fire in scenarios that enable
 * equipment failure; the others can occur in any scenario.
 *
 * @param state - Mutable simulation draft.
 * @param scenario - Active scenario configuration.
 * @returns Nothing; any selected event is applied to the draft.
 */
function rollChallengeEvent(state: GameState, scenario: Scenario) {
  const roll = Math.random() * 100
  let kind: 'trafficSpike' | 'budgetBonus' | 'deviceSurge' | 'equipmentFailure'
  if (roll < 35) kind = 'trafficSpike'
  else if (roll < 70) kind = scenario.equipmentFailure ? 'equipmentFailure' : 'budgetBonus'
  else if (roll < 90) kind = 'budgetBonus'
  else kind = 'deviceSurge'

  if (kind === 'trafficSpike') {
    // Weight selection inversely by packet rate so high-demand devices (TV,
    // tablet) are less likely to be spiked, matching the native bias.
    const candidates = state.devices.filter(
      (device) => DEVICE_RULES[device.kind].rate > 0 && !device.offline,
    )
    if (!candidates.length) return
    const minRate = Math.min(...candidates.map((device) => DEVICE_RULES[device.kind].rate))
    const weights = candidates.map((device) => minRate * 2 + 1 - DEVICE_RULES[device.kind].rate)
    let pick = Math.floor(
      Math.random() *
        Math.max(
          1,
          weights.reduce((sum, w) => sum + w, 0),
        ),
    )
    let target = candidates[0]
    for (let index = 0; index < candidates.length; index++) {
      pick -= weights[index]
      if (pick < 0) {
        target = candidates[index]
        break
      }
    }
    state.activeEvents.push({
      id: createId(),
      kind: 'trafficSpike',
      ticksRemaining: 10,
      targetId: target.id,
    })
    addEvent(state, `Traffic spike: ${target.label} doubles demand for 10 ticks.`)
    return
  }
  if (kind === 'budgetBonus') {
    state.budget += 75
    addEvent(state, 'Budget bonus! +$75')
    return
  }
  if (kind === 'deviceSurge') {
    spawnDevice(state)
    spawnDevice(state)
    addEvent(state, 'Device surge! Two new devices joined the network.')
    return
  }
  // equipmentFailure: fail a worn, online infrastructure device outright.
  const candidates = state.devices.filter(
    (device) =>
      ['router', 'switch', 'wireless', 'firewall'].includes(device.kind) && !device.offline,
  )
  if (!candidates.length) return
  const target = candidates[Math.floor(Math.random() * candidates.length)]
  // Failure probability scales with accumulated wear: fresh gear rarely fails.
  const failChance = Math.min(90, 15 + target.wear)
  if (Math.random() * 100 >= failChance) return
  target.health = 0
  target.wear += 30
  target.offline = true
  state.packets = []
  addEvent(state, `${target.label} failed! Repair or replace it.`)
}

/**
 * Decrements timed events, announces expirations, and drops spent entries.
 *
 * @param state - Mutable simulation draft.
 * @returns Nothing; active events are updated in place.
 */
function tickActiveEvents(state: GameState) {
  for (const event of state.activeEvents) {
    event.ticksRemaining--
    if (event.ticksRemaining <= 0 && event.kind === 'trafficSpike') {
      const target = state.devices.find((device) => device.id === event.targetId)
      addEvent(state, `Traffic spike on ${target?.label ?? 'device'} subsided.`)
    }
  }
  state.activeEvents = state.activeEvents.filter((event) => event.ticksRemaining > 0)
}

/**
 * Random Wi-Fi interference: active access points occasionally lose range and
 * throughput for a stretch of ticks, making wireless less dependable than a
 * wired link. Mirrors the native `tickWirelessInterference`.
 *
 * @param state - Mutable simulation draft.
 * @returns Nothing; access-point interference state is updated in place.
 */
function tickWirelessInterference(state: GameState) {
  for (const device of state.devices) {
    if (device.kind !== 'wireless') continue
    if (device.interference > 0) {
      device.interference--
      if (device.interference === 0) {
        addEvent(state, `${device.label} interference cleared.`)
      }
      continue
    }
    if (device.offline) continue
    // Hubs actually serving clients are more exposed to interference.
    const serving = state.devices.some(
      (candidate) =>
        WIRELESS_CAPABLE_KINDS.includes(candidate.kind) &&
        !candidate.offline &&
        distanceBetween(candidate, device) <= hubRange(device),
    )
    const chancePerTick = serving ? 0.007 : 0.002
    if (Math.random() < chancePerTick) {
      device.interference = 8 + Math.floor(Math.random() * 11) // 8-18 ticks
      addEvent(state, `${device.label} hit by Wi-Fi interference — range & speed cut.`)
    }
  }
}

/**
 * Awards each delivery-count milestone once.
 *
 * @param state - Mutable simulation draft.
 * @returns Nothing; rewards and milestone history are updated in place.
 */
function checkMilestones(state: GameState) {
  const milestones = MILESTONES[state.scenario] ?? MILESTONES.home
  for (const milestone of milestones) {
    if (state.delivered < milestone.at || state.milestonesReached.includes(milestone.at)) continue
    state.milestonesReached.push(milestone.at)
    state.budget += milestone.award
    addEvent(state, `Milestone: ${milestone.at} packets delivered! +$${milestone.award}`)
  }
}

/**
 * Advances the deterministic game model by one simulation tick.
 *
 * The reducer never mutates the caller's object. Its phases mirror the native
 * engine: advance packets, account for link/device load, generate traffic,
 * update pressure/economy, then evaluate progression and game over.
 *
 * @param state - Current immutable game snapshot.
 * @returns The next game snapshot, or the same object when simulation is not playing.
 */
export function simulate(state: GameState): GameState {
  if (state.phase !== 'playing') return state
  const nextState = cloneState(state)
  const scenarioConfig =
    SCENARIOS.find((scenario) => scenario.id === nextState.scenario) ?? SCENARIOS[0]

  nextState.tick++
  nextState.cables.forEach((networkCable) => {
    networkCable.load = 0
    networkCable.age++
    if (networkCable.failedTicks > 0 && --networkCable.failedTicks === 0) {
      networkCable.status = 'idle'
    } else if (!networkCable.failedTicks) {
      networkCable.status = 'idle'
    }
  })

  let packetsDroppedThisTick = 0
  // Packets that finish traversing their current cable this tick try to arrive
  // at path[hop + 1]. Forwarding devices (router/switch/wireless/firewall)
  // admit only as many as their PPS allows, in strict priority order
  // (realtime > stream > bulk); the rest wait in a real per-device queue
  // instead of vanishing, and are dropped only after `QUEUE_CAPACITY_TICKS`.
  const arrivingByDevice = new Map<string, Packet[]>()
  const steadyPackets: Packet[] = []
  for (const activePacket of nextState.packets) {
    // A rejected packet remains for one simulation interval so PacketLayer can
    // play the burst/fade animation at the firewall, then disappears.
    if (activePacket.droppingAtFirewall) continue
    if (activePacket.progress + 0.5 < 1) {
      activePacket.progress += 0.5
      steadyPackets.push(activePacket)
      continue
    }
    const arrivingDeviceId = activePacket.path[activePacket.hop + 1]
    const arrivals = arrivingByDevice.get(arrivingDeviceId) ?? []
    arrivals.push(activePacket)
    arrivingByDevice.set(arrivingDeviceId, arrivals)
  }

  const admittedPackets: Packet[] = []
  const requeuedPackets: Packet[] = []
  const firewallDropPackets: Packet[] = []
  for (const [arrivingDeviceId, arrivals] of arrivingByDevice) {
    let eligibleArrivals = arrivals
    const arrivingDevice = nextState.devices.find((device) => device.id === arrivingDeviceId)
    if (arrivingDevice?.kind === 'firewall') {
      const allowedArrivals: Packet[] = []
      for (const arrivingPacket of arrivals) {
        const owner = nextState.devices.find(
          (device) => device.id === (arrivingPacket.owner ?? arrivingPacket.source),
        )
        if (owner && arrivingDevice.firewallRules.includes(owner.kind)) {
          arrivingPacket.progress = 0
          arrivingPacket.hop++
          arrivingPacket.droppingAtFirewall = true
          firewallDropPackets.push(arrivingPacket)
          packetsDroppedThisTick++
        } else allowedArrivals.push(arrivingPacket)
      }
      eligibleArrivals = allowedArrivals
      if (eligibleArrivals.length === 0) continue
    }
    if (!arrivingDevice || !FORWARDING_KINDS.includes(arrivingDevice.kind)) {
      admittedPackets.push(...eligibleArrivals)
      continue
    }
    const capacity = deviceCapacity(arrivingDevice)
    const ordered = [...eligibleArrivals].sort(
      (a, b) => PRIORITY_WEIGHT[b.priority] - PRIORITY_WEIGHT[a.priority],
    )
    admittedPackets.push(...ordered.slice(0, capacity))
    const overflow = ordered.slice(capacity)
    for (const overflowPacket of overflow) {
      overflowPacket.queuedTicks++
      if (overflowPacket.queuedTicks > QUEUE_CAPACITY_TICKS) packetsDroppedThisTick++
      else requeuedPackets.push(overflowPacket)
    }
    if (overflow.length > 0) {
      arrivingDevice.wear++
      if (scenarioConfig.equipmentFailure && arrivingDevice.wear > 20) {
        const healthLoss = Math.max(1, Math.floor(arrivingDevice.wear / 25))
        arrivingDevice.health = Math.max(0, arrivingDevice.health - healthLoss)
        arrivingDevice.offline = arrivingDevice.health === 0
      }
    }
  }
  for (const admittedPacket of admittedPackets) {
    admittedPacket.progress = 0
    admittedPacket.hop++
  }
  // Requeued packets keep their pre-arrival progress so they retry admission
  // next tick instead of restarting their cable traversal from the source.
  nextState.packets = [
    ...steadyPackets,
    ...admittedPackets,
    ...requeuedPackets,
    ...firewallDropPackets,
  ]

  const deliveredPackets = nextState.packets.filter(
    (activePacket) => activePacket.hop >= activePacket.path.length - 1,
  )
  const inFlightPackets = nextState.packets.filter(
    (activePacket) => activePacket.hop < activePacket.path.length - 1,
  )
  nextState.packets = inFlightPackets
  nextState.delivered += deliveredPackets.length

  // Wireless association only depends on device position/status, which is
  // fixed for the remainder of this tick (newly spawned devices don't
  // generate traffic until next tick) — resolve it once and share it across
  // every redundancy check and route lookup below instead of per packet.
  const wirelessAssociations = buildWirelessAssociations(nextState)
  const redundancyMemo = new Map<string, number>()
  for (const deliveredPacket of deliveredPackets) {
    const ownerDevice = nextState.devices.find(
      (device) => device.id === (deliveredPacket.owner ?? deliveredPacket.source),
    )
    if (ownerDevice) ownerDevice.delivered++
    const routeSourceId = deliveredPacket.path[0]
    const destinationId = deliveredPacket.path[deliveredPacket.path.length - 1]
    const redundancyKey = `${routeSourceId}|${destinationId}`
    let pathCount = redundancyMemo.get(redundancyKey)
    if (pathCount === undefined) {
      pathCount = independentPathCount(
        nextState,
        routeSourceId,
        destinationId,
        wirelessAssociations,
      )
      redundancyMemo.set(redundancyKey, pathCount)
    }
    const redundancyBonus = pathCount >= 2 ? 5 : 0
    nextState.score += 10 * nextState.multiplier * nextState.combo + redundancyBonus
    const latency = Math.max(0, nextState.tick - deliveredPacket.generatedTick)
    nextState.recentLatencyTicks =
      nextState.recentLatencyTicks === 0
        ? latency
        : nextState.recentLatencyTicks * 0.75 + latency * 0.25
    nextState.recentQueueDelayTicks =
      nextState.recentQueueDelayTicks === 0
        ? deliveredPacket.queuedTicks
        : nextState.recentQueueDelayTicks * 0.75 + deliveredPacket.queuedTicks * 0.25
  }

  for (const activePacket of inFlightPackets) {
    const currentDeviceId = activePacket.path[activePacket.hop]
    const nextDeviceId = activePacket.path[activePacket.hop + 1]
    const activeCable = nextState.cables.find(
      (networkCable) =>
        (networkCable.from === currentDeviceId && networkCable.to === nextDeviceId) ||
        (networkCable.to === currentDeviceId && networkCable.from === nextDeviceId),
    )
    if (activeCable) activeCable.load++
  }

  const cloud = nextState.devices.find((device) => device.kind === 'cloud')!
  const router = nextState.devices.find((device) => device.kind === 'router')!
  const warmup = warmupFactor(nextState.tick, scenarioConfig)
  const sourceDevices = nextState.devices.filter((device) => DEVICE_RULES[device.kind].rate > 0)
  for (const sourceDevice of sourceDevices) {
    const requestedTraffic =
      DEVICE_RULES[sourceDevice.kind].rate *
      nextState.rate *
      warmup *
      trafficSpikeMultiplier(nextState, sourceDevice.id)
    const packetAttempts =
      Math.floor(requestedTraffic) + (Math.random() < requestedTraffic % 1 ? 1 : 0)
    for (let attempt = 0; attempt < packetAttempts; attempt++) {
      if (Math.random() > 0.24) continue
      // Each demand unit is a two-way exchange: the initiating request and
      // its response both consume real network capacity.
      sourceDevice.generated += 2
      let route = findRoute(nextState, sourceDevice.id, cloud.id, wirelessAssociations)
      // 30% of traffic in multi-subnet scenarios targets another device on the
      // network (e.g. desk-to-server) instead of the cloud, routed via the router.
      if (scenarioConfig.id !== 'home' && Math.random() < 0.3) {
        const crossDest = pickCrossSubnetDest(nextState, sourceDevice)
        if (crossDest) {
          const crossRoute = findRouteThrough(
            nextState,
            sourceDevice.id,
            router.id,
            crossDest.id,
            wirelessAssociations,
          )
          if (crossRoute) route = crossRoute
        }
      }
      if (route) {
        const destination = nextState.devices.find((device) => device.id === route.at(-1))!
        nextState.packets.push(
          packet(sourceDevice, route, nextState.tick),
          packet(destination, [...route].reverse(), nextState.tick, sourceDevice),
        )
      } else {
        // If firewall policy is the only thing preventing a route, create the
        // exchange on that physical path. It will visibly terminate when it
        // reaches the blocking firewall instead of disappearing at the source.
        const blockedRoute = findRoute(
          nextState,
          sourceDevice.id,
          cloud.id,
          wirelessAssociations,
          true,
        )
        if (blockedRoute) {
          nextState.packets.push(
            packet(sourceDevice, blockedRoute, nextState.tick),
            packet(cloud, [...blockedRoute].reverse(), nextState.tick, sourceDevice),
          )
        } else packetsDroppedThisTick += 2
      }
    }
  }

  for (const networkCable of nextState.cables) {
    if (!networkCable.load) continue
    networkCable.status = networkCable.load > networkCable.capacity ? 'congested' : 'active'
    if (networkCable.status === 'congested') {
      packetsDroppedThisTick += Math.max(0, networkCable.load - networkCable.capacity)
    }
  }

  nextState.dropped += packetsDroppedThisTick
  nextState.recentDrops.push(packetsDroppedThisTick)
  if (nextState.recentDrops.length > 20) nextState.recentDrops.shift()
  const rollingDropTotal = nextState.recentDrops.reduce((total, drops) => total + drops, 0)
  nextState.failure = Math.min(100, (rollingDropTotal / 30) * 100)

  if (packetsDroppedThisTick === 0) {
    nextState.cleanTicks++
    nextState.combo = Math.min(5, 1 + Math.floor(nextState.cleanTicks / 5))
  } else if (packetsDroppedThisTick >= 3) {
    nextState.cleanTicks = 0
    nextState.combo = 1
  }

  if (nextState.tick % 15 === 0) {
    const income = 25 + 5 * nextState.multiplier
    nextState.budget += income
    addEvent(nextState, `Budget allocation received: +$${income}`)
  }
  if (nextState.tick % 90 === 0) nextState.multiplier++
  if (nextState.tick >= scenarioConfig.rampStart && nextState.tick % 90 === 0) {
    nextState.rate = Math.min(2.25, nextState.rate * 1.04)
  }
  if (nextState.tick >= scenarioConfig.spawnStart && nextState.tick % 150 === 0) {
    spawnDevice(nextState)
  }

  if (scenarioConfig.equipmentFailure && nextState.rate >= 2 && nextState.tick % 90 === 0) {
    const faultCandidates = nextState.cables.filter(
      (networkCable) =>
        !networkCable.failedTicks &&
        nextState.devices.find((device) => device.id === networkCable.from)?.kind !== 'router',
    )
    const failedCable = faultCandidates[Math.floor(Math.random() * faultCandidates.length)]
    if (failedCable) {
      failedCable.status = 'failed'
      failedCable.failedTicks = 4
      addEvent(nextState, 'Cable fault — rerouting traffic for 4 ticks.')
    }
  }

  // Warn equipment-failure scenarios 5 ticks before challenge events begin.
  if (scenarioConfig.equipmentFailure && nextState.tick === scenarioConfig.challengeStart - 5) {
    addEvent(nextState, 'Network stress event imminent — check your infrastructure.')
  }
  if (
    nextState.tick >= scenarioConfig.challengeStart &&
    (nextState.tick - scenarioConfig.challengeStart) % 90 === 0
  ) {
    rollChallengeEvent(nextState, scenarioConfig)
  }
  tickActiveEvents(nextState)
  checkMilestones(nextState)
  tickWirelessInterference(nextState)

  const shouldEndRun =
    !nextState.unscored &&
    nextState.tick >= scenarioConfig.gameOverCheck &&
    nextState.recentDrops.length === 20 &&
    rollingDropTotal > 30
  if (shouldEndRun) {
    nextState.phase = 'gameover'
    const healthBonus = networkHealthBonus(nextState)
    nextState.score += healthBonus
    addEvent(
      nextState,
      `Network failure threshold exceeded.${healthBonus ? ` Network health bonus: +${healthBonus}.` : ''}`,
    )
  }
  nextState.events = nextState.events.slice(0, 6)
  return nextState
}
