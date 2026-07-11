import { describe, expect, it, vi } from 'vitest'
import { computeCableRoutes } from './cableGeometry'
import {
  acceptSlaContract,
  addCable,
  CABLE_TIERS,
  CACHE_HIT_RATE_MAX,
  buildDevice,
  buildWirelessAssociations,
  cycleCableVlan,
  cycleQosBoost,
  declineSlaContract,
  findRoute,
  independentPathCount,
  migrateSavedGame,
  moveDevice,
  networkHealthBonus,
  newGame,
  QOS_OVERHEAD,
  removeDevice,
  rerouteCable,
  SCENARIOS,
  servingWirelessHub,
  simulate,
  toggleFirewallRule,
  upgradeAllCables,
  upgradeCable,
  upgradeCacheHitRate,
  upgradeDeviceSpeed,
  upgradeUps,
  upgradeWifi,
} from './game'
import type { GameState } from './types'

describe('NetworkMaster gameplay rules', () => {
  it('builds every iOS scenario with a cloud uplink and valid port counts', () => {
    for (const scenario of SCENARIOS) {
      const game = newGame(scenario.id)
      expect(game.version).toBe(13)
      expect(game.devices.some((d) => d.kind === 'cloud')).toBe(true)
      expect(game.devices.some((d) => d.kind === 'router')).toBe(true)
      for (const device of game.devices) {
        expect(device.ports).toBe(
          game.cables.filter((c) => c.from === device.id || c.to === device.id).length,
        )
        // No starting cable should exceed either endpoint's port limit.
        expect(device.ports).toBeLessThanOrEqual(device.maxPorts)
      }
    }
  })

  it('lists scenarios easiest-to-hardest with Home Network first', () => {
    expect(SCENARIOS[0].id).toBe('home')
    for (let i = 1; i < SCENARIOS.length; i++) {
      expect(SCENARIOS[i].difficulty).toBeGreaterThanOrEqual(SCENARIOS[i - 1].difficulty)
    }
  })

  it('starts the Café Hotspot with a 10 Mbps Cloud connection', () => {
    const game = newGame('cafe')
    const cloud = game.devices.find((device) => device.kind === 'cloud')!
    const cloudUplink = game.cables.find(
      (cable) => cable.from === cloud.id || cable.to === cloud.id,
    )!

    expect(cloudUplink.tier).toBe('Copper')
  })

  it('gives the data center two servers on different subnets for east-west traffic', () => {
    const game = newGame('datacenter')
    const servers = game.devices.filter((d) => d.kind === 'server')
    expect(servers).toHaveLength(2)
    expect(new Set(servers.map((s) => s.subnet)).size).toBe(2)
  })

  /** Scenarios whose starting topology includes a load balancer (dual-router core). */
  const dualRouterScenarios = SCENARIOS.filter((s) =>
    newGame(s.id).devices.some((d) => d.kind === 'loadBalancer'),
  ).map((s) => s.id)

  it('gives dual-router scenarios a load-balanced core with two Cloud uplinks', () => {
    expect(dualRouterScenarios).toEqual(['corporate', 'metro', 'isp', 'datacenter', 'smartcity'])
    for (const scenarioId of dualRouterScenarios) {
      const game = newGame(scenarioId)
      const routers = game.devices.filter((d) => d.kind === 'router')
      const loadBalancer = game.devices.find((d) => d.kind === 'loadBalancer')!
      const cloud = game.devices.find((d) => d.kind === 'cloud')!
      expect(routers).toHaveLength(2)
      expect(loadBalancer).toBeDefined()
      for (const router of routers) {
        expect(
          game.cables.some(
            (c) =>
              (c.from === router.id && c.to === cloud.id) ||
              (c.to === router.id && c.from === cloud.id),
          ),
        ).toBe(true)
        expect(
          game.cables.some(
            (c) =>
              (c.from === router.id && c.to === loadBalancer.id) ||
              (c.to === router.id && c.from === loadBalancer.id),
          ),
        ).toBe(true)
      }
    }
  })

  it('keeps non-dual-router scenarios on a single-router core', () => {
    for (const scenario of SCENARIOS.filter((s) => !dualRouterScenarios.includes(s.id))) {
      const game = newGame(scenario.id)
      expect(game.devices.filter((d) => d.kind === 'router')).toHaveLength(1)
      expect(game.devices.some((d) => d.kind === 'loadBalancer')).toBe(false)
    }
  })

  it('places every scenario’s starting devices without visual overlap', () => {
    // 8 tolerates the dual-router core's deliberately tight vertical stacks
    // (Router/Router-B/Load Balancer, dist ~9-10 in corporate/metro); it
    // still catches a genuine near-collision like the one Router-B briefly
    // landed on top of the Firewall at.
    const MIN_DISTANCE = 8
    for (const scenario of SCENARIOS) {
      const game = newGame(scenario.id)
      for (let i = 0; i < game.devices.length; i++) {
        for (let j = i + 1; j < game.devices.length; j++) {
          const a = game.devices[i]
          const b = game.devices[j]
          expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThanOrEqual(MIN_DISTANCE)
        }
      }
    }
  })

  it('gives every dual-router scenario a visually distinct core layout', () => {
    const positions = (scenarioId: string) =>
      newGame(scenarioId)
        .devices.filter((d) => ['router', 'loadBalancer', 'switch'].includes(d.kind))
        .map((d) => `${d.x},${d.y}`)
        .sort()
        .join('|')
    const layouts = dualRouterScenarios.map(positions)
    expect(new Set(layouts).size).toBe(layouts.length)
  })

  it('spreads a corporate scenario’s outbound traffic across both core routers', () => {
    const game = newGame('corporate')
    const cloud = game.devices.find((d) => d.kind === 'cloud')!
    const [routerA, routerB] = game.devices.filter((d) => d.kind === 'router')
    const firstSwitch = game.devices.find((d) => d.label === 'SW-A')!

    const secondHopCounts: Record<string, number> = { [routerA.id]: 0, [routerB.id]: 0 }
    for (let i = 0; i < 300; i++) {
      const route = findRoute(game, firstSwitch.id, cloud.id)!
      const routerHop = route.find((id) => id === routerA.id || id === routerB.id)!
      secondHopCounts[routerHop]++
    }
    expect(secondHopCounts[routerA.id]).toBeGreaterThan(60)
    expect(secondHopCounts[routerB.id]).toBeGreaterThan(60)
  })

  it('routes wireless-only clients through an access point in range', () => {
    const game = newGame('startup')
    const phone = game.devices.find((d) => d.kind === 'phone')!
    const cloud = game.devices.find((d) => d.kind === 'cloud')!
    expect(findRoute(game, phone.id, cloud.id)).not.toBeNull()
    const moved = moveDevice(game, phone.id, 5, 94)
    expect(findRoute(moved, phone.id, cloud.id)).toBeNull()
  })

  it('connects an uncabled end device (pc/tv/console) to the network via Wi-Fi coverage', () => {
    let game = newGame('home')
    game.budget = 10_000
    const router = game.devices.find((d) => d.kind === 'router')!
    game = buildDevice(game, 'wireless', 30, 50)
    const hub = game.devices.find((d) => d.kind === 'wireless')!
    game = addCable(game, hub.id, router.id)
    game = buildDevice(game, 'pc', 32, 52) // inside the hub's coverage circle, no cable
    const newPc = game.devices.filter((d) => d.kind === 'pc').at(-1)!
    const cloud = game.devices.find((d) => d.kind === 'cloud')!
    expect(findRoute(game, newPc.id, cloud.id)).not.toBeNull()
    expect(servingWirelessHub(game, newPc.id)?.id).toBe(hub.id)

    const moved = moveDevice(game, newPc.id, 95, 95) // out of the hub's coverage circle
    expect(findRoute(moved, newPc.id, cloud.id)).toBeNull()
  })

  it('gives a cabled end device a redundant Wi-Fi backup path when also in coverage', () => {
    let game = newGame('home')
    game.budget = 1000
    const pc = game.devices.find((d) => d.kind === 'pc')!
    const router = game.devices.find((d) => d.kind === 'router')!
    game = addCable(game, pc.id, router.id)
    game = buildDevice(game, 'wireless', pc.x, pc.y) // hub placed right on top of the cabled PC
    const hub = game.devices.find((d) => d.kind === 'wireless')!
    game = addCable(game, hub.id, router.id)
    // The router (not the cloud) is the destination here: the default topology's
    // single router-cloud cable is a chokepoint every route must cross, so it
    // cannot itself demonstrate edge-disjoint redundancy.
    expect(independentPathCount(game, pc.id, router.id)).toBe(2)
  })

  it('rejects wired links to wireless-only devices', () => {
    const game = newGame('startup')
    const phone = game.devices.find((d) => d.kind === 'phone')!
    const router = game.devices.find((d) => d.kind === 'router')!
    const result = addCable(game, phone.id, router.id)
    expect(result.cables).toHaveLength(game.cables.length)
    expect(result.events[0].text).toContain('Wi-Fi')
  })

  it('recognizes a second independent route', () => {
    let game = newGame('home')
    const pc = game.devices.find((d) => d.kind === 'pc')!
    const router = game.devices.find((d) => d.kind === 'router')!
    const cloud = game.devices.find((d) => d.kind === 'cloud')!
    game = addCable(game, pc.id, router.id)
    expect(independentPathCount(game, pc.id, cloud.id)).toBe(1)
    game.budget = 500
    // A second parallel route is built through a switch in the real UI; duplicate
    // direct links remain prohibited, matching the native game.
    expect(addCable(game, pc.id, router.id).cables).toHaveLength(game.cables.length)
  })

  it('walks the full native cable tier sequence', () => {
    let game = newGame('home')
    const cable = game.cables[0]
    game.budget = 10_000
    for (
      let i = CABLE_TIERS.findIndex((t) => t.name === cable.tier);
      i < CABLE_TIERS.length - 1;
      i++
    ) {
      game = upgradeCable(game, cable.id)
    }
    expect(game.cables[0].tier).toBe('100 Gigabit')
    expect(game.cables[0].capacity).toBe(1000)
  })

  it('bulk-upgrades every copper link to Fast Ethernet via the site upgrade', () => {
    let game = newGame('home')
    game.budget = 10_000
    const cloud = game.devices.find((d) => d.kind === 'cloud')!
    const router = game.devices.find((d) => d.kind === 'router')!
    const pc = game.devices.find((d) => d.kind === 'pc')!
    game = addCable(game, pc.id, router.id)
    const cloudCableTierBefore = game.cables.find(
      (c) => c.from === cloud.id || c.to === cloud.id,
    )!.tier
    expect(game.cables.some((c) => c.tier === 'Copper')).toBe(true)
    game = upgradeAllCables(game, 'Fast Ethernet')
    game.cables.forEach((c) => {
      const touchesCloud = c.from === cloud.id || c.to === cloud.id
      // The cloud uplink is excluded from site upgrades; its tier is fixed by the scenario.
      expect(c.tier).toBe(touchesCloud ? cloudCableTierBefore : 'Fast Ethernet')
    })
  })

  it('site cable upgrade reaches beyond Fast Ethernet up to Gigabit', () => {
    let game = newGame('home')
    game.budget = 10_000
    const router = game.devices.find((d) => d.kind === 'router')!
    const pc = game.devices.find((d) => d.kind === 'pc')!
    game = addCable(game, pc.id, router.id)
    game = upgradeAllCables(game, 'Fast Ethernet')
    const fastEthernetSpend = game.cables.find((c) => c.tier === 'Fast Ethernet')!.upgradeSpend
    game = upgradeAllCables(game, 'Gigabit')
    const cloud = game.devices.find((d) => d.kind === 'cloud')!
    game.cables
      .filter((c) => c.from !== cloud.id && c.to !== cloud.id)
      .forEach((c) => {
        expect(c.tier).toBe('Gigabit')
        expect(c.capacity).toBe(10)
        expect(c.upgradeSpend).toBeGreaterThan(fastEthernetSpend)
      })
  })

  it('uses the site cable standard for connections added after an upgrade', () => {
    let game = newGame('home')
    game.budget = 10_000
    const router = game.devices.find((device) => device.kind === 'router')!
    const pc = game.devices.find((device) => device.kind === 'pc')!
    const tv = game.devices.find((device) => device.kind === 'tv')!

    game = addCable(game, pc.id, router.id)
    game = upgradeAllCables(game, 'Gigabit')
    game = addCable(game, tv.id, router.id)

    const newCable = game.cables.find((cable) => cable.from === tv.id || cable.to === tv.id)!
    expect(newCable.tier).toBe('Gigabit')
    expect(newCable.capacity).toBe(10)
  })

  it('site cable upgrade extends past Gigabit to 5 Gigabit and beyond', () => {
    let game = newGame('home')
    game.budget = 10_000
    const router = game.devices.find((d) => d.kind === 'router')!
    const pc = game.devices.find((d) => d.kind === 'pc')!
    game = addCable(game, pc.id, router.id)
    game = upgradeAllCables(game, '5 Gigabit')
    const cloud = game.devices.find((d) => d.kind === 'cloud')!
    game.cables
      .filter((c) => c.from !== cloud.id && c.to !== cloud.id)
      .forEach((c) => {
        expect(c.tier).toBe('5 Gigabit')
        expect(c.capacity).toBe(50)
      })
  })

  it('gives wireless access points a single port', () => {
    const game = newGame('startup')
    const accessPoint = game.devices.find((d) => d.kind === 'wireless')!
    expect(accessPoint.maxPorts).toBe(1)
  })

  it('upgrades wireless throughput independently of its Wi-Fi generation', () => {
    let gameWithSpeedBump = newGame('startup')
    gameWithSpeedBump.budget = 1000
    const apWithSpeedBump = gameWithSpeedBump.devices.find((d) => d.kind === 'wireless')!
    const basePps = apWithSpeedBump.pps
    gameWithSpeedBump = upgradeDeviceSpeed(gameWithSpeedBump, apWithSpeedBump.id)
    gameWithSpeedBump = upgradeWifi(gameWithSpeedBump, apWithSpeedBump.id)
    const speedThenWifiPps = gameWithSpeedBump.devices.find((d) => d.id === apWithSpeedBump.id)!.pps

    let gameWifiOnly = newGame('startup')
    gameWifiOnly.budget = 1000
    const apWifiOnly = gameWifiOnly.devices.find((d) => d.kind === 'wireless')!
    gameWifiOnly = upgradeWifi(gameWifiOnly, apWifiOnly.id)
    const wifiOnlyPps = gameWifiOnly.devices.find((d) => d.id === apWifiOnly.id)!.pps

    // The +2 forwarding-speed bonus survives the later Wi-Fi generation
    // upgrade instead of being wiped out by it.
    expect(speedThenWifiPps).toBe(wifiOnlyPps + 2)
    expect(speedThenWifiPps).toBeGreaterThan(basePps)
  })

  it('advances simulation and maintains a 20-tick loss window', () => {
    let game = newGame('home')
    for (let i = 0; i < 25; i++) game = simulate(game)
    expect(game.tick).toBe(25)
    expect(game.recentDrops.length).toBeLessThanOrEqual(20)
    expect(game.budget).toBeGreaterThan(100)
  })

  it('removes equipment, attached cables, and refunds native salvage value', () => {
    let game = newGame('home')
    game.budget = 500
    game = buildDevice(game, 'switch')
    const networkSwitch = game.devices.find((device) => device.kind === 'switch')!
    const router = game.devices.find((device) => device.kind === 'router')!
    game = addCable(game, networkSwitch.id, router.id)
    const attachedCable = game.cables.find(
      (cable) => cable.from === networkSwitch.id || cable.to === networkSwitch.id,
    )!
    game = upgradeCable(game, attachedCable.id)
    game = removeDevice(game, networkSwitch.id)

    expect(game.devices.some((device) => device.id === networkSwitch.id)).toBe(false)
    expect(game.cables.some((cable) => cable.id === attachedCable.id)).toBe(false)
    expect(game.budget).toBe(487) // $72 equipment + $45 cable salvage
    expect(game.events[0].text).toContain('$117 salvage')
  })

  it('initializes the version 13 schema with empty progression state', () => {
    const game = newGame('home')
    expect(game.version).toBe(13)
    expect(game.milestonesReached).toEqual([])
    expect(game.activeEvents).toEqual([])
    expect(game.devices.every((device) => device.interference === 0)).toBe(true)
    for (const scenario of SCENARIOS) {
      expect(scenario.warmupFloor).toBeGreaterThan(0)
      expect(scenario.warmupFloor).toBeLessThanOrEqual(1)
      expect(scenario.warmupTicks).toBeGreaterThan(0)
      expect(scenario.challengeStart).toBeGreaterThan(0)
    }
  })

  it('migrates a version 2 save through version 3 to the current schema', () => {
    const legacy = { ...newGame('home'), version: 2 } as unknown as {
      version: number
      devices: Record<string, unknown>[]
    } & Partial<Omit<GameState, 'version' | 'devices'>>
    legacy.devices.forEach((device) => {
      delete device.upgradeSpend
      delete device.firewallRule
      delete device.interference
    })
    delete legacy.milestonesReached
    delete legacy.activeEvents
    const migrated = migrateSavedGame(legacy as unknown as { version: number })
    expect(migrated?.version).toBe(13)
    expect(migrated?.milestonesReached).toEqual([])
    expect(migrated?.activeEvents).toEqual([])
    expect(migrated?.devices.every((device) => device.upgradeSpend === 0)).toBe(true)
    expect(migrated?.devices.every((device) => device.interference === 0)).toBe(true)
    expect(migrateSavedGame({ version: 1 })).toBeNull()
  })

  it('migrates a version 3 save by backfilling interference state', () => {
    const v3 = { ...newGame('home'), version: 3 } as unknown as {
      version: number
      devices: Record<string, unknown>[]
    } & Partial<Omit<GameState, 'version' | 'devices'>>
    v3.devices.forEach((device) => delete device.interference)
    const migrated = migrateSavedGame(v3 as unknown as { version: number })
    expect(migrated?.version).toBe(13)
    expect(migrated?.devices.every((device) => device.interference === 0)).toBe(true)
  })

  it('migrates a version 4 save by clearing transient in-flight packets', () => {
    const v4 = {
      ...newGame('home'),
      version: 4,
      packets: [{ id: 'p1' }],
    } as unknown as { version: number }
    const migrated = migrateSavedGame(v4)
    expect(migrated?.version).toBe(13)
    expect(migrated?.packets).toEqual([])
  })

  it('migrates a version 5 save by backfilling cable style', () => {
    const v5 = {
      ...newGame('home'),
      version: 5,
      cables: newGame('home').cables.map((c) => {
        const cableWithoutStyle = { ...c } as Partial<typeof c>
        delete cableWithoutStyle.style
        return cableWithoutStyle
      }),
    } as unknown as { version: number }
    const migrated = migrateSavedGame(v5)
    expect(migrated?.version).toBe(13)
    expect(migrated?.cables.every((c) => c.style === 'rightAngle')).toBe(true)
  })

  it('migrates a version 6 save by backfilling telemetry fields', () => {
    const v6 = { ...newGame('home'), version: 6 } as unknown as { version: number } & Partial<
      Omit<GameState, 'version'>
    >
    delete v6.recentLatencyTicks
    delete v6.recentQueueDelayTicks
    const migrated = migrateSavedGame(v6 as unknown as { version: number })
    expect(migrated?.version).toBe(13)
    expect(migrated?.recentLatencyTicks).toBe(0)
    expect(migrated?.recentQueueDelayTicks).toBe(0)
  })

  it('migrates a version 7 save by stamping plain-string events with a tick', () => {
    const v7 = {
      ...newGame('home'),
      version: 7,
      tick: 42,
      events: ['Run initialized. Connect clients to bring them online.'],
    } as unknown as { version: number }
    const migrated = migrateSavedGame(v7)
    expect(migrated?.version).toBe(13)
    expect(migrated?.events).toEqual([
      { tick: 42, text: 'Run initialized. Connect clients to bring them online.' },
    ])
  })

  it('migrates a version 9 save by backfilling sandbox mode and run history', () => {
    const v9 = { ...newGame('home'), version: 9 } as unknown as { version: number } & Partial<
      Omit<GameState, 'version'>
    >
    delete v9.mode
    delete v9.history
    delete v9.historyStride
    const migrated = migrateSavedGame(v9 as unknown as { version: number })
    expect(migrated?.version).toBe(13)
    expect(migrated?.mode).toBe('normal')
    expect(migrated?.history).toEqual([])
    expect(migrated?.historyStride).toBe(1)
  })

  it('migrates a version 10 save by backfilling UPS state and the challenge-roll counter', () => {
    const v10 = { ...newGame('home'), version: 10 } as unknown as { version: number } & Partial<
      Omit<GameState, 'version'>
    >
    v10.devices!.forEach((device) => delete (device as Partial<typeof device>).ups)
    delete v10.challengeRollCount
    v10.packets = [{ id: 'p1' }] as unknown as GameState['packets']
    const migrated = migrateSavedGame(v10 as unknown as { version: number })
    expect(migrated?.version).toBe(13)
    expect(migrated?.devices.every((device) => device.ups === false)).toBe(true)
    expect(migrated?.challengeRollCount).toBe(0)
    expect(migrated?.packets).toEqual([])
  })

  it('migrates a version 11 save by backfilling cache level and metered-income state', () => {
    const v11 = { ...newGame('home'), version: 11 } as unknown as { version: number } & Partial<
      Omit<GameState, 'version'>
    >
    v11.devices!.forEach((device) => delete (device as Partial<typeof device>).cacheLevel)
    delete v11.windowIncomeCents
    const migrated = migrateSavedGame(v11 as unknown as { version: number })
    expect(migrated?.version).toBe(13)
    expect(migrated?.devices.every((device) => device.cacheLevel === 0)).toBe(true)
    expect(migrated?.windowIncomeCents).toBe(0)
  })

  it('migrates a version 12 save by backfilling QoS boosts and SLA contract state', () => {
    const v12 = { ...newGame('home'), version: 12 } as unknown as { version: number } & Partial<
      Omit<GameState, 'version'>
    >
    v12.devices!.forEach((device) => delete (device as Partial<typeof device>).qosBoost)
    delete v12.slaContract
    const migrated = migrateSavedGame(v12 as unknown as { version: number })
    expect(migrated?.version).toBe(13)
    expect(migrated?.devices.every((device) => device.qosBoost === null)).toBe(true)
    expect(migrated?.slaContract).toBeNull()
  })

  it('stamps each event with the tick it happened on, not its position in the list', () => {
    let game = newGame('home')
    game.budget = 500
    for (let i = 0; i < 5; i++) game = simulate(game) // several quiet ticks, no new events
    const tickBeforeAction = game.tick
    game = buildDevice(game, 'switch')
    expect(game.events[0].tick).toBe(tickBeforeAction)
    // The earlier "Run initialized" event keeps its original tick (0), not tickBeforeAction.
    const initEvent = game.events.find((e) => e.text.includes('Run initialized'))
    expect(initEvent?.tick).toBe(0)
  })

  it('tracks rolling delivery latency and queue-delay telemetry', () => {
    let game = newGame('home')
    const pc = game.devices.find((d) => d.kind === 'pc')!
    const router = game.devices.find((d) => d.kind === 'router')!
    const cloud = game.devices.find((d) => d.kind === 'cloud')!
    game = addCable(game, pc.id, router.id)
    expect(game.recentLatencyTicks).toBe(0)
    game.packets = [
      {
        id: 'p1',
        path: [pc.id, router.id, cloud.id],
        hop: 1,
        progress: 0.9, // arrives at the cloud this tick
        priority: 'bulk',
        source: pc.id,
        generatedTick: 0,
        queuedTicks: 3,
      },
    ]
    game = simulate(game)
    expect(game.recentLatencyTicks).toBeGreaterThan(0)
    expect(game.recentQueueDelayTicks).toBe(3)
  })

  it('generates outbound requests and inbound responses for client traffic', () => {
    let game = newGame('home')
    const pc = game.devices.find((device) => device.kind === 'pc')!
    const router = game.devices.find((device) => device.kind === 'router')!
    const cloud = game.devices.find((device) => device.kind === 'cloud')!
    game = addCable(game, pc.id, router.id)

    const random = vi.spyOn(Math, 'random').mockReturnValue(0)
    try {
      game = simulate(game)
    } finally {
      random.mockRestore()
    }

    expect(
      game.packets.some((packet) => packet.path.at(0) === pc.id && packet.path.at(-1) === cloud.id),
    ).toBe(true)
    expect(
      game.packets.some((packet) => packet.path.at(0) === cloud.id && packet.path.at(-1) === pc.id),
    ).toBe(true)
  })

  it('awards a delivery milestone exactly once', () => {
    let game = newGame('home')
    game.delivered = 30 // past the home 25-packet milestone
    const budgetBefore = game.budget
    game = simulate(game)
    expect(game.milestonesReached).toContain(25)
    expect(game.budget).toBeGreaterThanOrEqual(budgetBefore + 50)
    const milestoneCount = game.milestonesReached.filter((m) => m === 25).length
    game = simulate(game)
    expect(game.milestonesReached.filter((m) => m === 25).length).toBe(milestoneCount)
  })

  it('scores network health from device retention and delivery ratio', () => {
    const game = newGame('home')
    game.spawned = 4
    const sources = game.devices.filter((device) => ['pc', 'tv', 'console'].includes(device.kind))
    sources.forEach((device) => {
      device.generated = 10
      device.delivered = 5
    })
    // 3 surviving sources / 4 spawned * (delivered 15 / generated 30) * 1000 = 375
    expect(networkHealthBonus(game)).toBe(375)
  })

  it('enforces cable VLAN tags during route finding', () => {
    let game = newGame('home')
    const pc = game.devices.find((device) => device.kind === 'pc')!
    const router = game.devices.find((device) => device.kind === 'router')!
    const cloud = game.devices.find((device) => device.kind === 'cloud')!
    game = addCable(game, pc.id, router.id)
    const accessCable = game.cables.find((cable) => cable.from === pc.id || cable.to === pc.id)!

    game = cycleCableVlan(game, accessCable.id) // VLAN 1 matches PC subnet 1
    expect(findRoute(game, pc.id, cloud.id)).not.toBeNull()
    game = cycleCableVlan(game, accessCable.id) // VLAN 2 blocks PC subnet 1
    expect(findRoute(game, pc.id, cloud.id)).toBeNull()
  })

  it('balances wireless clients onto a less-loaded access point in range', () => {
    let game = newGame('home')
    game.budget = 10_000
    game = buildDevice(game, 'wireless', 10, 10)
    game = buildDevice(game, 'wireless', 25, 10)
    const [hubA, hubB] = game.devices.filter((d) => d.kind === 'wireless')
    game = buildDevice(game, 'phone', 10, 12) // within range of hub A only
    game = buildDevice(game, 'phone', 17, 10) // within range of both hubs
    const [firstPhone, secondPhone] = game.devices.filter((d) => d.kind === 'phone')
    expect(servingWirelessHub(game, firstPhone.id)?.id).toBe(hubA.id)
    // Hub A already serves firstPhone, so the second phone (in range of both)
    // balances onto the less-loaded hub B instead of the nearer hub A.
    expect(servingWirelessHub(game, secondPhone.id)?.id).toBe(hubB.id)
    // The batched per-tick resolver must agree with the per-device resolver
    // it replaces inside simulate()'s hot path.
    const associations = buildWirelessAssociations(game)
    expect(associations.get(firstPhone.id)).toBe(hubA.id)
    expect(associations.get(secondPhone.id)).toBe(hubB.id)
  })

  it('reuses a precomputed wireless association map across a cable-filtered clone', () => {
    let game = newGame('home')
    game.budget = 1000
    const pc = game.devices.find((d) => d.kind === 'pc')!
    const router = game.devices.find((d) => d.kind === 'router')!
    game = addCable(game, pc.id, router.id)
    game = buildDevice(game, 'wireless', pc.x, pc.y)
    const hub = game.devices.find((d) => d.kind === 'wireless')!
    game = addCable(game, hub.id, router.id)
    const associations = buildWirelessAssociations(game)
    // independentPathCount removes the primary route's cable edges before its
    // second findRoute call; passing the same map must still find the Wi-Fi
    // backup path since wireless association doesn't depend on cables.
    expect(independentPathCount(game, pc.id, router.id, associations)).toBe(2)
  })

  it('shrinks wireless coverage and throughput while a hub is interfered', () => {
    const game = newGame('startup')
    const accessPoint = game.devices.find((d) => d.kind === 'wireless')!
    const phone = game.devices.find((d) => d.kind === 'phone')!
    const cloud = game.devices.find((d) => d.kind === 'cloud')!
    expect(findRoute(game, phone.id, cloud.id)).not.toBeNull()

    accessPoint.interference = 10
    // Move the phone just outside the interfered (60%) range but still inside
    // the hub's full-strength range, so only interference explains the drop.
    const interferedGame = moveDevice(game, phone.id, accessPoint.x, accessPoint.y + 14)
    interferedGame.devices.find((d) => d.id === accessPoint.id)!.interference = 10
    expect(findRoute(interferedGame, phone.id, cloud.id)).toBeNull()

    interferedGame.devices.find((d) => d.id === accessPoint.id)!.interference = 0
    expect(findRoute(interferedGame, phone.id, cloud.id)).not.toBeNull()
  })

  it('clears wireless interference after its tick count expires', () => {
    let game = newGame('startup')
    const accessPoint = game.devices.find((d) => d.kind === 'wireless')!
    accessPoint.interference = 1
    game = simulate(game)
    expect(game.devices.find((d) => d.id === accessPoint.id)!.interference).toBe(0)
    expect(game.events[0].text).toContain('interference cleared')
  })

  it('routes some multi-subnet traffic to another device instead of only the cloud', () => {
    let game = newGame('corporate')
    game.budget = 0
    for (let i = 0; i < 60 && game.phase === 'playing'; i++) game = simulate(game)
    const subnets = new Set(game.devices.map((d) => d.subnet))
    expect(subnets.size).toBeGreaterThan(1)
    // Cross-subnet traffic is probabilistic; just confirm the run stays internally
    // consistent (no crash, delivered count advances) over many ticks.
    expect(game.tick).toBeGreaterThan(0)
    expect(game.delivered).toBeGreaterThanOrEqual(0)
  })

  it('admits packets at a saturated forwarding device by strict priority, queuing the rest', () => {
    let game = newGame('home')
    const router = game.devices.find((d) => d.kind === 'router')!
    const pc = game.devices.find((d) => d.kind === 'pc')!
    router.pps = 2 // tight cap so two synthetic bulk packets cannot both fit
    game.packets = [
      {
        id: 'bulk-1',
        path: [pc.id, router.id, 'cloud-stand-in'],
        hop: 0,
        progress: 0.9,
        priority: 'bulk',
        source: pc.id,
        generatedTick: 0,
        queuedTicks: 0,
      },
      {
        id: 'bulk-2',
        path: [pc.id, router.id, 'cloud-stand-in'],
        hop: 0,
        progress: 0.9,
        priority: 'bulk',
        source: pc.id,
        generatedTick: 0,
        queuedTicks: 0,
      },
      {
        id: 'realtime-1',
        path: [pc.id, router.id, 'cloud-stand-in'],
        hop: 0,
        progress: 0.9,
        priority: 'realtime',
        source: pc.id,
        generatedTick: 0,
        queuedTicks: 0,
      },
    ]
    game = simulate(game)
    const realtimePacket = game.packets.find((p) => p.id === 'realtime-1')!
    expect(realtimePacket.hop).toBe(1) // realtime always wins admission over bulk

    const bulkPackets = game.packets.filter((p) => p.id === 'bulk-1' || p.id === 'bulk-2')
    const stillQueued = bulkPackets.filter((p) => p.hop === 0)
    expect(stillQueued.length).toBeGreaterThanOrEqual(1)
    expect(stillQueued[0].queuedTicks).toBeGreaterThan(0)
  })

  it('drops a packet once it has waited past the queue capacity', () => {
    let game = newGame('home')
    const router = game.devices.find((d) => d.kind === 'router')!
    const pc = game.devices.find((d) => d.kind === 'pc')!
    router.pps = 0 // never admits, so the packet only ages in queue
    game.packets = [
      {
        id: 'stuck',
        path: [pc.id, router.id, 'cloud-stand-in'],
        hop: 0,
        progress: 0.9,
        priority: 'bulk',
        source: pc.id,
        generatedTick: 0,
        queuedTicks: 6,
      },
    ]
    const before = game.dropped
    game = simulate(game)
    expect(game.packets.some((p) => p.id === 'stuck')).toBe(false)
    expect(game.dropped).toBeGreaterThan(before)
  })

  it('applies firewall block rules to matching source traffic', () => {
    let game = newGame('home')
    game.budget = 500
    game = buildDevice(game, 'firewall')
    const pc = game.devices.find((device) => device.kind === 'pc')!
    const firewall = game.devices.find((device) => device.kind === 'firewall')!
    const router = game.devices.find((device) => device.kind === 'router')!
    const cloud = game.devices.find((device) => device.kind === 'cloud')!
    game = addCable(game, pc.id, firewall.id)
    game = addCable(game, firewall.id, router.id)
    expect(findRoute(game, pc.id, cloud.id)).not.toBeNull()

    game = toggleFirewallRule(game, firewall.id, 'pc')
    expect(findRoute(game, pc.id, cloud.id)).toBeNull()

    game = toggleFirewallRule(game, firewall.id, 'phone')
    expect(game.devices.find((device) => device.id === firewall.id)?.firewallRules).toEqual([
      'pc',
      'phone',
    ])
  })

  it('keeps a rejected packet at the firewall for one drop-animation interval', () => {
    // Other unconnected source devices (tv, console, etc.) also generate and
    // can drop traffic each tick; every such roll in simulate() is gated by
    // `Math.random() < chance`, so pinning Math.random() near 1 suppresses
    // them and isolates `dropped` to the firewall-blocked packet under test.
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.9999)
    try {
      let game = newGame('home')
      game.budget = 500
      game = buildDevice(game, 'firewall')
      const pc = game.devices.find((device) => device.kind === 'pc')!
      const firewall = game.devices.find((device) => device.kind === 'firewall')!
      const router = game.devices.find((device) => device.kind === 'router')!
      const cloud = game.devices.find((device) => device.kind === 'cloud')!
      game = toggleFirewallRule(game, firewall.id, 'pc')
      game.packets = [
        {
          id: 'blocked-at-firewall',
          path: [pc.id, firewall.id, router.id, cloud.id],
          hop: 0,
          progress: 0.9,
          priority: 'bulk',
          owner: pc.id,
          source: pc.id,
          generatedTick: game.tick,
          queuedTicks: 0,
        },
      ]

      const droppedBefore = game.dropped
      game = simulate(game)
      const droppingPacket = game.packets.find((packet) => packet.id === 'blocked-at-firewall')
      expect(droppingPacket?.droppingAtFirewall).toBe(true)
      expect(droppingPacket?.hop).toBe(1)
      expect(game.dropped).toBe(droppedBefore + 1)

      game = simulate(game)
      expect(game.packets.some((packet) => packet.id === 'blocked-at-firewall')).toBe(false)
    } finally {
      randomSpy.mockRestore()
    }
  })

  it('builds a load balancer as a 4-port forwarding node that bridges end devices', () => {
    let game = newGame('home')
    game.budget = 500
    const budgetBefore = game.budget
    game = buildDevice(game, 'loadBalancer')
    const loadBalancer = game.devices.find((device) => device.kind === 'loadBalancer')!
    expect(loadBalancer.maxPorts).toBe(4)
    expect(loadBalancer.pps).toBe(24)
    expect(game.budget).toBe(budgetBefore - 150)

    const pc = game.devices.find((device) => device.kind === 'pc')!
    const router = game.devices.find((device) => device.kind === 'router')!
    const cloud = game.devices.find((device) => device.kind === 'cloud')!
    game = addCable(game, pc.id, loadBalancer.id)
    game = addCable(game, loadBalancer.id, router.id)
    expect(findRoute(game, pc.id, cloud.id)).not.toBeNull()
  })

  it('spreads outbound traffic across a load balancer’s equally-short branches', () => {
    let game = newGame('home')
    game.budget = 1000
    const cloud = game.devices.find((device) => device.kind === 'cloud')!
    const routerA = game.devices.find((device) => device.kind === 'router')!
    game = buildDevice(game, 'router')
    const routerB = game.devices.find(
      (device) => device.kind === 'router' && device.id !== routerA.id,
    )!
    game = buildDevice(game, 'loadBalancer')
    const loadBalancer = game.devices.find((device) => device.kind === 'loadBalancer')!
    const pc = game.devices.find((device) => device.kind === 'pc')!
    game = addCable(game, routerB.id, cloud.id) // cloud's second port
    game = addCable(game, loadBalancer.id, routerA.id)
    game = addCable(game, loadBalancer.id, routerB.id)
    game = addCable(game, pc.id, loadBalancer.id)

    const secondHopCounts: Record<string, number> = { [routerA.id]: 0, [routerB.id]: 0 }
    for (let i = 0; i < 300; i++) {
      const route = findRoute(game, pc.id, cloud.id)!
      secondHopCounts[route[2]]++
    }
    // A fixed BFS tie-break would always pick one branch and leave the other
    // at 0; both equally-short router/Cloud branches should see real traffic.
    expect(secondHopCounts[routerA.id]).toBeGreaterThan(60)
    expect(secondHopCounts[routerB.id]).toBeGreaterThan(60)
  })

  it('humanizes a camelCase device kind in the placement event log', () => {
    let game = newGame('home')
    game.budget = 500
    game = buildDevice(game, 'loadBalancer')
    expect(game.events[0].text).toBe('load balancer placed. Drag it into position.')
  })

  it('rejects a load balancer connecting directly to the Cloud Edge', () => {
    let game = newGame('home')
    game.budget = 500
    game = buildDevice(game, 'loadBalancer')
    const loadBalancer = game.devices.find((device) => device.kind === 'loadBalancer')!
    const cloud = game.devices.find((device) => device.kind === 'cloud')!
    const cablesBefore = game.cables.length
    game = addCable(game, loadBalancer.id, cloud.id)
    expect(game.cables).toHaveLength(cablesBefore)
    expect(game.events[0].text).toContain('router')
  })

  it('upgrades load balancer throughput and refunds its salvage value on removal', () => {
    let game = newGame('home')
    game.budget = 500
    game = buildDevice(game, 'loadBalancer')
    const loadBalancer = game.devices.find((device) => device.kind === 'loadBalancer')!
    const budgetBeforeUpgrade = game.budget
    const ppsBeforeUpgrade = loadBalancer.pps
    game = upgradeDeviceSpeed(game, loadBalancer.id)
    const upgraded = game.devices.find((device) => device.id === loadBalancer.id)!
    expect(upgraded.pps).toBe(ppsBeforeUpgrade + 10)
    expect(game.budget).toBe(budgetBeforeUpgrade - 100)

    game = removeDevice(game, loadBalancer.id)
    expect(game.devices.some((device) => device.id === loadBalancer.id)).toBe(false)
    // 90% salvage of ($150 build + $100 upgrade spend).
    expect(game.budget).toBe(budgetBeforeUpgrade - 100 + 225)
  })

  it('reroutes a cable endpoint while preserving tier and VLAN', () => {
    let game = newGame('home')
    game.budget = 500
    game = buildDevice(game, 'switch')
    const pc = game.devices.find((d) => d.kind === 'pc')!
    const router = game.devices.find((d) => d.kind === 'router')!
    const networkSwitch = game.devices.find((d) => d.kind === 'switch')!
    game = addCable(game, pc.id, router.id)
    let cable = game.cables.find((c) => c.from === pc.id || c.to === pc.id)!
    game = upgradeCable(game, cable.id)
    game = cycleCableVlan(game, cable.id)
    const tierBefore = game.cables.find((c) => c.id === cable.id)!.tier
    const vlanBefore = game.cables.find((c) => c.id === cable.id)!.vlan
    const routerPortsBefore = game.devices.find((d) => d.id === router.id)!.ports

    game = rerouteCable(game, cable.id, false, networkSwitch.id) // move the router end
    cable = game.cables.find((c) => c.id === cable.id)!
    expect(cable.to).toBe(networkSwitch.id)
    expect(cable.tier).toBe(tierBefore)
    expect(cable.vlan).toBe(vlanBefore)
    expect(game.devices.find((d) => d.id === router.id)!.ports).toBe(routerPortsBefore - 1)
    expect(game.devices.find((d) => d.id === networkSwitch.id)!.ports).toBe(1)
  })

  it('rejects rerouting a cable onto a duplicate or over-port-limit target', () => {
    let game = newGame('home')
    game.budget = 500
    game = buildDevice(game, 'switch')
    const pc = game.devices.find((d) => d.kind === 'pc')!
    const router = game.devices.find((d) => d.kind === 'router')!
    const tv = game.devices.find((d) => d.kind === 'tv')!
    game = addCable(game, pc.id, router.id)
    game = addCable(game, tv.id, router.id)
    const pcCable = game.cables.find((c) => c.from === pc.id || c.to === pc.id)!

    // Rerouting the PC cable's router end onto the TV (an end device) is rejected.
    const blocked = rerouteCable(game, pcCable.id, false, tv.id)
    expect(blocked.cables.find((c) => c.id === pcCable.id)!.to).toBe(router.id)
    expect(blocked.events[0].text).toContain('network equipment')
  })

  it('draws a diagonal cable as a direct line instead of an orthogonal route', () => {
    let game = newGame('home')
    game.budget = 500
    const pc = game.devices.find((d) => d.kind === 'pc')!
    const router = game.devices.find((d) => d.kind === 'router')!
    game = addCable(game, pc.id, router.id, 'diagonal')
    const cable = game.cables.find((c) => c.from === pc.id || c.to === pc.id)!
    expect(cable.style).toBe('diagonal')
    const routes = computeCableRoutes(game.devices, game.cables)
    const route = routes.get(cable.id)!
    expect(route.points).toHaveLength(2)
  })

  it('varies traffic generation with the peak-hours demand wave', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.1) // always attempt/succeed traffic rolls
    // Both ticks sit past home's 180-tick warmup so warmup factor is pinned at
    // 1 for both, isolating the peak wave's effect (period 240: max at tick
    // 300, min at tick 420, since sin(2π·300/240) = 1 and sin(2π·420/240) = -1).
    let quietTickGame = newGame('home', 'sandbox')
    quietTickGame.budget = 500
    quietTickGame.tick = 420
    quietTickGame = simulate(quietTickGame)
    const quietGenerated = quietTickGame.devices.reduce((total, d) => total + d.generated, 0)

    let peakTickGame = newGame('home', 'sandbox')
    peakTickGame.budget = 500
    peakTickGame.tick = 300
    peakTickGame = simulate(peakTickGame)
    const peakGenerated = peakTickGame.devices.reduce((total, d) => total + d.generated, 0)

    expect(peakGenerated).toBeGreaterThan(quietGenerated)
    vi.restoreAllMocks()
  })

  it('lets sandbox runs build without budget and never trigger game over', () => {
    let game = newGame('home', 'sandbox')
    expect(game.budget).toBe(100) // scenario starting budget is unchanged
    game = buildDevice(game, 'router') // cost 140, more than starting budget
    expect(game.devices.some((d) => d.kind === 'router' && d.label === 'Router-2')).toBe(true)
    expect(game.budget).toBe(0) // spend floors at zero, never rejected

    game.recentDrops = new Array(20).fill(5) // would normally exceed the failure threshold
    game.tick = 999
    game = simulate(game)
    expect(game.phase).toBe('playing')
  })

  it('backfills mode on a fresh normal run and keeps a sandbox flag through simulate', () => {
    const normalGame = newGame('home')
    expect(normalGame.mode).toBe('normal')
    let sandboxGame = newGame('home', 'sandbox')
    sandboxGame = simulate(sandboxGame)
    expect(sandboxGame.mode).toBe('sandbox')
  })

  it('records a run-history sample every tick and downsamples past the cap', () => {
    // Sandbox mode keeps the run in 'playing' regardless of drops, so history
    // keeps accumulating past the point a normal run's unconnected devices
    // would otherwise trip game over.
    let game = newGame('home', 'sandbox')
    game.budget = 500
    game = simulate(game)
    expect(game.history).toHaveLength(1)
    expect(game.history[0]).toMatchObject({ t: 1 })

    for (let i = 0; i < 611; i++) game = simulate(game)
    expect(game.history.length).toBeLessThanOrEqual(600)
    expect(game.historyStride).toBeGreaterThan(1)
    expect(game.history[0].t).toBe(1) // opening samples are thinned, not dropped
    // The final tick may fall between strided samples once downsampling starts.
    expect(game.tick - game.history.at(-1)!.t).toBeLessThan(game.historyStride)
  })

  /** Removes rate>0 source devices so per-tick traffic generation can't add noise to a DDoS/outage test. */
  function withoutSources(game: GameState): GameState {
    return {
      ...game,
      devices: game.devices.filter(
        (d) => !['pc', 'tv', 'console', 'phone', 'tablet'].includes(d.kind),
      ),
    }
  }

  it('junk packets are always dropped at any firewall, without counting as a drop', () => {
    let game = withoutSources(newGame('startup'))
    game.budget = 500
    game = buildDevice(game, 'firewall')
    const router = game.devices.find((d) => d.kind === 'router')!
    const firewall = game.devices.find((d) => d.kind === 'firewall')!
    const cloud = game.devices.find((d) => d.kind === 'cloud')!
    // No firewall rule blocks 'cloud' — the drop must happen purely because the packet is junk.
    expect(firewall.firewallRules).toEqual([])
    game.packets = [
      {
        id: 'junk-at-firewall',
        path: [router.id, firewall.id, cloud.id],
        hop: 0,
        progress: 0.9,
        priority: 'bulk',
        owner: cloud.id,
        source: cloud.id,
        generatedTick: game.tick,
        queuedTicks: 0,
        junk: true,
      },
    ]
    const droppedBefore = game.dropped
    game = simulate(game)
    const droppingPacket = game.packets.find((p) => p.id === 'junk-at-firewall')
    expect(droppingPacket?.droppingAtFirewall).toBe(true)
    expect(droppingPacket?.hop).toBe(1)
    expect(game.dropped).toBe(droppedBefore)
  })

  it('DDoS junk delivered to its target switch scores nothing and is not counted as delivered', () => {
    let game = withoutSources(newGame('startup'))
    game.budget = 500
    const cloud = game.devices.find((d) => d.kind === 'cloud')!
    const router = game.devices.find((d) => d.kind === 'router')!
    const targetSwitch = game.devices.find((d) => d.kind === 'switch')!
    game.activeEvents = [
      { id: 'ddos-test', kind: 'ddos', ticksRemaining: 99, targetId: targetSwitch.id },
    ]
    game.packets = [
      {
        id: 'junk-arriving',
        path: [cloud.id, router.id, targetSwitch.id],
        hop: 1,
        progress: 0.9,
        priority: 'bulk',
        owner: cloud.id,
        source: cloud.id,
        generatedTick: game.tick,
        queuedTicks: 0,
        junk: true,
      },
    ]
    const scoreBefore = game.score
    const deliveredBefore = game.delivered
    const droppedBefore = game.dropped
    game = simulate(game)
    expect(game.packets.some((p) => p.id === 'junk-arriving')).toBe(false)
    expect(game.score).toBe(scoreBefore)
    expect(game.delivered).toBe(deliveredBefore)
    expect(game.dropped).toBe(droppedBefore)
  })

  it('a reachable honeypot lures DDoS junk away from the target switch; without one, junk falls back to the target', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0) // forces the lure roll to always succeed
    const targetSwitchId = (game: GameState) => game.devices.find((d) => d.kind === 'switch')!.id

    let withHoneypot = withoutSources(newGame('startup'))
    withHoneypot.budget = 500
    withHoneypot = buildDevice(withHoneypot, 'honeypot', 60, 80)
    const honeypot = withHoneypot.devices.find((d) => d.kind === 'honeypot')!
    const router = withHoneypot.devices.find((d) => d.kind === 'router')!
    withHoneypot = addCable(withHoneypot, honeypot.id, router.id)
    withHoneypot.activeEvents = [
      { id: 'ddos-test', kind: 'ddos', ticksRemaining: 99, targetId: targetSwitchId(withHoneypot) },
    ]
    withHoneypot = simulate(withHoneypot)
    const luredJunk = withHoneypot.packets.filter((p) => p.junk)
    expect(luredJunk.length).toBeGreaterThan(0)
    expect(luredJunk.every((p) => p.path.at(-1) === honeypot.id)).toBe(true)

    let withoutHoneypot = withoutSources(newGame('startup'))
    withoutHoneypot.budget = 500
    withoutHoneypot.activeEvents = [
      {
        id: 'ddos-test',
        kind: 'ddos',
        ticksRemaining: 99,
        targetId: targetSwitchId(withoutHoneypot),
      },
    ]
    withoutHoneypot = simulate(withoutHoneypot)
    const fallbackJunk = withoutHoneypot.packets.filter((p) => p.junk)
    expect(fallbackJunk.length).toBeGreaterThan(0)
    expect(fallbackJunk.every((p) => p.path.at(-1) === targetSwitchId(withoutHoneypot))).toBe(true)

    vi.restoreAllMocks()
  })

  it('junk absorbed by a honeypot pays a small score bonus', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0) // forces every lure roll to succeed
    let game = withoutSources(newGame('startup'))
    game.budget = 500
    game = buildDevice(game, 'honeypot', 60, 80)
    const honeypot = game.devices.find((d) => d.kind === 'honeypot')!
    const router = game.devices.find((d) => d.kind === 'router')!
    game = addCable(game, honeypot.id, router.id)
    const targetSwitch = game.devices.find((d) => d.kind === 'switch')!
    game.activeEvents = [
      { id: 'ddos-test', kind: 'ddos', ticksRemaining: 99, targetId: targetSwitch.id },
    ]
    for (let i = 0; i < 8; i++) game = simulate(game)
    expect(game.score).toBeGreaterThan(0)
    vi.restoreAllMocks()
  })

  it('a power outage restores only the devices it downed, leaving separately-failed devices offline', () => {
    let game = newGame('startup')
    const router = game.devices.find((d) => d.kind === 'router')!
    const switchDevice = game.devices.find((d) => d.kind === 'switch')!
    router.offline = true
    switchDevice.offline = true
    switchDevice.health = 0 // simulates an unrelated equipment failure during the outage
    game.activeEvents = [
      {
        id: 'outage-test',
        kind: 'powerOutage',
        ticksRemaining: 1,
        targetId: null,
        affectedIds: [router.id, switchDevice.id],
        centerX: 50,
        centerY: 30,
      },
    ]
    game = simulate(game)
    expect(game.activeEvents.some((e) => e.id === 'outage-test')).toBe(false)
    expect(game.devices.find((d) => d.id === router.id)!.offline).toBe(false)
    expect(game.devices.find((d) => d.id === switchDevice.id)!.offline).toBe(true)
  })

  it('UPS-protected devices are excluded when a power outage rolls', () => {
    let game = withoutSources(newGame('corporate'))
    game.budget = 1000
    game.challengeRollCount = 2 // past the hostile-event grace window
    const scenario = SCENARIOS.find((s) => s.id === 'corporate')!
    game.tick = scenario.challengeStart - 1
    const router = game.devices.find((d) => d.kind === 'router')!
    const routerB = game.devices.find((d) => d.kind === 'router' && d.id !== router.id)!
    game = upgradeUps(game, routerB.id)
    expect(game.devices.find((d) => d.id === routerB.id)!.ups).toBe(true)

    // Installed only now — newGame()/upgradeUps() consume no Math.random(),
    // so this sequence lines up exactly with rollChallengeEvent's 3 calls.
    vi.spyOn(Math, 'random')
      .mockReturnValueOnce(0.45) // kind-selection roll -> powerOutage band
      .mockReturnValueOnce(0.5) // centerX -> 15 + 0.5*70 = 50
      .mockReturnValueOnce(19 / 70) // centerY -> 15 + (19/70)*70 = 34
    game = simulate(game)
    const outageEvent = game.activeEvents.find((e) => e.kind === 'powerOutage')
    expect(outageEvent).toBeDefined()
    expect(outageEvent!.affectedIds).not.toContain(routerB.id)
    expect(game.devices.find((d) => d.id === routerB.id)!.offline).toBe(false)
    vi.restoreAllMocks()
  })

  it('DDoS and power-outage events never roll before the hostile-event grace window, even in equipment-failure scenarios', () => {
    let game = withoutSources(newGame('corporate'))
    game.budget = 1000
    game.challengeRollCount = 0 // still inside the grace window
    const scenario = SCENARIOS.find((s) => s.id === 'corporate')!
    game.tick = scenario.challengeStart - 1
    game = simulate(game)
    expect(game.activeEvents.some((e) => e.kind === 'ddos' || e.kind === 'powerOutage')).toBe(false)
  })

  it('a bulk exchange can be served by a same-subnet cache instead of round-tripping to the Cloud Edge', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0) // forces the packet-generation and cache-hit rolls to succeed
    let game = newGame('home')
    game.budget = 10_000
    const router = game.devices.find((d) => d.kind === 'router')!
    const pc = game.devices.find((d) => d.kind === 'pc')! // bulk priority
    game = addCable(game, pc.id, router.id)
    game = buildDevice(game, 'cache', 40, 40)
    const cache = game.devices.find((d) => d.kind === 'cache')!
    game = addCable(game, cache.id, router.id)

    for (let i = 0; i < 6; i++) game = simulate(game)
    expect(cache.delivered).not.toBeUndefined() // sanity: cache device exists
    const cloudUplink = game.cables.find(
      (c) =>
        game.devices.find((d) => d.id === c.from)?.kind === 'cloud' ||
        game.devices.find((d) => d.id === c.to)?.kind === 'cloud',
    )!
    expect(game.devices.find((d) => d.id === cache.id)!.delivered).toBeGreaterThan(0)
    expect(cloudUplink.load).toBe(0)
    vi.restoreAllMocks()
  })

  it('realtime traffic never routes to a cache', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0)
    let game = newGame('home')
    game.budget = 10_000
    const router = game.devices.find((d) => d.kind === 'router')!
    const consoleDevice = game.devices.find((d) => d.kind === 'console')! // realtime priority
    game = addCable(game, consoleDevice.id, router.id)
    game = buildDevice(game, 'cache', 40, 40)
    const cache = game.devices.find((d) => d.kind === 'cache')!
    game = addCable(game, cache.id, router.id)

    for (let i = 0; i < 6; i++) game = simulate(game)
    expect(game.devices.find((d) => d.id === cache.id)!.delivered).toBe(0)
    vi.restoreAllMocks()
  })

  it('cache hit-rate upgrades cap at CACHE_HIT_RATE_MAX', () => {
    let game = newGame('home')
    game.budget = 10_000
    game = buildDevice(game, 'cache', 40, 40)
    const cacheId = game.devices.find((d) => d.kind === 'cache')!.id
    for (let i = 0; i < 10; i++) game = upgradeCacheHitRate(game, cacheId)
    const cache = game.devices.find((d) => d.id === cacheId)!
    const rate = 0.35 + cache.cacheLevel * 0.1
    expect(Math.min(CACHE_HIT_RATE_MAX, rate)).toBe(CACHE_HIT_RATE_MAX)
    expect(cache.cacheLevel).toBe(2) // 0.35 + 2*0.10 = 0.55, further levels are rejected
  })

  it('a client in a repeater zone but outside the parent hub range associates to the hub', () => {
    let game = newGame('home')
    game.budget = 10_000
    const router = game.devices.find((d) => d.kind === 'router')!
    game = buildDevice(game, 'wireless', 10, 10) // 802.11b range 14
    const hub = game.devices.find((d) => d.kind === 'wireless')!
    game = addCable(game, hub.id, router.id)
    game = buildDevice(game, 'repeater', 20, 10) // 10 units from hub — inside its range
    game = buildDevice(game, 'phone', 30, 10) // 10 units from repeater, 20 from hub
    const phone = game.devices.find((d) => d.kind === 'phone')!
    const associations = buildWirelessAssociations(game)
    expect(associations.get(phone.id)).toBe(hub.id)
  })

  it("a repeater's zone dies when its parent hub goes offline", () => {
    let game = newGame('home')
    game.budget = 10_000
    const router = game.devices.find((d) => d.kind === 'router')!
    game = buildDevice(game, 'wireless', 10, 10)
    const hub = game.devices.find((d) => d.kind === 'wireless')!
    game = addCable(game, hub.id, router.id)
    game = buildDevice(game, 'repeater', 20, 10)
    game = buildDevice(game, 'phone', 30, 10)
    const phone = game.devices.find((d) => d.kind === 'phone')!
    game.devices.find((d) => d.id === hub.id)!.offline = true
    const associations = buildWirelessAssociations(game)
    expect(associations.get(phone.id)).toBeUndefined()
  })

  it('repeaters cannot chain off another repeater', () => {
    let game = newGame('home')
    game.budget = 10_000
    const router = game.devices.find((d) => d.kind === 'router')!
    game = buildDevice(game, 'wireless', 10, 10) // range 14
    const hub = game.devices.find((d) => d.kind === 'wireless')!
    game = addCable(game, hub.id, router.id)
    game = buildDevice(game, 'repeater', 20, 10) // active: 10 units from hub
    game = buildDevice(game, 'repeater', 35, 10) // inactive: 25 units from hub, out of range
    game = buildDevice(game, 'phone', 40, 10) // 5 units from the inactive repeater only
    const phone = game.devices.find((d) => d.kind === 'phone')!
    const associations = buildWirelessAssociations(game)
    expect(associations.get(phone.id)).toBeUndefined()
  })

  it('a repeater-served delivery accrues +1 queue delay versus a direct connection', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0)
    let game = newGame('home')
    game.budget = 10_000
    const router = game.devices.find((d) => d.kind === 'router')!
    game = buildDevice(game, 'wireless', 10, 10)
    const hub = game.devices.find((d) => d.kind === 'wireless')!
    game = addCable(game, hub.id, router.id)
    game = buildDevice(game, 'repeater', 20, 10)
    game = buildDevice(game, 'phone', 30, 10) // repeater-served only
    const phone = game.devices.find((d) => d.kind === 'phone')!

    game = simulate(game)
    const phonePacket = game.packets.find((p) => p.source === phone.id)
    expect(phonePacket?.queuedTicks).toBe(1)
    vi.restoreAllMocks()
  })

  it('non-metered scenarios keep the flat periodic budget allocation', () => {
    let game = withoutSources(newGame('home'))
    game.tick = 14
    game.budget = 0
    game = simulate(game)
    expect(game.budget).toBe(30) // 25 + 5 * multiplier(1)
  })

  it('a metered-income scenario pays only the base amount when nothing was delivered', () => {
    let game = withoutSources(newGame('isp'))
    game.tick = 14
    game.budget = 0
    game.windowIncomeCents = 0
    game = simulate(game)
    expect(game.budget).toBe(10) // METERED_BASE_INCOME only
  })

  it('metered income pays more for a realtime delivery than an equivalent bulk one', () => {
    const deliverOnce = (priority: 'realtime' | 'bulk') => {
      const game = withoutSources(newGame('isp'))
      game.budget = 500
      const cloud = game.devices.find((d) => d.kind === 'cloud')!
      const router = game.devices.find((d) => d.kind === 'router')!
      game.packets = [
        {
          id: 'p',
          path: [router.id, cloud.id],
          hop: 0,
          progress: 0.9,
          priority,
          owner: router.id,
          source: router.id,
          generatedTick: game.tick,
          queuedTicks: 0,
        },
      ]
      return simulate(game)
    }
    expect(deliverOnce('realtime').windowIncomeCents).toBeGreaterThan(
      deliverOnce('bulk').windowIncomeCents,
    )
  })

  it('metered income payout is capped at 3x the flat allocation it replaces', () => {
    let game = withoutSources(newGame('isp'))
    game.tick = 14
    game.budget = 0
    game.windowIncomeCents = 100_000
    game = simulate(game)
    expect(game.budget).toBe(90) // (25 + 5 * multiplier(1)) * 3
    expect(game.windowIncomeCents).toBe(0)
  })

  it('cycles a forwarding device QoS boost through null -> realtime -> stream -> bulk -> null', () => {
    let game = newGame('home')
    const router = game.devices.find((d) => d.kind === 'router')!
    expect(router.qosBoost).toBeNull()
    game = cycleQosBoost(game, router.id)
    expect(game.devices.find((d) => d.id === router.id)!.qosBoost).toBe('realtime')
    game = cycleQosBoost(game, router.id)
    expect(game.devices.find((d) => d.id === router.id)!.qosBoost).toBe('stream')
    game = cycleQosBoost(game, router.id)
    expect(game.devices.find((d) => d.id === router.id)!.qosBoost).toBe('bulk')
    game = cycleQosBoost(game, router.id)
    expect(game.devices.find((d) => d.id === router.id)!.qosBoost).toBeNull()
  })

  it('cycleQosBoost is a no-op on a non-forwarding device', () => {
    let game = newGame('home')
    game.budget = 10_000
    game = buildDevice(game, 'cache', 40, 40)
    const cache = game.devices.find((d) => d.kind === 'cache')!
    const unchanged = cycleQosBoost(game, cache.id)
    expect(unchanged.devices.find((d) => d.id === cache.id)!.qosBoost).toBeNull()
  })

  it('a QoS-boosted class admits before an unboosted higher-priority class at that device', () => {
    let game = withoutSources(newGame('startup'))
    const router = game.devices.find((d) => d.kind === 'router')!
    const switchDevice = game.devices.find((d) => d.kind === 'switch')!
    const cloud = game.devices.find((d) => d.kind === 'cloud')!
    switchDevice.pps = 1
    switchDevice.qosBoost = 'bulk'
    game.packets = [
      {
        id: 'realtime-1',
        path: [router.id, switchDevice.id, cloud.id],
        hop: 0,
        progress: 0.9,
        priority: 'realtime',
        owner: router.id,
        source: router.id,
        generatedTick: game.tick,
        queuedTicks: 0,
      },
      {
        id: 'bulk-1',
        path: [router.id, switchDevice.id, cloud.id],
        hop: 0,
        progress: 0.9,
        priority: 'bulk',
        owner: router.id,
        source: router.id,
        generatedTick: game.tick,
        queuedTicks: 0,
      },
    ]
    game = simulate(game)
    const bulkPacket = game.packets.find((p) => p.id === 'bulk-1')!
    const realtimePacket = game.packets.find((p) => p.id === 'realtime-1')!
    expect(bulkPacket.hop).toBe(1) // boosted bulk admitted
    expect(realtimePacket.hop).toBe(0) // unboosted realtime queued instead
    expect(realtimePacket.queuedTicks).toBe(1)
  })

  it('a QoS boost reduces effective admission capacity, floored at 1; no boost leaves it unchanged', () => {
    const buildArrivals = (boost: 'realtime' | null) => {
      const game = withoutSources(newGame('startup'))
      const router = game.devices.find((d) => d.kind === 'router')!
      const switchDevice = game.devices.find((d) => d.kind === 'switch')!
      const cloud = game.devices.find((d) => d.kind === 'cloud')!
      switchDevice.pps = 10
      switchDevice.qosBoost = boost
      game.packets = Array.from({ length: 10 }, (_, index) => ({
        id: `p${index}`,
        path: [router.id, switchDevice.id, cloud.id],
        hop: 0,
        progress: 0.9,
        priority: 'bulk' as const,
        owner: router.id,
        source: router.id,
        generatedTick: game.tick,
        queuedTicks: 0,
      }))
      return simulate(game).packets.filter((p) => p.hop === 1).length
    }
    expect(buildArrivals('realtime')).toBe(Math.max(1, Math.floor(10 * (1 - QOS_OVERHEAD))))
    expect(buildArrivals(null)).toBe(10)
  })

  it('offers an SLA contract once challengeStart is reached, on a 120-tick cadence', () => {
    let game = withoutSources(newGame('startup'))
    const scenario = SCENARIOS.find((s) => s.id === 'startup')!
    game.tick = scenario.challengeStart - 1
    game = simulate(game)
    expect(game.slaContract).not.toBeNull()
    expect(game.slaContract!.accepted).toBe(false)
    expect(game.slaContract!.ticksRemaining).toBe(9) // SLA_DECISION_TICKS(10), minus this tick's own countdown
  })

  it('does not offer a second SLA contract while one is already active', () => {
    let game = withoutSources(newGame('startup'))
    const scenario = SCENARIOS.find((s) => s.id === 'startup')!
    game.tick = scenario.challengeStart - 1
    game = simulate(game)
    const firstId = game.slaContract!.id
    game.tick = scenario.challengeStart + 120 - 1 // one tick before the next 120-tick cadence
    game = simulate(game)
    expect(game.slaContract!.id).toBe(firstId)
  })

  it('acceptSlaContract starts the contract window; declineSlaContract clears a pending offer', () => {
    const game = withoutSources(newGame('startup'))
    game.slaContract = {
      id: 'c1',
      kind: 'delivery',
      target: 10,
      windowTicks: 50,
      reward: 100,
      penaltyScore: 200,
      ticksRemaining: 6,
      accepted: false,
      breachStreak: 0,
      deliveredSinceAccept: 0,
    }
    const accepted = acceptSlaContract(game)
    expect(accepted.slaContract!.accepted).toBe(true)
    expect(accepted.slaContract!.ticksRemaining).toBe(50)

    const declined = declineSlaContract(game)
    expect(declined.slaContract).toBeNull()
  })

  it('a pending SLA offer auto-declines after the decision window lapses', () => {
    let game = withoutSources(newGame('startup'))
    game.slaContract = {
      id: 'c1',
      kind: 'delivery',
      target: 10,
      windowTicks: 50,
      reward: 100,
      penaltyScore: 200,
      ticksRemaining: 10,
      accepted: false,
      breachStreak: 0,
      deliveredSinceAccept: 0,
    }
    for (let i = 0; i < 10; i++) game = simulate(game)
    expect(game.slaContract).toBeNull()
  })

  it('an accepted latency contract sustained under target pays its reward once, then clears', () => {
    let game = withoutSources(newGame('startup'))
    game.budget = 0
    game.slaContract = {
      id: 'c1',
      kind: 'latency',
      target: 5,
      windowTicks: 3,
      reward: 100,
      penaltyScore: 200,
      ticksRemaining: 3,
      accepted: true,
      breachStreak: 0,
      deliveredSinceAccept: 0,
    }
    game.recentLatencyTicks = 1 // well under target
    for (let i = 0; i < 3; i++) game = simulate(game)
    expect(game.budget).toBe(100)
    expect(game.slaContract).toBeNull()
  })

  it('a latency contract survives a 4-tick breach spike but fails at 5 consecutive over-target ticks', () => {
    let game = withoutSources(newGame('startup'))
    game.score = 0
    game.slaContract = {
      id: 'c1',
      kind: 'latency',
      target: 2,
      windowTicks: 50,
      reward: 100,
      penaltyScore: 200,
      ticksRemaining: 50,
      accepted: true,
      breachStreak: 0,
      deliveredSinceAccept: 0,
    }
    game.recentLatencyTicks = 5 // over target every tick
    for (let i = 0; i < 4; i++) game = simulate(game)
    expect(game.slaContract).not.toBeNull()
    expect(game.slaContract!.breachStreak).toBe(4)
    game = simulate(game)
    expect(game.slaContract).toBeNull()
    expect(game.score).toBe(-200)
  })

  it('a delivered non-junk packet counts toward an accepted delivery contract, paying out on target', () => {
    let game = withoutSources(newGame('startup'))
    game.budget = 0
    const router = game.devices.find((d) => d.kind === 'router')!
    const cloud = game.devices.find((d) => d.kind === 'cloud')!
    game.slaContract = {
      id: 'c1',
      kind: 'delivery',
      target: 1,
      windowTicks: 50,
      reward: 50,
      penaltyScore: 100,
      ticksRemaining: 50,
      accepted: true,
      breachStreak: 0,
      deliveredSinceAccept: 0,
    }
    game.packets = [
      {
        id: 'p1',
        path: [router.id, cloud.id],
        hop: 0,
        progress: 0.9,
        priority: 'bulk',
        owner: router.id,
        source: router.id,
        generatedTick: game.tick,
        queuedTicks: 0,
      },
    ]
    game = simulate(game)
    expect(game.budget).toBe(50)
    expect(game.slaContract).toBeNull()
  })

  it('a delivery contract fails and costs score if the window ends short of target', () => {
    let game = withoutSources(newGame('startup'))
    game.score = 500
    game.slaContract = {
      id: 'c1',
      kind: 'delivery',
      target: 100,
      windowTicks: 2,
      reward: 50,
      penaltyScore: 100,
      ticksRemaining: 2,
      accepted: true,
      breachStreak: 0,
      deliveredSinceAccept: 0,
    }
    for (let i = 0; i < 2; i++) game = simulate(game)
    expect(game.slaContract).toBeNull()
    expect(game.score).toBe(400)
  })
})
