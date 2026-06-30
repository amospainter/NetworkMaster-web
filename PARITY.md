# iOS gameplay parity

This web port uses the Swift game and architecture documents in `../NetworkMaster` as its gameplay reference.

## Implemented

- Eight scenarios with scenario-specific budgets, difficulty ramps, spawn timing, failure settings, and starting topology
- Client-side graph routing with failed/offline-link exclusion
- Wired-port rules, duplicate-link prevention, Cloud/Router restrictions, and no direct end-device links
- Wireless-only phones/tablets, access-point coverage, and seven Wi-Fi upgrade generations (see intentional deviation below: this port also lets PC/TV/console join Wi-Fi coverage)
- Eight native cable tiers from Copper through 100 Gigabit
- Bidirectional cable capacity, congestion state, packet loss, temporary cable faults, age, deletion, and 90% upgrade salvage
- Switch/router throughput limits, infrastructure wear, equipment health, offline state, and field repair
- Packet priorities, animated traffic, device delivery statistics, and traffic-rate escalation
- Rolling 20-tick / 30-drop failure pressure and scenario warm-up periods
- Score multiplier, clean-tick combo, and independent-route delivery bonus
- Periodic income, source-device spawning, game over, and continue-unscored
- Versioned local browser persistence and local high score
- Device dragging, large cable hit targets, inspectors, per-component upgrades, and site-wide upgrades
- Equipment removal with attached-cable cleanup and 90% build/upgrade salvage
- Cable VLAN tags and configurable PC/TV/console firewall block rules
- Native 15% site-upgrade discount and bulk switch-throughput upgrade
- Per-scenario warm-up demand easing (`warmupFloor`/`warmupTicks`)
- Challenge-event roster: traffic spike, budget bonus, device surge, and equipment-failure event
- Delivery-count milestone budget awards
- Game-over network-health score bonus (surviving-source ratio × lifetime delivery ratio)
- Cross-subnet traffic destinations (30% of multi-subnet-scenario traffic routes through the router to another device instead of the cloud)
- Wi-Fi interference events (access points randomly lose 40% range / 50% throughput for 8-18 ticks, shown in the coverage zone and device inspector)
- Real per-device packet buffers with strict-priority admission (router/switch/wireless/firewall admit only PPS-many packets per tick, highest priority first; overflow waits up to 6 ticks in a real per-device queue, shown in the inspector, before dropping)
- Endpoint cable rerouting (move either end of an existing cable to a new device, preserving tier/VLAN/style/investment) and diagonal cable drawing (straight-line style as an alternative to the orthogonal lane router)
- Access-point client balancing: a wireless device prefers the least-loaded in-range hub instead of always the nearest, so wireless-capable clients spread across multiple access points

## Remaining native-only systems

- Seeded deterministic replay, latency/queue-delay telemetry, and full leaderboard history
- Native tutorial sequence, Jackie advisor, minimap, zoom/pan canvas, audio/haptics, and accessibility custom actions

The remaining items require additional simulation state or browser-specific interaction work; the current port prioritizes the core endless topology/capacity/failure loop.

## Intentional deviations from native

- **Load-aware AP balancing**: the native client only picks the nearest in-range hub for routing (no load awareness); this port's load-aware balancing is an enhancement beyond strict parity, since "balancing" was listed as a planned native-only system but the reference implementation does not actually do it.
- **All end devices are Wi-Fi capable**: natively only phones/tablets (`isWirelessOnly`) can use Wi-Fi; PCs, TVs, and consoles are wired-only. This port additionally lets PC/TV/console join an access point's coverage circle (`WIRELESS_CAPABLE_KINDS` in `game.ts`) as an alternative or redundant backup to a cable — phones/tablets remain Wi-Fi _only_ (still cannot take cables), but every end-user device can now use Wi-Fi.
