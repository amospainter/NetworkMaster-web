import { describe, expect, it } from 'vitest'
import {
  addCable,
  CABLE_TIERS,
  buildDevice,
  cycleCableVlan,
  cycleFirewallRule,
  findRoute,
  independentPathCount,
  migrateSavedGame,
  moveDevice,
  networkHealthBonus,
  newGame,
  removeDevice,
  SCENARIOS,
  simulate,
  upgradeCable,
} from './game'
import type { GameState } from './types'

describe('NetworkMaster gameplay rules', () => {
  it('builds every iOS scenario with a cloud uplink and valid port counts', () => {
    for (const scenario of SCENARIOS) {
      const game = newGame(scenario.id)
      expect(game.version).toBe(3)
      expect(game.devices.some((d) => d.kind === 'cloud')).toBe(true)
      expect(game.devices.some((d) => d.kind === 'router')).toBe(true)
      for (const device of game.devices) {
        expect(device.ports).toBe(
          game.cables.filter((c) => c.from === device.id || c.to === device.id).length,
        )
      }
    }
  })

  it('routes wireless-only clients through an access point in range', () => {
    const game = newGame('startup')
    const phone = game.devices.find((d) => d.kind === 'phone')!
    const cloud = game.devices.find((d) => d.kind === 'cloud')!
    expect(findRoute(game, phone.id, cloud.id)).not.toBeNull()
    const moved = moveDevice(game, phone.id, 5, 94)
    expect(findRoute(moved, phone.id, cloud.id)).toBeNull()
  })

  it('rejects wired links to wireless-only devices', () => {
    const game = newGame('startup')
    const phone = game.devices.find((d) => d.kind === 'phone')!
    const router = game.devices.find((d) => d.kind === 'router')!
    const result = addCable(game, phone.id, router.id)
    expect(result.cables).toHaveLength(game.cables.length)
    expect(result.events[0]).toContain('Wi-Fi')
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
    expect(game.events[0]).toContain('$117 salvage')
  })

  it('initializes the version 3 schema with empty progression state', () => {
    const game = newGame('home')
    expect(game.version).toBe(3)
    expect(game.milestonesReached).toEqual([])
    expect(game.activeEvents).toEqual([])
    for (const scenario of SCENARIOS) {
      expect(scenario.warmupFloor).toBeGreaterThan(0)
      expect(scenario.warmupFloor).toBeLessThanOrEqual(1)
      expect(scenario.warmupTicks).toBeGreaterThan(0)
      expect(scenario.challengeStart).toBeGreaterThan(0)
    }
  })

  it('migrates a version 2 save and rejects incompatible schemas', () => {
    const legacy = { ...newGame('home'), version: 2 } as unknown as {
      version: number
      devices: Record<string, unknown>[]
    } & Partial<Omit<GameState, 'version' | 'devices'>>
    legacy.devices.forEach((device) => {
      delete device.upgradeSpend
      delete device.firewallRule
    })
    delete legacy.milestonesReached
    delete legacy.activeEvents
    const migrated = migrateSavedGame(legacy as unknown as { version: number })
    expect(migrated?.version).toBe(3)
    expect(migrated?.milestonesReached).toEqual([])
    expect(migrated?.activeEvents).toEqual([])
    expect(migrated?.devices.every((device) => device.upgradeSpend === 0)).toBe(true)
    expect(migrateSavedGame({ version: 1 })).toBeNull()
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

    game = cycleFirewallRule(game, firewall.id) // block PC traffic
    expect(findRoute(game, pc.id, cloud.id)).toBeNull()
  })
})
