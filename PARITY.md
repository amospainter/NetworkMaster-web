# iOS gameplay parity

This web port uses the Swift game and architecture documents in `../NetworkMaster` as its gameplay reference.

## Implemented

- Eight scenarios with scenario-specific budgets, difficulty ramps, spawn timing, failure settings, and starting topology
- Client-side graph routing with failed/offline-link exclusion
- Wired-port rules, duplicate-link prevention, Cloud/Router restrictions, and no direct end-device links
- Wireless-only phones/tablets, access-point coverage, and seven Wi-Fi upgrade generations
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

## Remaining native-only systems

- Real per-device and per-cable packet buffers with strict priority admission
- Cross-subnet traffic destinations
- Endpoint cable rerouting and diagonal cable drawing
- Wi-Fi interference events and access-point client balancing
- Seeded deterministic replay, latency/queue-delay telemetry, and full leaderboard history
- Native tutorial sequence, Jackie advisor, minimap, zoom/pan canvas, audio/haptics, and accessibility custom actions

The remaining items require additional simulation state or browser-specific interaction work; the current port prioritizes the core endless topology/capacity/failure loop.
