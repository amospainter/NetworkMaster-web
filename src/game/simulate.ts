import type { Device, GameState, Packet, Scenario } from '../types'
import {
  CACHE_HIT_CHANCE,
  CACHE_HIT_RATE_MAX,
  CACHE_HIT_RATE_STEP,
  DDOS_DURATION_TICKS,
  DDOS_RATE,
  DEVICE_RULES,
  FORWARDING_KINDS,
  HISTORY_SAMPLE_CAP,
  HONEYPOT_ABSORB_SCORE,
  HONEYPOT_LURE_CHANCE,
  HOSTILE_EVENT_GRACE_WINDOWS,
  METERED_BASE_INCOME,
  METERED_INCOME_CAP_MULTIPLIER,
  METERED_RATE_CENTS,
  MILESTONES,
  OUTAGE_DURATION_TICKS,
  OUTAGE_RADIUS,
  PEAK_AMPLITUDE,
  PEAK_PERIOD_TICKS,
  PRIORITY_WEIGHT,
  QUEUE_CAPACITY_TICKS,
  REPEATER_LATENCY_PENALTY,
  SCENARIOS,
  SOURCE_SPAWN_ORDER,
  WIRELESS_CAPABLE_KINDS,
  WIRELESS_ONLY_KINDS,
} from './constants'
import { createDevice } from './factories'
import { networkHealthBonus } from './persistence'
import { findRoute, findRouteThrough, independentPathCount, pickCrossSubnetDest } from './routing'
import { addEvent, chance, cloneState, createId, distanceBetween } from './utils'
import {
  buildWirelessAssociations,
  deviceCapacity,
  hubRange,
  isServedViaRepeater,
} from './wireless'

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
 * A slow sine wave layered on top of warmup/ramp demand, simulating a daily
 * peak/quiet rhythm. Starts at 1 and rises first, so the opening minutes stay
 * governed by warmup rather than immediately swinging low.
 *
 * @param tick - Current simulation tick.
 * @param scenario - Active scenario; `peakAmplitude` overrides the global default.
 * @returns Demand multiplier centered on 1.
 */
function peakFactor(tick: number, scenario: Scenario): number {
  const amplitude = scenario.peakAmplitude ?? PEAK_AMPLITUDE
  return 1 + amplitude * Math.sin((2 * Math.PI * tick) / PEAK_PERIOD_TICKS)
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
 * Creates a one-way DDoS junk packet from the Cloud Edge toward its attack
 * target. Unlike real traffic, junk has no return-trip response packet.
 *
 * @param source - Attack origin (the Cloud Edge).
 * @param path - Precomputed device-id route toward the target or a lured honeypot.
 * @param tick - Generation tick.
 * @returns A new junk packet positioned at the start of its route.
 */
function junkPacket(source: Device, path: string[], tick: number): Packet {
  return {
    id: createId(),
    path,
    hop: 0,
    progress: 0,
    priority: 'bulk',
    owner: source.id,
    source: source.id,
    generatedTick: tick,
    queuedTicks: 0,
    junk: true,
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
 * equipment failure; the others can occur in any scenario. DDoS and power
 * outage additionally require the scenario's first `HOSTILE_EVENT_GRACE_WINDOWS`
 * roll windows to have already passed, so a run always gets a settling-in
 * period before hostile events can appear.
 *
 * @param state - Mutable simulation draft.
 * @param scenario - Active scenario configuration.
 * @returns Nothing; any selected event is applied to the draft.
 */
function rollChallengeEvent(state: GameState, scenario: Scenario) {
  const priorRollCount = state.challengeRollCount
  state.challengeRollCount++
  const hostileEventsEligible =
    scenario.equipmentFailure && priorRollCount >= HOSTILE_EVENT_GRACE_WINDOWS

  const roll = Math.random() * 100
  let kind:
    'trafficSpike' | 'budgetBonus' | 'deviceSurge' | 'equipmentFailure' | 'ddos' | 'powerOutage'
  if (hostileEventsEligible) {
    if (roll < 25) kind = 'trafficSpike'
    else if (roll < 40) kind = 'ddos'
    else if (roll < 50) kind = 'powerOutage'
    else if (roll < 75) kind = 'equipmentFailure'
    else if (roll < 90) kind = 'budgetBonus'
    else kind = 'deviceSurge'
  } else {
    if (roll < 35) kind = 'trafficSpike'
    else if (roll < 70) kind = scenario.equipmentFailure ? 'equipmentFailure' : 'budgetBonus'
    else if (roll < 90) kind = 'budgetBonus'
    else kind = 'deviceSurge'
  }

  if (kind === 'ddos') {
    const candidates = state.devices.filter((device) => device.kind === 'switch' && !device.offline)
    if (!candidates.length) return
    const target = candidates[Math.floor(Math.random() * candidates.length)]
    state.activeEvents.push({
      id: createId(),
      kind: 'ddos',
      ticksRemaining: DDOS_DURATION_TICKS,
      targetId: target.id,
    })
    addEvent(
      state,
      `DDoS attack detected — junk traffic is flooding ${target.label}'s subnet for ${DDOS_DURATION_TICKS} ticks.`,
    )
    return
  }
  if (kind === 'powerOutage') {
    const centerX = 15 + Math.random() * 70
    const centerY = 15 + Math.random() * 70
    const affected = state.devices.filter(
      (device) =>
        device.kind !== 'cloud' &&
        !device.ups &&
        !device.offline &&
        distanceBetween(device, { x: centerX, y: centerY } as Device) <= OUTAGE_RADIUS,
    )
    if (!affected.length) return
    affected.forEach((device) => (device.offline = true))
    state.activeEvents.push({
      id: createId(),
      kind: 'powerOutage',
      ticksRemaining: OUTAGE_DURATION_TICKS,
      targetId: null,
      affectedIds: affected.map((device) => device.id),
      centerX,
      centerY,
    })
    addEvent(
      state,
      `Power outage! ${affected.length} device${affected.length === 1 ? '' : 's'} offline for ${OUTAGE_DURATION_TICKS} ticks.`,
    )
    return
  }
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
    if (event.ticksRemaining > 0) continue
    if (event.kind === 'trafficSpike') {
      const target = state.devices.find((device) => device.id === event.targetId)
      addEvent(state, `Traffic spike on ${target?.label ?? 'device'} subsided.`)
    } else if (event.kind === 'ddos') {
      const target = state.devices.find((device) => device.id === event.targetId)
      addEvent(state, `DDoS attack against ${target?.label ?? 'the subnet'} subsided.`)
    } else if (event.kind === 'powerOutage') {
      // Only restore devices this event actually downed and that haven't
      // separately failed since (health 0 from equipment failure stays down).
      const restored = (event.affectedIds ?? []).filter((id) => {
        const device = state.devices.find((candidate) => candidate.id === id)
        if (!device || device.health <= 0) return false
        device.offline = false
        return true
      })
      addEvent(
        state,
        `Power restored to ${restored.length} device${restored.length === 1 ? '' : 's'}.`,
      )
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
        // Junk (DDoS) traffic is always dropped at any firewall, regardless
        // of that firewall's configured block rules — a firewall positioned
        // between the router and an attack's target subnet absorbs it, at
        // the cost of its own PPS admission budget.
        if (arrivingPacket.junk || (owner && arrivingDevice.firewallRules.includes(owner.kind))) {
          arrivingPacket.progress = 0
          arrivingPacket.hop++
          arrivingPacket.droppingAtFirewall = true
          firewallDropPackets.push(arrivingPacket)
          if (!arrivingPacket.junk) packetsDroppedThisTick++
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
      if (overflowPacket.queuedTicks > QUEUE_CAPACITY_TICKS) {
        if (!overflowPacket.junk) packetsDroppedThisTick++
      } else requeuedPackets.push(overflowPacket)
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
  // Junk arrivals never count toward the player-facing delivered total.
  nextState.delivered += deliveredPackets.filter((deliveredPacket) => !deliveredPacket.junk).length

  // Wireless association only depends on device position/status, which is
  // fixed for the remainder of this tick (newly spawned devices don't
  // generate traffic until next tick) — resolve it once and share it across
  // every redundancy check and route lookup below instead of per packet.
  const wirelessAssociations = buildWirelessAssociations(nextState)
  const redundancyMemo = new Map<string, number>()
  for (const deliveredPacket of deliveredPackets) {
    if (deliveredPacket.junk) {
      // Junk never scores, doesn't touch owner/latency telemetry, and only
      // pays out when a honeypot lured it in — landing on its actual attack
      // target is exactly the harm it's meant to do, not a reward.
      const destination = nextState.devices.find(
        (device) => device.id === deliveredPacket.path.at(-1),
      )
      if (destination?.kind === 'honeypot') nextState.score += HONEYPOT_ABSORB_SCORE
      continue
    }
    const ownerDevice = nextState.devices.find(
      (device) => device.id === (deliveredPacket.owner ?? deliveredPacket.source),
    )
    if (ownerDevice) ownerDevice.delivered++
    const routeSourceId = deliveredPacket.path[0]
    const destinationId = deliveredPacket.path[deliveredPacket.path.length - 1]
    // A cache hit's destination is the cache itself rather than the Cloud
    // Edge; incrementing its own `delivered` gives a free "hits served" stat
    // reusing the existing per-device counter instead of a new field.
    const destinationDevice = nextState.devices.find((device) => device.id === destinationId)
    if (destinationDevice?.kind === 'cache') destinationDevice.delivered++
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
    if (scenarioConfig.meteredIncome)
      nextState.windowIncomeCents += METERED_RATE_CENTS[deliveredPacket.priority]
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

  const junkLoadByCable = new Map<string, number>()
  for (const activePacket of inFlightPackets) {
    const currentDeviceId = activePacket.path[activePacket.hop]
    const nextDeviceId = activePacket.path[activePacket.hop + 1]
    const activeCable = nextState.cables.find(
      (networkCable) =>
        (networkCable.from === currentDeviceId && networkCable.to === nextDeviceId) ||
        (networkCable.to === currentDeviceId && networkCable.from === nextDeviceId),
    )
    if (activeCable) {
      activeCable.load++
      if (activePacket.junk)
        junkLoadByCable.set(activeCable.id, (junkLoadByCable.get(activeCable.id) ?? 0) + 1)
    }
  }

  const cloud = nextState.devices.find((device) => device.kind === 'cloud')!
  const router = nextState.devices.find((device) => device.kind === 'router')!
  const warmup = warmupFactor(nextState.tick, scenarioConfig)
  const sourceDevices = nextState.devices.filter((device) => DEVICE_RULES[device.kind].rate > 0)
  const onlineCaches = nextState.devices.filter(
    (device) => device.kind === 'cache' && !device.offline,
  )
  for (const sourceDevice of sourceDevices) {
    const requestedTraffic =
      DEVICE_RULES[sourceDevice.kind].rate *
      nextState.rate *
      warmup *
      peakFactor(nextState.tick, scenarioConfig) *
      trafficSpikeMultiplier(nextState, sourceDevice.id)
    const packetAttempts =
      Math.floor(requestedTraffic) + (Math.random() < requestedTraffic % 1 ? 1 : 0)
    const priority = DEVICE_RULES[sourceDevice.kind].priority
    const hubId = wirelessAssociations.get(sourceDevice.id)
    const repeaterPenalty =
      hubId && isServedViaRepeater(nextState, sourceDevice.id, hubId) ? REPEATER_LATENCY_PENALTY : 0
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
      // A bulk/stream Cloud-bound exchange may instead be served by a
      // same-subnet cache, a much shorter round trip that never touches the
      // router/uplink. Realtime traffic and cross-subnet traffic are
      // unaffected — this only swaps the destination while it's still cloud-bound.
      if (route && route.at(-1) === cloud.id && priority !== 'realtime') {
        const sameSubnetCache = onlineCaches.find((cache) => cache.subnet === sourceDevice.subnet)
        if (sameSubnetCache) {
          const hitChance = Math.min(
            CACHE_HIT_RATE_MAX,
            CACHE_HIT_CHANCE + sameSubnetCache.cacheLevel * CACHE_HIT_RATE_STEP,
          )
          if (chance(hitChance)) {
            const cacheRoute = findRoute(
              nextState,
              sourceDevice.id,
              sameSubnetCache.id,
              wirelessAssociations,
            )
            if (cacheRoute) route = cacheRoute
          }
        }
      }
      if (route) {
        const destination = nextState.devices.find((device) => device.id === route.at(-1))!
        const requestPacket = packet(sourceDevice, route, nextState.tick)
        const responsePacket = packet(
          destination,
          [...route].reverse(),
          nextState.tick,
          sourceDevice,
        )
        if (repeaterPenalty) {
          requestPacket.queuedTicks += repeaterPenalty
          responsePacket.queuedTicks += repeaterPenalty
        }
        nextState.packets.push(requestPacket, responsePacket)
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

  // DDoS junk traffic: emitted every tick an attack is active, independent of
  // the normal per-source traffic loop above (the Cloud Edge is the source,
  // not a player device). A lured packet's route is recomputed once per
  // packet since honeypot reachability can differ per candidate.
  for (const activeDdos of nextState.activeEvents) {
    if (activeDdos.kind !== 'ddos') continue
    const targetSwitch = nextState.devices.find((device) => device.id === activeDdos.targetId)
    if (!targetSwitch || targetSwitch.offline) continue
    for (let junkIndex = 0; junkIndex < DDOS_RATE; junkIndex++) {
      let route: string[] | null = null
      if (chance(HONEYPOT_LURE_CHANCE)) {
        const honeypots = nextState.devices.filter(
          (device) => device.kind === 'honeypot' && !device.offline,
        )
        let shortestHoneypotRoute: string[] | null = null
        for (const honeypot of honeypots) {
          const honeypotRoute = findRoute(nextState, cloud.id, honeypot.id, wirelessAssociations)
          if (
            honeypotRoute &&
            (!shortestHoneypotRoute || honeypotRoute.length < shortestHoneypotRoute.length)
          )
            shortestHoneypotRoute = honeypotRoute
        }
        route = shortestHoneypotRoute
      }
      if (!route) route = findRoute(nextState, cloud.id, targetSwitch.id, wirelessAssociations)
      // No route at all (neither honeypot nor target reachable) simply means
      // the junk packet never materializes — junk drops never count anyway.
      if (route) nextState.packets.push(junkPacket(cloud, route, nextState.tick))
    }
  }

  for (const networkCable of nextState.cables) {
    if (!networkCable.load) continue
    networkCable.status = networkCable.load > networkCable.capacity ? 'congested' : 'active'
    if (networkCable.status === 'congested') {
      // Junk still congests the link (that's the displacement damage a DDoS
      // does to real traffic sharing it), but this aggregate loss estimate
      // can't tell which specific packets were dropped — so junk's own share
      // of the loss, proportional to its share of this cable's load, is
      // excluded from the real drop/failure-pressure count.
      const totalExcess = Math.max(0, networkCable.load - networkCable.capacity)
      const junkOnCable = junkLoadByCable.get(networkCable.id) ?? 0
      const junkShare =
        networkCable.load > 0 ? Math.round(totalExcess * (junkOnCable / networkCable.load)) : 0
      packetsDroppedThisTick += Math.max(0, totalExcess - junkShare)
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
    const flatAllocation = 25 + 5 * nextState.multiplier
    if (scenarioConfig.meteredIncome) {
      const cap = flatAllocation * METERED_INCOME_CAP_MULTIPLIER
      const income = Math.round(
        Math.min(cap, METERED_BASE_INCOME + nextState.windowIncomeCents / 100),
      )
      nextState.budget += income
      nextState.windowIncomeCents = 0
      addEvent(nextState, `Metered income: +$${income}`)
    } else {
      nextState.budget += flatAllocation
      addEvent(nextState, `Budget allocation received: +$${flatAllocation}`)
    }
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
    nextState.mode !== 'sandbox' &&
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
  recordHistorySample(nextState)
  return nextState
}

/**
 * Appends one telemetry sample per stride to `GameState.history`, halving the
 * sample set and doubling the stride once the cap is reached. This keeps a
 * long run's full shape visible at decreasing resolution instead of losing
 * its opening ticks to a hard cutoff.
 *
 * @param state - Mutable simulation draft.
 * @returns Nothing; `history`/`historyStride` are updated in place.
 */
function recordHistorySample(state: GameState) {
  if (state.tick % state.historyStride !== 0) return
  state.history.push({
    t: state.tick,
    s: state.score,
    f: Math.round(state.failure),
    l: Math.round(state.recentLatencyTicks * 10) / 10,
  })
  if (state.history.length > HISTORY_SAMPLE_CAP) {
    state.history = state.history.filter((_, index) => index % 2 === 0)
    state.historyStride *= 2
  }
}
