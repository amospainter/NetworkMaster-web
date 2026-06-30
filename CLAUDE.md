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
- Current `GameState.version`: `2`

Only load saves matching the current schema. Increment `GameState.version` when persisted fields change incompatibly, update the loader, and add a persistence regression test if migration is introduced.

## Gameplay invariants

- Phones and tablets are Wi-Fi only and cannot receive cables.
- End devices cannot connect directly to other end devices.
- Only routers may connect to the Cloud Edge.
- Duplicate cables and links exceeding port limits are rejected.
- Offline devices and failed cables are excluded from pathfinding.
- Any topology deletion clears in-flight packets so packets cannot traverse removed edges.
- Failure pressure is the total loss across the latest 20 ticks divided by the 30-drop threshold.
- Cable tiers, capacities, and upgrade prices must remain ordered in `CABLE_TIERS`.
- Infrastructure and site upgrades must check budget before changing state.

## Code standards

- Prefer descriptive domain names such as `networkCable`, `sourceDevice`, and `rollingDropTotal`; avoid one-letter variables outside tiny coordinate math.
- Keep gameplay logic in `game.ts`, not Vue templates.
- Use named Vue event handlers when an interaction performs more than one statement.
- Add docblocks for exported gameplay functions and comments for non-obvious invariants or geometry. Do not comment self-evident syntax.
- Keep all persisted state serializable—no DOM objects, Vue refs, class instances, functions, Maps, or Sets in `GameState`.
- Use `import type` for type-only imports.
- Add a Vitest regression test for every gameplay or persistence bug fix.
- Preserve touch targets: device dragging uses pointer events and cables have an invisible 28 px hit path.

## UI constraints

- Support modern Safari on iPad as well as current Chromium and Firefox browsers.
- Do not rely solely on `crypto.randomUUID`; the compatibility fallback supports older/non-secure contexts.
- Keep controls usable at the 900 px and 600 px responsive breakpoints.
- Status must be communicated with labels as well as color.
- Avoid inline multi-statement Vue template expressions; Vue's template parser can reject Prettier-expanded expressions.
