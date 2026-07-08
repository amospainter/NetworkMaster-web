# Feature Spec: Eleven-Feature Expansion

Design spec for the accepted feature slate, sequenced into four phases. Each
phase is one save-schema bump, shipped and verified (`npm run check` + smoke
test) before the next begins. Current persisted schema is version 11; the
remaining phases land as versions 12-13.

## Status

- Phase 1 (schema v10 - peak hours, sandbox mode, run history graph): **[DONE]** - shipped, tested, docs updated (`CLAUDE.md`, `HOWTOPLAY.md`, `PARITY.md`, in-app Help modal).
- Phase 2 (schema v11 - DDoS, honeypot, power outage/UPS): **[DONE]** - shipped, tested, docs updated (`CLAUDE.md`, `HOWTOPLAY.md`, `PARITY.md`, in-app Help modal).
- Phase 3 (schema v12 - cache/CDN, repeater, metered income): **[DONE]** - shipped, tested, docs updated (`CLAUDE.md`, `HOWTOPLAY.md`, `PARITY.md`, in-app Help modal).
- Phase 4 (schema v13 - QoS policies, SLA contracts): [ ] not started.

Conventions that apply to every feature below, per `CLAUDE.md`:

- All gameplay logic goes in `src/game/` modules matching their concern, with
  imports flowing downward (`constants` -> `utils` -> `factories` ->
  `wireless` -> `routing` -> `persistence` -> `simulate` -> `topology` ->
  `upgrades`), exported by name from `game/index.ts` only if `App.vue` or
  tests need them.
- Reducers never mutate the supplied state; new persisted fields must be
  JSON-safe; every new field gets a `migrateSavedGame` backfill step plus a
  migration regression test.
- Player-visible numbers/rules added here must land with matching updates to
  `HOWTOPLAY.md`, the in-app Help modal, `CLAUDE.md`, and `PARITY.md`
  (all four features phases add web-only mechanics, so `PARITY.md` gains a
  "web-only additions" note per phase).

---

## Phase 1 - Simulation texture (schema v10) [DONE]

### 1. Peak hours / traffic rhythm [DONE]

**Design.** Demand follows a slow sine wave on top of the existing
warmup/ramp curve, simulating a daily rhythm. One "day" is 240 ticks
(~3.2 min at normal speed). Demand multiplier:

```
peakFactor(tick) = 1 + PEAK_AMPLITUDE * sin(2π * tick / PEAK_PERIOD_TICKS)
PEAK_PERIOD_TICKS = 240
PEAK_AMPLITUDE = 0.25        // demand swings between 0.75x and 1.25x
```

The wave starts at 1.0 and rises first (sin's opening quarter), so the first
felt effect is a gentle surge shortly after warmup - teaching overprovisioning
without punishing the opening minutes. `home` keeps a reduced amplitude
(0.15) since it is the tutorial scenario.

**Where.**

- `game/constants.ts`: `PEAK_PERIOD_TICKS`, `PEAK_AMPLITUDE`, per-scenario
  optional `peakAmplitude?: number` on `Scenario` (default the global).
- `game/simulate.ts`: new private `peakFactor(tick, scenario)` multiplied
  into `requestedTraffic` alongside `warmupFactor` and
  `trafficSpikeMultiplier`.

**Schema.** None (pure function of `tick`). No migration needed.

**UI.** The HUD gains a small "network hours" indicator (sun/moon-free, per
markdown rules: a label like `PEAK` / `QUIET` / `NORMAL` derived from the
current factor) in `GameHud.vue`. Jackie's `advisorTip` gets a low-priority
line when a peak is approaching (`peakFactor` rising and > 1.1).

**Tests.** `peakFactor` is exported for tests (or tested through `simulate`
with fixed ticks): factor at tick 0 is 1, max near PERIOD/4, min near
3*PERIOD/4; a run at min-demand generates measurably fewer packets than at
max over N ticks with seeded traffic.

### 2. Sandbox / creative mode [DONE]

**Design.** A per-run flag, chosen at start ("Sandbox" toggle on the menu's
scenario grid or briefing). Sandbox runs: budget checks always pass (spend is
still deducted for display but floors at 0 rather than rejecting), failure
pressure accrues but never triggers game over, no leaderboard entry, no
personal best. Everything else - events, wear, milestones - runs normally so
the toy still behaves like the game.

**Where.**

- `types.ts`: `GameState.mode: 'normal' | 'sandbox'`.
- `game/persistence.ts`: `newGame(scenario, mode)`; migration backfills
  `mode: 'normal'`.
- `game/simulate.ts`: skip the `shouldEndRun` block when
  `state.mode === 'sandbox'`.
- `game/upgrades.ts` / `game/topology.ts`: budget guards become
  `canAfford(state, cost)` (new helper in `game/utils.ts`) which always
  returns true in sandbox; spend clamps at 0.
- `App.vue` / `useLeaderboard.ts`: `recordLeaderboardEntry` and best-score
  writes early-return for sandbox runs.
- `MenuScreen.vue`: sandbox toggle; sandbox runs get a persistent `SANDBOX`
  chip in `GameHud.vue` so an unscored toy run is never mistaken for a real
  one.

**Schema.** v10 adds `mode`; migration: `savedGame.mode ??= 'normal'`.

**Tests.** Sandbox run with budget 0 can still `buildDevice`; 20-tick
all-drop sandbox run stays `phase: 'playing'`; migration backfills `mode`.

### 3. Run history graph (replay-lite) [DONE]

**Design.** Per tick, append a compact sample to a capped history:

```ts
type HistorySample = { t: number; s: number; f: number; l: number }
// tick, score, failure pressure (0-100), recentLatencyTicks (1 decimal)
```

Cap at 600 samples; beyond that, downsample by dropping every other sample
and doubling the stride (classic halving), so a long run keeps its full
shape at decreasing resolution rather than losing its start. `GameState`
gains `history: HistorySample[]` and `historyStride: number`.

`GameOverModal.vue` renders an inline SVG line chart (score + pressure +
latency, three labeled series, status communicated with labels not just
color) with the failure threshold marked. No scrubbing of world state - this
is telemetry replay, not simulation replay (the seeded-PRNG prerequisite for
true replay is out of scope for this slate).

**Where.**

- `types.ts`, `game/persistence.ts` (init + migration `history ??= []`,
  `historyStride ??= 1`), `game/simulate.ts` (append/downsample at end of
  tick), new leaf `components/RunHistoryChart.vue` used by
  `GameOverModal.vue` (and the stats modal, which already exists, for
  mid-run viewing).

**Schema.** v10 (bundled with `mode`).

**Perf note.** Sample append is O(1) amortized and JSON-cloned with the rest
of state by `cloneState`; 600 samples of 4 numbers is ~10 KB worst case -
acceptable for the 400 ms-debounced localStorage write. The chart component
is a leaf receiving `history` as a prop, so it re-renders per tick only while
the stats modal is open.

**Tests.** History length never exceeds 600; downsampling preserves first and
last samples; migration backfills empty history.

---

## Phase 2 - Events and defense (schema v11) [DONE]

### 4. DDoS attack event [DONE]

**Design.** New `ChallengeEventKind: 'ddos'`, rolled from `rollChallengeEvent`
only in scenarios with `equipmentFailure: true` (the "hostile world"
scenarios) and only after the run's first 2 event windows, replacing part of
the `trafficSpike` probability band there. Duration 12 ticks, targeting one
switch's subnet (`targetId` = the switch).

Each tick of an active DDoS, the Cloud Edge emits `DDOS_RATE` (6) junk
packets routed toward the target switch (reusing `findRoute` from cloud to
switch). Junk packets:

- New `Packet.junk?: boolean`. Junk packets consume cable load and forwarding
  admission like real traffic (that is the attack), but deliveries score
  nothing and their drops do not count toward failure pressure or `dropped` -
  the harm is congestion/queue displacement of real traffic, not direct
  pressure. This keeps the mechanic fair: pressure rises because _your_
  packets start dropping.
- Firewall interaction: when a junk packet arrives at any firewall, it is
  always dropped there, reusing the existing `droppingAtFirewall` animation
  path - no rule configuration needed. A firewall positioned between the
  router and the target subnet therefore absorbs the attack at the cost of
  its own PPS admission budget (a genuine, visible tradeoff: DDoS ticks eat
  firewall throughput).
- Event feed announces start/end; the targeted switch gets a visual
  treatment (reuse the `congested` styling plus an `ATTACK` label chip on
  the canvas device).

**Where.** `types.ts` (`'ddos'` kind, `Packet.junk`), `game/constants.ts`
(`DDOS_RATE`, `DDOS_DURATION_TICKS`), `game/simulate.ts` (roll weighting,
junk emission in the traffic phase, firewall auto-drop branch, scoring/
pressure exemptions in the delivered/dropped accounting), `App.vue` canvas
chip, `PacketLayer.vue` (junk packets render in a distinct pattern - e.g.
hollow/dashed - plus the existing drop animation).

**Schema.** v11: migration clears transient `packets` (established pattern
for packet-shape changes, see v4 and v8 migrations).

**Tests.** Junk packet delivered to switch scores 0 and increments nothing;
junk packet arriving at a firewall is dropped and does not raise
`packetsDroppedThisTick`; real realtime packet loses admission to nothing
(junk sorts as `bulk` priority, so realtime still wins the queue - the
attack squeezes bulk/stream first, which is also real-world-accurate);
DDoS never rolls in `equipmentFailure: false` scenarios.

### 5. Honeypot device [DONE]

**Design.** New buildable `DeviceKind: 'honeypot'`. Cost $70, 1 port,
pps 10, rate 0, not in `FORWARDING_KINDS` (it is a sink, not a hop).
While a DDoS is active, each junk packet's route rolls
`HONEYPOT_LURE_CHANCE` (0.65): on success, its destination is re-targeted
from the target switch to a reachable, online honeypot instead (nearest by
route length). Junk delivered to a honeypot is absorbed: no cable load
beyond its own path leg, plus a small score trickle (+2/junk absorbed) so
the build pays back visibly. Outside DDoS windows a honeypot does nothing -
its cost is insurance, which fits the "pairs with DDoS" framing.

**Where.** `types.ts` (kind union), `game/constants.ts` (`DEVICE_RULES`,
`costs`, lure constants), `deviceIcons.ts` + `BUILD_OPTIONS` (icon:
lucide `Candy` is too whimsical; use `Magnet`), `game/simulate.ts` (junk
retargeting at emission time), removal/salvage falls out of existing
generic tables (the load-balancer precedent shows no kind-specific
branching is needed in `topology.ts`).

**Schema.** Shares v11 (new kind needs no migration; old saves simply have
none).

**Tests.** With an in-range honeypot and forced lure, junk routes terminate
at the honeypot and the target switch's uplink load is lower than the
no-honeypot control; honeypot rejects a second cable (1 port); salvage
returns 90%.

### 6. Power outage zone + UPS upgrade [DONE]

**Design.** New `ChallengeEventKind: 'powerOutage'`, rolled (like DDoS) only
in `equipmentFailure` scenarios. Picks a random center point in canvas
percent space, radius `OUTAGE_RADIUS` (20). Every device inside the circle
with no UPS goes `offline: true` for `OUTAGE_DURATION_TICKS` (8); the Cloud
Edge is exempt (upstream provider power). Existing behavior handles the
rest free of charge: offline devices are excluded from pathfinding, blink
via `offlineBlinkOn`, and `state.packets = []` is NOT needed since routes
re-resolve per packet - but any in-flight packet whose next hop is offline
follows the existing failed-cable conventions (packets on removed topology
are already cleared; here devices persist, so in-flight packets complete
their current cable and queue/drop at the dead device naturally).

Restoration: the event stores its affected device ids
(`ActiveEvent.affectedIds: string[]`, new optional field) so expiry
restores exactly the devices it downed (not ones that were already offline
for other reasons - equipment failure keeps its own `health: 0` state, and
restoration only clears `offline` for devices with `health > 0`).

**UPS upgrade.** Per-device purchasable in `game/upgrades.ts`:
`Device.ups: boolean`, cost `UPS_COST` ($45), available for infrastructure
kinds (router/switch/wireless/firewall/loadBalancer/server/honeypot). UPS
devices ignore outage zones. Counts toward `upgradeSpend` for salvage.
Site-wide "UPS everywhere" entry joins the existing site-upgrade list at the
standard 15% discount. Inspector shows a `UPS` chip; the outage circle
renders on the canvas for its duration (dashed ring, labeled `OUTAGE`).

**Where.** `types.ts` (`'powerOutage'`, `ActiveEvent.affectedIds?`,
`Device.ups`), `game/constants.ts` (costs/radius/duration),
`game/simulate.ts` (roll + apply + restore in `tickActiveEvents`),
`game/upgrades.ts` (`upgradeUps`, site variant), `App.vue` (canvas ring,
inspector row), `GameHud.vue` untouched.

**Schema.** v11: `device.ups ??= false`.

**Tests.** Outage downs only in-radius, non-UPS, `health > 0` devices;
expiry restores exactly `affectedIds` with `health > 0`; a device that
suffered equipment failure during the outage stays offline; UPS purchase
checks budget; site UPS applies discount.

---

## Phase 3 - New devices and economy (schema v12) [DONE]

### 7. Cache/CDN node [DONE]

**Design.** New buildable `DeviceKind: 'cache'`. Cost $130, 1 port, rate 0,
not forwarding. A cache serves its own subnet: when a source device on the
same subnet as an online, cable-connected cache generates a **bulk or
stream** Cloud-bound exchange, roll `CACHE_HIT_CHANCE` (0.35): on a hit,
the route's destination is the cache instead of the Cloud Edge - a much
shorter round trip that never touches the router/uplink. Realtime traffic
never hits cache (correct semantically: it is interactive). Cross-subnet
traffic is unaffected. Cache hit rate is upgradeable via the existing
`FORWARDING_SPEED_COSTS` pattern generalized: a `upgradeCacheHitRate`
purchase (+0.10 per level, max 0.55, $80/level) - stored as
`Device.cacheLevel: number` (0 default, reused as a generic per-kind
upgrade counter if a later device needs one).

**Where.** `types.ts` (kind, `cacheLevel`), `game/constants.ts`
(rules/costs/hit-chance table), `game/simulate.ts` (destination swap before
`findRoute`, gated on same-subnet reachability via the normal route check),
`game/upgrades.ts`, `deviceIcons.ts` (lucide `DatabaseZap`), inspector rows
in `App.vue` (hit level, hits served - track `Device.delivered` reuse: cache
deliveries increment its `delivered`, giving a free stat).

**Schema.** v12: `device.cacheLevel ??= 0`.

**Tests.** With forced hit, route ends at cache and router uplink load is
untouched; realtime traffic never caches; cache on subnet 1 does not serve
subnet 2; hit-rate upgrade caps at 0.55.

### 8. Wireless repeater [DONE]

**Design.** New buildable `DeviceKind: 'repeater'`. Cost $50, 1 port
(uplink cable optional - see below), rate 0. A repeater must sit inside a
live access point's coverage; it then extends that hub's coverage as a
second circle of radius `REPEATER_RANGE` (12, not upgradeable) centered on
itself. Clients associated via a repeater count toward the parent hub's
load (`wirelessClientLoad`) and consume the hub's PPS, plus a latency
penalty: packets from repeater-served clients start with
`queuedTicks: REPEATER_LATENCY_PENALTY` (1), which flows into the existing
`recentQueueDelayTicks` telemetry unchanged.

Chaining is not allowed (a repeater inside only another repeater's extended
zone is inactive) - keeps `buildWirelessAssociations` a two-pass resolve:
pass 1 associates repeaters to hubs, pass 2 associates clients to
hubs-or-active-repeaters. If its parent hub goes offline or interferes,
the repeater's zone shrinks/dies with it (interference factors apply to the
parent's effective range when validating the repeater's link, not the
repeater's own radius).

**Where.** `game/wireless.ts` carries almost all of it
(`buildWirelessAssociations` two-pass, `servingWirelessHub`, `wifiInfo`
display); `game/constants.ts` rules; `App.vue` renders repeater zones with
the existing Wi-Fi-zone styling (dashed to differ); `PacketLayer` untouched.

**Schema.** Shares v12 (new kind only).

**Perf note.** The two-pass association stays inside the existing
once-per-tick `buildWirelessAssociations` memoization; no per-packet cost.

**Tests.** Client in repeater zone but outside hub zone associates to the
parent hub; parent-offline kills the extension; no chaining; repeater-served
delivery accrues +1 queue delay vs. direct.

### 9. Bandwidth-metered income (scenario modifier) [DONE]

**Design.** New optional `Scenario.meteredIncome?: boolean`, enabled on
`isp` and `datacenter` (thematically: you are the provider). When set, the
flat 15-tick budget allocation (`25 + 5 * multiplier`) is replaced by a
delivery-metered payout over the same window:

```
income = BASE (10) + Σ per delivered packet in window:
         realtime $0.60, stream $0.35, bulk $0.20
         (junk: $0)   ... capped at 3x the flat allocation
```

Tracked via `GameState.windowIncomeCents: number` accumulated in the
delivered-packet loop and cashed/reset every 15 ticks. Rounded to whole
dollars at payout. The cap prevents runaway snowballing at high multiplier.
Event feed line shows the metered amount so players feel the link between
service quality and cash.

**Where.** `types.ts` (`meteredIncome`, `windowIncomeCents`),
`game/constants.ts` (rates per priority), `game/simulate.ts` (accumulate +
payout branch), scenario entries. HUD budget display unchanged.

**Schema.** v12: `windowIncomeCents ??= 0`.

**Tests.** Metered scenario with zero deliveries pays only BASE; realtime
deliveries pay more than the same count of bulk; cap holds; non-metered
scenarios unchanged.

---

## Phase 4 - Player decision layers (schema v13)

### 10. QoS policies (per-device priority boost)

**Design.** Expose the existing strict-priority admission as a decision.
Each forwarding device gets `Device.qosBoost: Priority | null` (default
null). When set, arriving packets of that priority sort above everything
else at that device (effective weight +10), regardless of base class. Free
to set, but each forwarding device can boost only one class, and a boosted
device pays an admission tax: effective PPS at that device drops by
`QOS_OVERHEAD` (10%, floor 1) - inspection costs throughput, which is the
real-world DPI tradeoff and prevents "boost realtime everywhere" from being
strictly free.

Cycled from the device inspector (same interaction pattern as the existing
VLAN/firewall cycling in `game/topology.ts`, which is the module this
belongs in: `cycleQosBoost(state, deviceId)`).

**Where.** `types.ts` (`qosBoost`), `game/topology.ts` (cycler),
`game/simulate.ts` (sort comparator + capacity reduction at admission),
`game/wireless.ts` `deviceCapacity` untouched (the reduction applies at the
admission site so display capacity stays honest - inspector shows
`pps (−10% QoS)` explicitly instead). Inspector UI + Help modal.

**Schema.** v13: `device.qosBoost ??= null`.

**Tests.** Boosted bulk admits before unboosted realtime at that device;
capacity reduction applies only while a boost is set; cycling walks
null -> realtime -> stream -> bulk -> null.

### 11. SLA contracts

**Design.** From `challengeStart` onward, every 120 ticks a contract is
offered (event-feed line + HUD chip with Accept/Decline; auto-declines
after 10 ticks). One active contract max. Contract shape:

```ts
type SlaContract = {
  id: string
  kind: 'latency' | 'delivery' // keep rolling avg latency under X | deliver N packets
  target: number // latency ticks (e.g. 3.5) or packet count
  windowTicks: number // 50
  reward: number // scales with difficulty: $80-200
  penaltyScore: number // score loss on failure: reward * 2 as points
  ticksRemaining: number
  accepted: boolean
}
```

Stored as `GameState.slaContract: SlaContract | null`. Evaluated per tick in
`simulate.ts`: latency contracts fail the moment `recentLatencyTicks`
exceeds target for `SLA_GRACE` (5) consecutive ticks (tracked in
`SlaContract` as a breach counter - transient breaches during an event are
survivable); delivery contracts succeed when the count accrued since
acceptance reaches target, fail at window end otherwise. Reward is budget;
penalty is score (budget-penalizing a struggling player is a death spiral;
score-penalizing a thriving one is a real stake).

Targets are derived from the run's current telemetry at offer time
(latency target = `max(2, recentLatencyTicks * 0.85)`, delivery target =
recent per-tick delivery rate * window * 1.1), so contracts are always
"beat your current self by ~15%" - self-balancing across scenarios and
skill levels.

**Where.** `types.ts`, `game/constants.ts` (cadence/grace/reward table),
`game/simulate.ts` (offer/evaluate/expire), a small
`acceptSlaContract`/`declineSlaContract` pair in `game/upgrades.ts`
(economy concern), HUD chip + accept/decline buttons in `GameHud.vue`
(emits, never mutates), Help modal tab.

**Schema.** v13: `slaContract ??= null`.

**Tests.** Offer appears on cadence; accept + sustained low latency pays
reward once; breach counter forgives a 4-tick spike but fails a 5-tick one;
declined/expired contracts clean up; no second offer while one is active;
sandbox runs still offer contracts but pay/penalize normally (they are the
fun part of the toy).

---

## Cross-cutting notes

- **Schema versions.** v10 (mode, history) - shipped. v11 (junk packets, ups,
  powerOutage/ddos events, honeypot), v12 (cache, repeater, metered income),
  v13 (qosBoost, slaContract) - not yet implemented. Each migration step
  follows the established `??=` backfill pattern in `game/persistence.ts`
  with a regression test per step. `CLAUDE.md`'s "Current `GameState.version`"
  line was fixed to `10` as part of the Phase 1 docs pass; keep it current as
  each later phase ships.
- **Event-roll rebalance.** Phase 2 grows the challenge roster from 4 to 6
  kinds. Proposed weighting in `equipmentFailure` scenarios:
  trafficSpike 25 / ddos 15 / powerOutage 10 / equipmentFailure 25 /
  budgetBonus 15 / deviceSurge 10. Non-equipmentFailure scenarios keep the
  current roster (no ddos/powerOutage/equipmentFailure) - the gentle
  scenarios stay gentle.
- **`SOURCE_SPAWN_ORDER` and build panel growth.** Three new buildable kinds
  (honeypot, cache, repeater) join `BUILD_OPTIONS`; the build panel list gets
  long - group it into "Core" and "Specialist" sections in `BuildPanel.vue`
  during Phase 3.
- **Determinism debt.** DDoS targeting, outage placement, lure/hit rolls all
  use `Math.random`, consistent with the existing engine. The seeded-PRNG
  refactor (prerequisite for daily challenges/true replay) is explicitly out
  of scope but every new roll site should go through a single
  `game/utils.ts` `chance(p)` helper now, so the later refactor is one
  function swap instead of a hunt.
- **Native parity.** All eleven features are web-only. Add a "Web-only
  gameplay additions" section to `PARITY.md` in Phase 1 and append per phase.
