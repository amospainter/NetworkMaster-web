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

| File                   | Purpose                                                                                                                                                                                                                     |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/App.vue`          | Root shell: still owns `game`/`selected`/`cableStart`/`modal` state and the canvas, device/cable inspectors, and secondary modals (help/upgrades/stats/leaderboard) — the highest-interdependency UI, not yet split further |
| `src/components/`      | Extracted, single-purpose presentational components (see below)                                                                                                                                                             |
| `src/composables/`     | Extracted stateful logic reused by/isolated from `App.vue` (see below)                                                                                                                                                      |
| `src/deviceIcons.ts`   | `deviceIcons` map and `BUILD_OPTIONS`, shared by `App.vue`, `BuildPanel.vue`, and any future canvas/inspector split                                                                                                         |
| `src/game/`            | Framework-independent gameplay engine, split by concern (see below); `index.ts` is the public barrel                                                                                                                        |
| `src/cableGeometry.ts` | Orthogonal display routing, obstacle/overlap scoring, SVG paths, and packet interpolation                                                                                                                                   |
| `src/types.ts`         | Versioned persisted game model and shared gameplay types                                                                                                                                                                    |
| `src/game.test.ts`     | Gameplay regression tests                                                                                                                                                                                                   |
| `src/styles.css`       | Main responsive visual system                                                                                                                                                                                               |
| `src/interaction.css`  | Cable hit targets, dragging, Wi-Fi zones, and upgrade-control styles                                                                                                                                                        |
| `PARITY.md`            | Implemented and remaining native gameplay parity                                                                                                                                                                            |
| `HOWTOPLAY.md`         | Full player-facing rules reference; the in-app Help modal is a condensed, tabbed version of it                                                                                                                              |
| `eslint.config.js`     | Vue and TypeScript lint rules                                                                                                                                                                                               |

### `src/components/` and `src/composables/` breakdown

`App.vue` was ~1244 lines before this split; extraction is intentionally incremental (composables first, then only the lowest-coupling leaf components) rather than a single rewrite, so each step could be verified independently against `npm run check` and a live smoke test before the next.

| File                                | Owns                                                                                                                                                                                                                                                               |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `composables/useCanvasPanZoom.ts`   | Wheel-zoom / drag-to-pan state and handlers for the topology canvas.                                                                                                                                                                                               |
| `composables/useSimulationClock.ts` | The tick `setInterval` (synced to pause/speed) and the `requestAnimationFrame` clock behind `packetVisualProgress`.                                                                                                                                                |
| `composables/useLeaderboard.ts`     | Loads/persists the personal leaderboard; records an entry on the `phase` → `'gameover'` transition internally.                                                                                                                                                     |
| `composables/useTutorial.ts`        | The 4-step onboarding card's step/active state and `TUTORIAL_STEPS` content.                                                                                                                                                                                       |
| `composables/useOfflineBlink.ts`    | The `offlineBlinkOn` toggle interval powering the offline-device icon swap.                                                                                                                                                                                        |
| `components/MenuScreen.vue`         | The main menu: hero, scenario grid, legal footer. `v-model:chosen`/`v-model:dark`, emits `start`/`continueGame`/`openLeaderboard`. Each scenario card shows a themed icon (`SCENARIO_ICONS`) and its own Play button (`playScenario`) — see the canvas note below. |
| `components/GameHud.vue`            | Top bar + score/budget/failure-pressure HUD. `v-model:dark`, emits `openUpgrades`/`openHelp`/`exitToMenu`/`togglePause` (never mutates the `game` prop directly — `vue/no-mutating-props`).                                                                        |
| `components/BuildPanel.vue`         | The left equipment-purchase list, a stamp tool: emits `select(kind)` to arm/disarm a build kind (`activeKind` prop highlights it); `App.vue` places the device where the canvas is clicked.                                                                        |
| `components/GameOverModal.vue`      | The game-over card. Emits `tryAgain`/`continueUnscored`/`openLeaderboard`/`mainMenu`.                                                                                                                                                                              |
| `components/PacketLayer.vue`        | Renders in-flight packets and owns their per-frame position interpolation (see Performance below); isolates the 60fps `requestAnimationFrame` dependency to this leaf so the rest of the canvas re-renders only per tick.                                          |
| `components/HoverTooltip.vue`       | Pure presentational floating info box (`title` + `rows` props) positioned at a fixed viewport `x`/`y`. `App.vue` owns the hover state and content; see the canvas note below.                                                                                      |
| `components/ScenarioBriefing.vue`   | The start-of-run modal showing a scenario's `objective`/`firstSteps` (from `Scenario` in `game/constants.ts`). `App.vue`'s `start()` sets `briefingActive`; see the canvas note below for how it sequences with the one-time tutorial card.                        |

Still living in `App.vue` (deliberately, for now): the canvas (SVG links, Wi-Fi zones, devices, packets, minimap, cable labels, tutorial card, advisor tip), the device/cable inspector, and the secondary modals (help/upgrades/stats/leaderboard). These share the deepest state (`selected`, `cableStart`, `cableStyle`, `reroutingCable`, drag handlers) and were judged higher-risk to split without a proper provide/inject or state-management pass — see PARITY-style tracking below before attempting it.

## Architecture

`App.vue` owns reactive UI state and calls pure reducers imported from `./game` (the `src/game/` barrel). Gameplay functions return a new JSON-safe `GameState`; they must not mutate the state object supplied by Vue. `cloneState` strips Vue proxies before a reducer changes its copy.

### `src/game/` module breakdown

`src/game/index.ts` re-exports the engine's public API by name (not `export *`) so it doubles as documentation of what `App.vue`/`game.test.ts` may depend on. Internal helpers stay private to their owning module. Dependency order (each only imports from modules above it):

| Module           | Contents                                                                                                                             |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `constants.ts`   | Pure data only: `SCENARIOS`, `CABLE_TIERS`, `WIFI_STANDARDS`, `DEVICE_RULES`, `MILESTONES`, cost/upgrade tables.                     |
| `utils.ts`       | `createId`, `cloneState`, `event`/`addEvent`, `distanceBetween`, `discountedSiteCost` — generic, no game-rule logic.                 |
| `factories.ts`   | `createDevice`, `createCable`, `connectDevices`, `createScenarioTopology`.                                                           |
| `wireless.ts`    | `hubRange`, `hubPps`, `deviceCapacity`, hub selection/load-balancing, `servingWirelessHub`, `wifiInfo`, `buildWirelessAssociations`. |
| `routing.ts`     | `findRoute` (BFS), `independentPathCount`, cross-subnet destination/route helpers.                                                   |
| `persistence.ts` | `newGame`, `networkHealthBonus`, `migrateSavedGame` — everything touching the versioned schema.                                      |
| `simulate.ts`    | The `simulate()` tick reducer and its private helpers (challenge events, milestones, Wi-Fi interference, warmup).                    |
| `topology.ts`    | Structural mutations: `addCable`, `rerouteCable`, `buildDevice`, `removeDevice`, `moveDevice`, VLAN/firewall cycling.                |
| `upgrades.ts`    | Economy/purchasing: per-item and site-wide upgrades, repair.                                                                         |

When adding a gameplay function, put it in the module matching its concern above, add it to `index.ts`'s explicit export list if `App.vue` or tests need it, and keep imports flowing downward through this table (e.g. `simulate.ts` may import from `routing.ts`, never the reverse) to avoid circular imports.

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
- The active-run write is trailing-debounced 400ms (`scheduleActiveRunPersist`/`flushActiveRunPersist` in `App.vue`) so a burst of rapid state changes (e.g. simulation ticks, a device drag once that path exists) collapses into one `JSON.stringify` + `localStorage.setItem` instead of one per change. A pending write is flushed immediately on `visibilitychange` (tab hidden) and `pagehide`, and on component unmount, so backgrounding or closing the tab mid-debounce cannot lose the latest state. The personal-best write is not debounced (cheap, infrequent).

Only load saves matching the current schema. Increment `GameState.version` when persisted fields change incompatibly, update the loader, and add a persistence regression test if migration is introduced. `migrateSavedGame` in `game/persistence.ts` backfills version 2 runs (which predate `milestonesReached` and `activeEvents`) to version 3, version 3 runs (which predate the per-device `interference` field) to version 4, version 4 runs (which predate `Packet.queuedTicks`) to version 5 by discarding their transient in-flight packets, version 5 runs (which predate `Cable.style`) to version 6, version 6 runs (which predate latency/queue-delay telemetry) to version 7, and version 7 runs (whose `events` were plain strings) to version 8 by stamping each with the save's current tick; `App.vue`'s loader delegates to it.

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
- Forwarding devices (router/switch/wireless/firewall/loadBalancer) admit only as many packets per tick as their effective PPS, in strict priority order (realtime > stream > bulk, ties keep arrival order). Overflow waits as a real packet in `Packet.queuedTicks` at that device — not a counter — and is dropped only after `QUEUE_CAPACITY_TICKS` (6) ticks unadmitted.
- Load balancers (`kind: 'loadBalancer'`) are a fixed-port (4) forwarding device with no port-upgrade path (unlike router/switch's `upgradeDevicePorts`) — only `upgradeDeviceSpeed` applies, via `FORWARDING_SPEED_COSTS`/`FORWARDING_SPEED_GAIN`. Cable validation, admission, and removal/salvage all fall out of the same `costs`/`FORWARDING_KINDS`/`DEVICE_RULES` data tables every other forwarding device uses — no kind-specific branching was needed in `game/topology.ts`.
- `findRoute` (`game/routing.ts`) shuffles a load balancer's edge order before its BFS traversal, so when a load balancer has two or more equally-short downstream branches (e.g. two separate router/Cloud uplinks), which branch wins the BFS tie-break varies per call instead of always resolving the same way. Since `simulate()` calls `findRoute` independently once per generated packet, this spreads outbound traffic across those branches over many packets rather than a single fixed route — this is the load balancer's actual "balancing" behavior (regular forwarding devices keep deterministic shortest-path routing). It only affects ties between equal-length branches; a genuinely shorter path is still always preferred. There's no separate inbound leg to balance, since the sim only models one-way upload traffic (see the native-parity gap in `PARITY.md`).
- `createScenarioTopology` (`game/factories.ts`) composes each non-`home` scenario from feature flags in `SCENARIO_TOPOLOGY` (a `Record<scenarioId, { wireless?, firewall?, server?, extraServer?, thirdSubnet?, backbone? }>`) layered on the always-present cloud/router/SW-A/SW-B base. These are independent, so a scenario can mix features the old mutually-exclusive `.includes(scenarioId)` checks couldn't — e.g. `smartcity` has `wireless` AND `firewall`/`server` at once. `wireless` is a Wi-Fi generation index; because `0` is valid (802.11b), the factory checks `!== undefined`, not truthiness. `extraServer` adds a second server on SW-A/subnet 1 (Data Center's east-west traffic); `backbone` upgrades all starting cables to 10 Gigabit.
- The **dual-router core** (a second `Router-B` with its own Cloud Edge uplink, bridged to `SW-A`/`SW-B` through a load balancer that fills all 4 of its ports) is driven separately by `DUAL_ROUTER_LAYOUT` (a `Record<scenarioId, {switchA, switchB, routerB, loadBalancer}>` of canvas coordinates) — presence of an entry is the single source of truth for "does this scenario get a load balancer" and where it sits. `corporate`/`metro`/`isp`/`datacenter`/`smartcity` have entries; each layout is deliberately different (tight central stack / wide switches / corner hub-and-spoke / low-compact / wide-high) so they don't render as the same silhouette on the menu preview or canvas, since they share device/cable structure. `SW-C` and the firewall still connect straight to the primary router; `SW-C` sits off the `x=50` axis so its cable doesn't run through the stack. `branch` keeps a single router and only a server (its "every backup link counts" leanness is intentional — redundancy is earned there). Nothing in `game/topology.ts`/`game/simulate.ts` needs to know a scenario has two routers, since routing/admission/upgrades are already generic per device.
- `SCENARIOS` (in `game/constants.ts`) is ordered easiest→hardest with `home` first — this array order IS the menu display order. A regression test asserts non-decreasing `difficulty` with `home` at index 0, so keep new scenarios in difficulty order when adding them. `MILESTONES` is keyed by scenario id (falls back to `home`'s table if a key is missing) — add a matching entry for every new scenario.
- Every non-`home` scenario starts with exactly one unconnected end device per subnet (`Desk-A1`, `Display-B`) rather than a full set on both sides of every switch — the fuller roster made the initial canvas cluttered and its cable labels unreadable, especially in the dual-router scenarios. `spawnDevice()` (in `simulate.ts`) is what introduces more source devices as a run progresses, so trimming the starting roster doesn't reduce a run's eventual complexity, only its opening screen.
- Cables carry a `style` of `'rightAngle'` (routed by `computeCableRoutes`'s obstacle-avoiding lane planner) or `'diagonal'` (drawn as a direct line between endpoints, skipping the orthogonal scoring and occupancy tracking entirely). Both new player-drawn cables (`App.vue`'s `cableStyle` ref) and every scenario's starting cables (`createCable`'s default parameter in `factories.ts`, inherited by `connectDevices`) default to `'diagonal'` — orthogonal routing's lane planner packs many short cables into shared lanes when a topology has several closely-spaced devices (as the dual-router scenarios do), which crowded their cable labels on top of each other; a direct line spreads label midpoints out naturally instead.
- `rerouteCable` moves one end of an existing cable to a new device, re-running the same validation as `addCable` (no end-device-to-end-device links, no wireless-only endpoints, Cloud Edge only via router, no duplicate links, target port limit) while preserving the cable's tier, VLAN, style, and upgrade spend.
- A wireless-capable client connects to the least-loaded in-range access point (`wirelessClientLoad`, a count of `WIRELESS_CAPABLE_KINDS` devices in that hub's coverage circle), breaking ties by nearest distance — not simply the nearest hub.
- Wireless access points have exactly one port (`DEVICE_RULES.wireless.ports`) — they only ever need a single uplink cable — and, like router/switch, get an independent `upgradeDeviceSpeed` throughput upgrade (`FORWARDING_SPEED_COSTS`/`FORWARDING_SPEED_GAIN`, keyed by kind) on top of the Wi-Fi generation upgrade. `upgradeWifi` applies only the generation's pps _delta_, not an overwrite, so a prior speed-upgrade bonus survives a later generation upgrade.
- `GameState.recentLatencyTicks`/`recentQueueDelayTicks` are rolling averages (75% history / 25% latest, matching the native HUD weighting) updated per delivered packet: latency is `tick - generatedTick`, queue delay is the packet's accumulated `queuedTicks`.
- `GameState.events` is `GameEvent[]` (`{ tick, text }`), not `string[]` — always add entries through `addEvent(state, text)` (mutating) or `event(state, text)` (for the `{...state, events: [...]}` rejection-path literal pattern), never `state.events.unshift(text)` directly. Each entry is stamped with the tick it happened on so the HUD can display the real elapsed time instead of deriving a countdown from list position (which used to keep incrementing even while the visible text was unchanged, since most ticks produce no event).

## Canvas, tutorial, and advisor (App.vue)

- The canvas wraps its routed SVG, Wi-Fi zones, devices, and packets in a `.canvas-stage` div transformed by `canvasTransform` (`translate(panX, panY) scale(zoom)`); device-percentage coordinates are unaffected since the transform applies to the whole layer. Wheel zoom and pointer drag-to-pan live on the outer `.canvas`; `startDeviceDrag` calls `event.stopPropagation()` so dragging a device doesn't also pan the background. Zoom clamps to `[ZOOM_MIN, ZOOM_MAX]` (0.6–2.5); `resetView` zeroes pan and zoom.
- Building equipment is a stamp tool: picking a `BuildPanel` option sets `placingKind` (arming it, highlighted, and disabling device drag/cable-select and canvas panning via the same guard `useCanvasPanZoom` already uses for cable draw/reroute) rather than placing immediately. `trackGhost` converts the live pointer position to canvas-stage percent coordinates (via `canvasStageEl`'s `getBoundingClientRect`, the same transform-aware math `moveDraggedDevice` uses) to position a dashed, semi-transparent `.ghost-device` preview; a canvas click calls `buildDevice` at that position via `placeArmedDevice`. The tool stays armed after each placement for stamping several at once — clicking the same `BuildPanel` button again or pressing `Esc` (`handleEscapeKey`, a `window` listener) disarms it.
- The minimap is a static read-only overview SVG (devices as dots, cables as lines, using the same 0–100 coordinate space) — it does not track or respond to the current pan/zoom viewport.
- `advisorTip` is a computed, prioritized one-liner ("Jackie") reading live game state (failure pressure, congestion, out-of-range devices, budget, queue delay, combo) — pure presentation, not persisted or part of `GameState`.
- The tutorial is a 4-step onboarding card shown once per browser (gated by `TUTORIAL_SEEN_KEY`), entirely client-side UI state (`tutorialStep`/`tutorialActive`), not tied to `GameState`. `TUTORIAL_STEPS` intentionally has no "pick a scenario and start a run" step — this card only ever renders once a run is already underway (gated by `tutorialActive && !briefingActive` inside the game screen), so telling the player to do the thing they just did was dead copy, not a first step.
- `ScenarioBriefing` shows every time `start()` begins a new run (not on "Continue"), regardless of whether the browser has seen it before — it's per-scenario context, not a one-time thing like the tutorial. The tutorial card's `v-if` is gated with `&& !briefingActive` so the two don't render stacked on a brand-new player's very first run; dismissing the briefing (`dismissBriefing()`) reveals the tutorial underneath it instead.
- Cable labels sit at `pointAlongRoute(route.points, 0.5)` — the actual routed midpoint, not the geometric midpoint of the endpoints — so the label follows orthogonal bends correctly. Each shows the cable's tier/speed (always neutral `--ink`) above its live `load/capacity` traffic figure, which is colored by the same `active`/`congested`/`failed` status class as the link itself.
- Device throughput bars (canvas + inspector) compare `deviceThroughputUsed` (sum of load on a device's attached cables) against `deviceCapacity` (exported from `game/wireless.ts`; `hubPps` for wireless, `pps` otherwise) — this is a display-only approximation of admitted traffic, not the exact per-tick admission count from `simulate`.
- An offline device (`Device.offline`) blinks between its normal icon and an `Unplug` icon. This is Vue-data-driven, not CSS-animation-driven: a single `offlineBlinkOn` ref flips every 800ms (one `setInterval` for the whole app), and each device's icon is `v-if="!d.offline || offlineBlinkOn"` vs. `v-else` `<Unplug>` — an online device's condition is always true regardless of the shared flag, so only offline devices ever toggle. (An earlier CSS-`animation`-based version was replaced after a bug where all devices appeared to blink.)
- Hovering a device or cable shows a floating `HoverTooltip` (device: status, ports, health/wear, throughput; cable: A/Z device names, tier, status, age) via `@pointerenter`/`@pointerleave` on the device button and the cable's `<g>` wrapper. `hoverPos` is stored in **viewport pixels**, not canvas percent, and `HoverTooltip` renders with `position: fixed`; it's rendered as a sibling of `.canvas-stage` (not inside it) because `.canvas-stage` carries `transform: canvasTransform`, and a transformed ancestor establishes its own containing block for `position: fixed` descendants — placing the tooltip inside would make its "fixed" position track the pan/zoom transform instead of the real viewport. A device's tooltip anchors above the hovered element's own bounding rect (set once, at `pointerenter`); a cable's tooltip follows the pointer via `pointermove` instead, since a cable has no single anchor point. `startDeviceDrag` calls `hideTooltip()` on pointerdown so a stale tooltip doesn't linger at its pre-drag position. Hover has no touch equivalent (no `pointerenter` on tap), which is fine since the same fields are already in the click-opened inspector.

## Menu scenario iconography (MenuScreen.vue)

- Each scenario card shows one themed lucide icon (`SCENARIO_ICONS`, keyed by scenario id — House/Coffee/Rocket/GraduationCap/Building2/Landmark/GitBranch/PartyPopper/Globe/Server/Zap/Building) in a `.scenario-icon` tile, rather than a generated topology diagram. An earlier version rendered each scenario's actual starting devices/cables as a mini dot-and-line diagram, but several scenarios share very similar starting shapes (most non-`home` scenarios are some variant of two-switches-off-a-router), so the diagrams didn't read as distinct at a glance — a themed icon per scenario does. Every entry in `SCENARIOS` must have a matching `SCENARIO_ICONS` key; add one when adding a scenario.
- Each card is a `<div role="button" tabindex="0">`, not a native `<button>`, specifically so it can contain a real nested `<button class="scenario-play">` (browsers reject/relocate a `<button>` inside a `<button>`). Since converting away from `<button>` drops the global `button` reset's `background`/`cursor`, `.scenario-card` sets those explicitly, plus its own `:focus-visible` outline (mirroring the global one) since that also no longer applies. The Play button calls `playScenario(id)` — a named method, not an inline handler, per the "avoid inline multi-statement Vue template expressions" rule below, since it needs to both set `chosen` and emit `start`. Its `@click.stop` keeps the click from also bubbling to the card's own select handler. It exists because the hero's "Start new run" button scrolls out of view once the scenario grid is scrolled to, so picking and launching a scenario used to require scrolling back up.

## Performance

- `simulate()` resolves each wireless-capable device's serving access point once per tick via `buildWirelessAssociations` (in `game/wireless.ts`) and threads that map through every `findRoute`/`findRouteThrough`/`independentPathCount` call for the rest of the tick, instead of each call re-deriving every hub's client load and re-sorting hubs. This is safe because wireless association depends only on device position/status, not cable topology — `independentPathCount`'s internal cable-filtered clone can reuse the same map. All three functions still accept an optional final `wirelessAssociations` param and build one internally when omitted, so call sites outside `simulate()` (tests, one-off UI lookups) are unaffected.
- The redundancy-bonus check in `simulate()`'s delivered-packet loop is memoized per `(source, destination)` pair within the tick (`redundancyMemo`), since topology cannot change mid-tick and multiple packets often share a route.
- `App.vue` mirrors this per-tick memoization for render-only lookups that would otherwise be recomputed once per template binding: `wirelessHubLabelById`, `deviceThroughputUsedById`, `throughputRatioById`, and `deviceById` are computeds resolved once per game-state change; `wirelessHubLabel`/`deviceThroughputUsed`/`throughputRatio` are kept as functions backed by those maps so template call sites didn't need to change.
- Packet rendering is isolated in `components/PacketLayer.vue` specifically because `packetVisualProgress` (from `useSimulationClock`) depends on a `requestAnimationFrame`-driven ref and must recompute at 60fps for smooth motion. Reading that dependency inside a computed that lives in `App.vue` would force the _entire_ canvas (devices, cables, inspector) to re-render every frame; keeping the computed inside the leaf component confines the 60fps subscription to it. `.packet` also sets `contain: layout style` so its per-frame `left`/`top` updates don't force the browser to re-measure sibling devices/cables — full `transform`-based positioning was considered but rejected because CSS `translate()` percentages resolve against the element's own box, not its percentage-positioned parent, which would require pixel math tied to the stage's rendered size.
- `GameState` is fully JSON-cloned by every reducer (`cloneState`) and by `App.vue`'s active-run persistence write, so avoid adding gameplay functions that get called per-packet or per-frame without first checking whether their result can be memoized per tick the way the wireless/redundancy lookups above are.

## Code standards

- Prefer descriptive domain names such as `networkCable`, `sourceDevice`, and `rollingDropTotal`; avoid one-letter variables outside tiny coordinate math.
- Keep gameplay logic in `src/game/`, not Vue templates.
- Use named Vue event handlers when an interaction performs more than one statement.
- Add docblocks for exported gameplay functions and comments for non-obvious invariants or geometry. Do not comment self-evident syntax.
- Keep all persisted state serializable—no DOM objects, Vue refs, class instances, functions, Maps, or Sets in `GameState`.
- Use `import type` for type-only imports.
- Add a Vitest regression test for every gameplay or persistence bug fix.
- Preserve touch targets: device dragging uses pointer events and cables have an invisible 28 px hit path.
- Never mutate a field on `game.value` directly in `App.vue` (e.g. `game.value.phase = ...`) — always reassign `game.value = { ...game.value, ... }` (or call a reducer). The active-run persistence watch is a shallow `watch(game, ...)`, not `deep: true`, so it only fires on reassignment; an in-place mutation would still update the UI (refs wrap objects reactively) but would silently stop being persisted or memoized correctly by the lookups in Performance above.
- When a change touches a number or rule a player would notice (costs, capacities, thresholds, upgrade effects), update `HOWTOPLAY.md` and the in-app Help modal (`App.vue`, `modal === 'help'`) in the same change.

## UI constraints

- Support modern Safari on iPad as well as current Chromium and Firefox browsers.
- Do not rely solely on `crypto.randomUUID`; the compatibility fallback supports older/non-secure contexts.
- Keep controls usable at the 900 px and 600 px responsive breakpoints.
- Status must be communicated with labels as well as color.
- Avoid inline multi-statement Vue template expressions; Vue's template parser can reject Prettier-expanded expressions.
