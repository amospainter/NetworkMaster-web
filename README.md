# NetworkMaster Web

A browser-native adaptation of the NetworkMaster iOS game, built with Vue 3, TypeScript, and Vite. All simulation and persistence run locally in the browser; there is no application server or account system.

## Development

```bash
npm install
npm run dev
```

Create a production bundle with `npm run build`. Vite writes the static site to `dist/`, which can be hosted by any static web host.

## Architecture

- `src/game.ts` — framework-independent topology, pathfinding, traffic, scoring, economy, and congestion simulation
- `src/App.vue` — Vue application shell, menus, HUD, topology canvas, inspectors, and dialogs
- `src/types.ts` — persisted game model
- `PARITY.md` — implemented and remaining iOS gameplay parity
- Browser `localStorage` — active run and personal best

Saved games use a versioned key so future migrations can be added without a backend.
