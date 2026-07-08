# iOS gameplay parity

This web port uses the Swift game and architecture documents in `../NetworkMaster` as its gameplay reference.

## Implemented

- Twelve scenarios (ordered easiest-to-hardest in the menu) with scenario-specific budgets, difficulty ramps, spawn timing, failure settings, and starting topology, plus a per-scenario start-of-run briefing (objective + first steps). The extra four beyond the native roster (Café Hotspot, School Lab, Data Center, Smart City) are web-only additions.
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
- Site cable upgrade with a target picker for every tier from Fast Ethernet through 100 Gigabit (`upgradeAllCables`), matching every intervening tier's cost per cable and excluding the fixed-tier cloud uplink
- Per-scenario warm-up demand easing (`warmupFloor`/`warmupTicks`)
- Challenge-event roster: traffic spike, budget bonus, device surge, and equipment-failure event
- Delivery-count milestone budget awards
- Game-over network-health score bonus (surviving-source ratio × lifetime delivery ratio)
- Cross-subnet traffic destinations (30% of multi-subnet-scenario traffic routes through the router to another device instead of the cloud)
- Wi-Fi interference events (access points randomly lose 40% range / 50% throughput for 8-18 ticks, shown in the coverage zone and device inspector)
- Real per-device packet buffers with strict-priority admission (router/switch/wireless/firewall admit only PPS-many packets per tick, highest priority first; overflow waits up to 6 ticks in a real per-device queue, shown in the inspector, before dropping)
- Endpoint cable rerouting (move either end of an existing cable to a new device, preserving tier/VLAN/style/investment) and diagonal cable drawing (straight-line style as an alternative to the orthogonal lane router)
- Access-point client balancing: a wireless device prefers the least-loaded in-range hub instead of always the nearest, so wireless-capable clients spread across multiple access points
- Latency/queue-delay telemetry: rolling-average delivery latency and per-packet forwarding-queue delay (`recentLatencyTicks`/`recentQueueDelayTicks`), shown in Run Stats
- Personal leaderboard history: the 10 highest-scoring completed runs, persisted locally and browsable from the menu, Run Stats, and the game-over screen
- 5-step onboarding tutorial card, shown once per browser on first visit
- "Jackie" advisor: a single contextual tip prioritized by network state (failure pressure, congestion, out-of-range devices, low budget, queue delay, combo streak)
- Minimap: a static read-only topology overview in the canvas corner
- Zoom/pan canvas: wheel-to-zoom and drag-to-pan over the topology, plus zoom in/out/reset controls
- Live-throughput cable labels: every connection shows its current `load/capacity` at its midpoint, colored by link status
- Per-device throughput bars: router/switch/wireless/firewall show a load-vs-capacity fill both on the canvas and in the inspector
- Offline devices blink between their normal icon and an unplugged-cable icon, with a red-tinted border, on the canvas and minimap
- Timestamped live-events feed (`GameEvent.tick`): each entry shows the tick it actually happened on instead of a position-derived countdown that kept moving even when the visible text hadn't changed
- Access points get an independent forwarding-speed upgrade (`upgradeDeviceSpeed`, same button as router/switch), stacking on top of the Wi-Fi generation upgrade's own throughput jump rather than being overwritten by it
- Cable labels show tier/speed (e.g. "Gigabit") in addition to live traffic (`load/capacity`)

## Remaining native-only systems

- Seeded deterministic replay (the web port's RNG calls are not seed-driven the way native's are, so runs are not bit-for-bit reproducible)
- Audio/haptics and accessibility custom actions (no Web Audio/haptic feedback layer or VoiceOver-equivalent custom actions are implemented)
- Inbound/download traffic: the native sim spawns a return "download" packet from the router back to the source after every delivered upload (`isInbound`); this port only simulates the one-way upload leg (source → cloud/destination) and scores on that arrival. There's no round-trip packet, so cable load figures reflect upload traffic only.

The remaining items require additional simulation state or browser-specific interaction work; the current port prioritizes the core endless topology/capacity/failure loop.

## Intentional deviations from native

- **Load-aware AP balancing**: the native client only picks the nearest in-range hub for routing (no load awareness); this port's load-aware balancing is an enhancement beyond strict parity, since "balancing" was listed as a planned native-only system but the reference implementation does not actually do it.
- **All end devices are Wi-Fi capable**: natively only phones/tablets (`isWirelessOnly`) can use Wi-Fi; PCs, TVs, and consoles are wired-only. This port additionally lets PC/TV/console join an access point's coverage circle (`WIRELESS_CAPABLE_KINDS` in `game.ts`) as an alternative or redundant backup to a cable — phones/tablets remain Wi-Fi _only_ (still cannot take cables), but every end-user device can now use Wi-Fi.
- **Wireless access points have a single port**: native's `wirelessHub` allows up to 6 wired ports (`basePortLimit`); this port caps access points at 1, since they only ever need one uplink cable back into the topology.
- **Load Balancer equipment**: a web-only device with no native counterpart. A $150, 4-port forwarding node (`kind: 'loadBalancer'`) with the highest base throughput (24 pkt/tick) of any buildable equipment and its own throughput upgrade (+10 pkt/tick, no port-upgrade path). It admits/forwards traffic under the same strict-priority rules as router/switch/wireless/firewall, and additionally spreads outbound traffic across its equally-short downstream branches (e.g. two router/Cloud uplinks) instead of always resolving the same BFS shortest path — see the routing note in `CLAUDE.md`. There's no separate inbound leg to balance, since (native-parity gap, above) this port only simulates one-way upload traffic.
- **Diagonal-by-default cables and a leaner starting roster**: native has no cable-style concept or per-scenario briefing at all. This port defaults every new cable — player-drawn and scenario-starting alike — to the `'diagonal'` style rather than `'rightAngle'`, and trims each non-`home` scenario down to one unconnected end device per subnet, both purely to keep the initial canvas and its cable labels readable (particularly in the denser dual-router scenarios).
- **Start-of-run scenario briefing**: a web-only `ScenarioBriefing` modal shown every time a new run starts, stating that scenario's objective and first concrete steps (`Scenario.objective`/`firstSteps` in `game/constants.ts`). Native has no equivalent; this port's one-time 5-step tutorial card already existed but only covers general controls, not what a specific scenario's starting topology actually needs.

## Web-only gameplay additions

Mechanics with no native counterpart at all, beyond the intentional deviations above. See `CLAUDE.md`'s "Web-only gameplay additions" section for implementation details.

- **Peak hours**: a slow sine-wave demand cycle (240 ticks per "day") layered on top of warmup/ramp traffic generation, teaching overprovisioning ahead of a predictable daily peak rather than only a one-way ramp.
- **Sandbox mode**: an optional per-run flag (menu checkbox) that lifts budget gating and disables game over entirely, for free-form topology experimentation. Sandbox runs never record a leaderboard entry or personal best.
- **Run history telemetry**: a capped, downsampled per-tick record of score/failure-pressure/latency, rendered as an SVG line chart on the game-over screen and in the in-game Run Stats panel. This is telemetry replay only (no world-state scrubbing) — true simulation replay would require the seeded-PRNG work noted under "Remaining native-only systems" above.
- **DDoS attack event**: in equipment-failure scenarios (once a run has settled in past its first two challenge-event windows), the Cloud Edge floods a random switch's subnet with junk traffic for 12 ticks. Junk congests links and can displace real traffic, but never scores and its own drops never count toward `dropped`/failure pressure — the harm is purely the congestion, not direct pressure. Any firewall in its path drops it automatically.
- **Honeypot device**: a web-only $70 buildable sink with no native counterpart. Inert until a DDoS is active, at which point it has a chance to lure junk traffic away from the real target and absorb it for a small score bonus.
- **Power outage event + UPS upgrade**: a web-only event (equipment-failure scenarios, same settling-in gate as DDoS) that knocks every unprotected device in a random canvas zone offline for 8 ticks; a $45 UPS upgrade, available on most infrastructure kinds, grants immunity.
