# NetworkMaster Web

Browser-based adaptation of the NetworkMaster iOS network-management survival game. The app is a static Vue 3 + TypeScript site: simulation, saves, and rendering all run on the client. There is no backend, account system, or remote persistence.

The native reference implementation is in `../NetworkMaster`. Review its `NetworkMaster-SPEC.md`, `docs/architecture.md`, `docs/ui.md`, and Swift source before changing gameplay rules. `PARITY.md` tracks intentional gaps between the two versions.

## Commands

```bash
npm install          # install dependencies
npm run dev          # Vite development server
npm run check        # lint, tests, production build, and formatting check
npm run lint         # ESLint only
npm test             # Vitest gameplay rules
npm run build        # production bundle in dist/
npm run format       # apply Prettier formatting
```

Run `npm run check` before considering any change complete.

## File map

| File                   | Purpose                                                                                              |
| ---------------------- | ---------------------------------------------------------------------------------------------------- |
| `src/App.vue`          | Application shell, menu, HUD, canvas, inspectors, pointer interactions, and dialogs                  |
| `src/game.ts`          | Framework-independent scenarios, routing, simulation tick, economy, upgrades, and topology mutations |
| `src/cableGeometry.ts` | Orthogonal display routing, obstacle/overlap scoring, SVG paths, and packet interpolation            |
| `src/types.ts`         | Versioned persisted game model and shared gameplay types                                             |
| `src/game.test.ts`     | Gameplay regression tests                                                                            |
| `src/styles.css`       | Main responsive visual system                                                                        |
| `src/interaction.css`  | Cable hit targets, dragging, Wi-Fi zones, and upgrade-control styles                                 |
| `PARITY.md`            | Implemented and remaining native gameplay parity                                                     |
| `HOWTOPLAY.md`         | Full player-facing rules reference; the in-app Help modal is a condensed, tabbed version of it       |
| `eslint.config.js`     | Vue and TypeScript lint rules                                                                        |

## Architecture

`App.vue` owns reactive UI state and calls pure reducers from `game.ts`. Gameplay functions return a new JSON-safe `GameState`; they must not mutate the state object supplied by Vue. `cloneState` strips Vue proxies before a reducer changes its copy.

The simulation runs every 800 ms at normal speed:

1. Reset cable load and recover temporary faults.
2. Advance and deliver in-flight packets.
3. Count traffic on each active cable.
4. Generate traffic and resolve routes with breadth-first search.
5. Apply cable and infrastructure capacity limits.
6. Update wear, rolling failure pressure, combo, income, and difficulty.
7. Spawn devices, trigger faults, and evaluate game over.

Coordinates are stored as percentages so one topology works across iPad and desktop browser sizes. `computeCableRoutes` selects orthogonal lanes by penalizing device collisions, shared runs, crossings, bends, and length. Packet rendering must use the same computed route as its cable.

## Persistence

- Active run key: `networkmaster.active-run.v1`
- High score key: `networkmaster.best.v1`
- Personal leaderboard key: `networkmaster.leaderboard.v1` — a flat, unversioned `LeaderboardEntry[]` (id, scenario, score, delivered, tick, completedAt), capped at the 10 highest scores, managed entirely in `App.vue` (not part of `GameState`). `recordLeaderboardEntry` appends once per run on the `phase` transition into `'gameover'`.
- Tutorial-seen flag: `networkmaster.tutorial-seen.v1` — presence (any value) suppresses the onboarding card on future visits.
- Current `GameState.version`: `8`

Only load saves matching the current schema. Increment `GameState.version` when persisted fields change incompatibly, update the loader, and add a persistence regression test if migration is introduced. `migrateSavedGame` in `game.ts` backfills version 2 runs (which predate `milestonesReached` and `activeEvents`) to version 3, version 3 runs (which predate the per-device `interference` field) to version 4, version 4 runs (which predate `Packet.queuedTicks`) to version 5 by discarding their transient in-flight packets, version 5 runs (which predate `Cable.style`) to version 6, version 6 runs (which predate latency/queue-delay telemetry) to version 7, and version 7 runs (whose `events` were plain strings) to version 8 by stamping each with the save's current tick; `App.vue`'s loader delegates to it.

## Gameplay invariants

- Phones and tablets are Wi-Fi only and cannot receive cables. PC/TV/console keep wired ports but are also `WIRELESS_CAPABLE_KINDS`, so they can additionally join an access point's coverage — including simultaneously while cabled, for redundancy.
- End devices cannot connect directly to other end devices.
- Only routers may connect to the Cloud Edge.
- Duplicate cables and links exceeding port limits are rejected.
- Offline devices and failed cables are excluded from pathfinding.
- Any topology deletion clears in-flight packets so packets cannot traverse removed edges.
- Failure pressure is the total loss across the latest 20 ticks divided by the 30-drop threshold.
- Cable tiers, capacities, and upgrade prices must remain ordered in `CABLE_TIERS`.
- Infrastructure and site upgrades must check budget before changing state.
- Traffic eases in over each scenario's `warmupTicks` from `warmupFloor` to full (native `warmupFactor`); the opening minutes stay quiet.
- Challenge events roll every 90 ticks from a scenario's `challengeStart` (native roster: traffic spike, budget bonus, device surge, and — only when `equipmentFailure` is set — equipment failure). A traffic spike doubles one source's demand for 10 ticks via `activeEvents`.
- Delivery-count milestones (`MILESTONES`) each pay a one-time budget award, recorded in `milestonesReached`.
- Game over adds a `networkHealthBonus` to the score: surviving-source ratio times lifetime delivery ratio, scaled to 1000.
- Wireless access points (`kind: 'wireless'`) occasionally suffer interference (`Device.interference`, ticks remaining), cutting their effective range to 60% and throughput to 50% via `hubRange`/`hubPps`; chance per tick is higher while a hub is actively serving a wireless-capable client.
- In non-`home` scenarios, ~30% of generated source traffic targets another device on a different subnet (via the router) instead of the Cloud Edge.
- Forwarding devices (router/switch/wireless/firewall) admit only as many packets per tick as their effective PPS, in strict priority order (realtime > stream > bulk, ties keep arrival order). Overflow waits as a real packet in `Packet.queuedTicks` at that device — not a counter — and is dropped only after `QUEUE_CAPACITY_TICKS` (6) ticks unadmitted.
- Cables carry a `style` of `'rightAngle'` (routed by `computeCableRoutes`'s obstacle-avoiding lane planner) or `'diagonal'` (drawn as a direct line between endpoints, skipping the orthogonal scoring and occupancy tracking entirely).
- `rerouteCable` moves one end of an existing cable to a new device, re-running the same validation as `addCable` (no end-device-to-end-device links, no wireless-only endpoints, Cloud Edge only via router, no duplicate links, target port limit) while preserving the cable's tier, VLAN, style, and upgrade spend.
- A wireless-capable client connects to the least-loaded in-range access point (`wirelessClientLoad`, a count of `WIRELESS_CAPABLE_KINDS` devices in that hub's coverage circle), breaking ties by nearest distance — not simply the nearest hub.
- Wireless access points have exactly one port (`DEVICE_RULES.wireless.ports`) — they only ever need a single uplink cable — and, like router/switch, get an independent `upgradeDeviceSpeed` throughput upgrade (`FORWARDING_SPEED_COSTS`/`FORWARDING_SPEED_GAIN`, keyed by kind) on top of the Wi-Fi generation upgrade. `upgradeWifi` applies only the generation's pps _delta_, not an overwrite, so a prior speed-upgrade bonus survives a later generation upgrade.
- `GameState.recentLatencyTicks`/`recentQueueDelayTicks` are rolling averages (75% history / 25% latest, matching the native HUD weighting) updated per delivered packet: latency is `tick - generatedTick`, queue delay is the packet's accumulated `queuedTicks`.
- `GameState.events` is `GameEvent[]` (`{ tick, text }`), not `string[]` — always add entries through `addEvent(state, text)` (mutating) or `event(state, text)` (for the `{...state, events: [...]}` rejection-path literal pattern), never `state.events.unshift(text)` directly. Each entry is stamped with the tick it happened on so the HUD can display the real elapsed time instead of deriving a countdown from list position (which used to keep incrementing even while the visible text was unchanged, since most ticks produce no event).

## Canvas, tutorial, and advisor (App.vue)

- The canvas wraps its routed SVG, Wi-Fi zones, devices, and packets in a `.canvas-stage` div transformed by `canvasTransform` (`translate(panX, panY) scale(zoom)`); device-percentage coordinates are unaffected since the transform applies to the whole layer. Wheel zoom and pointer drag-to-pan live on the outer `.canvas`; `startDeviceDrag` calls `event.stopPropagation()` so dragging a device doesn't also pan the background. Zoom clamps to `[ZOOM_MIN, ZOOM_MAX]` (0.6–2.5); `resetView` zeroes pan and zoom.
- The minimap is a static read-only overview SVG (devices as dots, cables as lines, using the same 0–100 coordinate space) — it does not track or respond to the current pan/zoom viewport.
- `advisorTip` is a computed, prioritized one-liner ("Jackie") reading live game state (failure pressure, congestion, out-of-range devices, budget, queue delay, combo) — pure presentation, not persisted or part of `GameState`.
- The tutorial is a 5-step onboarding card shown once per browser (gated by `TUTORIAL_SEEN_KEY`), entirely client-side UI state (`tutorialStep`/`tutorialActive`), not tied to `GameState`.
- Cable labels sit at `pointAlongRoute(route.points, 0.5)` — the actual routed midpoint, not the geometric midpoint of the endpoints — so the label follows orthogonal bends correctly. Each shows the cable's tier/speed (always neutral `--ink`) above its live `load/capacity` traffic figure, which is colored by the same `active`/`congested`/`failed` status class as the link itself.
- Device throughput bars (canvas + inspector) compare `deviceThroughputUsed` (sum of load on a device's attached cables) against `deviceCapacity` (exported from `game.ts`; `hubPps` for wireless, `pps` otherwise) — this is a display-only approximation of admitted traffic, not the exact per-tick admission count from `simulate`.
- An offline device (`Device.offline`) blinks between its normal icon and an `Unplug` icon. This is Vue-data-driven, not CSS-animation-driven: a single `offlineBlinkOn` ref flips every 800ms (one `setInterval` for the whole app), and each device's icon is `v-if="!d.offline || offlineBlinkOn"` vs. `v-else` `<Unplug>` — an online device's condition is always true regardless of the shared flag, so only offline devices ever toggle. (An earlier CSS-`animation`-based version was replaced after a bug where all devices appeared to blink.)

## Code standards

- Prefer descriptive domain names such as `networkCable`, `sourceDevice`, and `rollingDropTotal`; avoid one-letter variables outside tiny coordinate math.
- Keep gameplay logic in `game.ts`, not Vue templates.
- Use named Vue event handlers when an interaction performs more than one statement.
- Add docblocks for exported gameplay functions and comments for non-obvious invariants or geometry. Do not comment self-evident syntax.
- Keep all persisted state serializable—no DOM objects, Vue refs, class instances, functions, Maps, or Sets in `GameState`.
- Use `import type` for type-only imports.
- Add a Vitest regression test for every gameplay or persistence bug fix.
- Preserve touch targets: device dragging uses pointer events and cables have an invisible 28 px hit path.
- When a change touches a number or rule a player would notice (costs, capacities, thresholds, upgrade effects), update `HOWTOPLAY.md` and the in-app Help modal (`App.vue`, `modal === 'help'`) in the same change.

## UI constraints

- Support modern Safari on iPad as well as current Chromium and Firefox browsers.
- Do not rely solely on `crypto.randomUUID`; the compatibility fallback supports older/non-secure contexts.
- Keep controls usable at the 900 px and 600 px responsive breakpoints.
- Status must be communicated with labels as well as color.
- Avoid inline multi-statement Vue template expressions; Vue's template parser can reject Prettier-expanded expressions.
