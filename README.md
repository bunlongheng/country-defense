# Country Defense

Pick any of the world's 194 countries as a glossy 3D flag marble, then defend it from 10 escalating waves of invaders using 7 upgradeable towers, with sound, particle effects, and a nation-themed battlefield. A clean, kid-friendly tower-defense game that runs entirely in the browser.

![Country Defense - pick your country as a glossy 3D flag marble](docs/screenshots/hero.png)

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
![Next.js](https://img.shields.io/badge/Next.js-16-black?logo=next.js)
![React](https://img.shields.io/badge/React-19-149eca?logo=react)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6?logo=typescript)
![three.js](https://img.shields.io/badge/three.js-r185-000000?logo=three.js)
![Tests](https://img.shields.io/badge/tests-26%20passing-3fb950)

Play it live: **https://country-defense-bheng.vercel.app**

## Contents

- [Features](#features)
- [Gameplay](#gameplay)
- [Architecture](#architecture)
- [Tech stack](#tech-stack)
- [Quick start](#quick-start)
- [Development](#development)
- [Configuration](#configuration)
- [Project layout](#project-layout)
- [License](#license)

## Features

- **Pick from all 194 recognized countries**, searchable by name or continent.
- **Glossy 3D flag marble** for your home base - a real WebGL sphere wrapped in your country's flag with a clearcoat sheen, spinning and floating over a themed pedestal (and reddening, smoking, then burning as it loses lives).
- **10 escalating waves**; every rival country invades exactly once, split evenly across the waves (~19 per wave), and each wave the enemies gain +28% health and +7% speed.
- **7 distinct tower types** - Laser (fast beam), Rapid (machine-gun), Frost (freezes solid), Slime (sticky 5s slow), Cannon (splash), Tesla (chain lightning + shock), and Sniper (very long range) - each firing with its own projectile style.
- **Status effects you can see** - tesla arcs an electric shock over foes, frost encases them in ice, slime coats them in green goo.
- **Upgrade towers to level 3** (+45% damage, +14% range, +15% fire rate per level; towers grow bigger too) or sell them back for 60% of what you spent.
- **Auto-starting waves** with a build-time countdown, plus 1x/2x/3x fast-forward and pause/resume.
- **Zero-asset sound** - every effect (firing, impacts, a cash-register ka-ching on build, wave start, win/lose) is synthesized live with the WebAudio API.
- **A living battlefield** - snow-capped mountains, trees, rocks, and mud, all tinted to your country's flag colors, with a smoke-and-spark particle system.
- **Tap-a-tile build menu** - a square ring of tower choices opens around the tile you tap; the upgrade panel floats right by the tower.
- **No accounts, no data, no backend** - fully static and client-side, at a smooth 60fps.

![Gameplay - defend your base from waves of flag-marble invaders](docs/screenshots/gameplay.png)

## Gameplay

1. Search and tap a country - it appears as a spinning glossy flag marble. Tap **Defend**.
2. Your country's marble sits at the end of an S-shaped path. Tap an open tile to open the square build menu and pick a tower.
3. Waves auto-start after a short countdown; invader marbles stream in along the path and your towers auto-fire and track their targets.
4. Killing invaders earns gold; clearing a wave pays a bonus. Spend it on new towers, or tap a tower to upgrade it (up to level 3).
5. Each invader that reaches your base costs a life (you start with 10). Survive all 10 waves to win; run out of lives and it is game over. Play again instantly.

## Architecture

The game is split into a **pure, DOM-free simulation** (`lib/game`) and a thin React/WebGL/canvas presentation layer. All 60fps mutable state (enemies, towers, projectiles) lives in refs so the animation loop never triggers a React re-render; the HUD updates only when a value actually changes.

```mermaid
flowchart LR
    subgraph Client [Browser]
        Page[app/page.tsx<br/>phase router]
        Select[CountrySelect]
        Marble[FlagMarble<br/>three.js / R3F]
        Game[Game<br/>rAF loop + 2D canvas]
    end
    subgraph Sim [Pure logic - lib/game]
        Waves[waves.ts]
        Towers[towers.ts]
        Engine[engine.ts]
        Map[map.ts]
        Particles[particles.ts]
    end
    Render[render.ts<br/>2D canvas]
    Audio[audio.ts<br/>WebAudio]
    Data[(countries.ts<br/>194 countries)]
    Flags[/public/flags<br/>SVG textures/]

    Page --> Select --> Marble
    Page --> Game
    Select --> Data
    Marble --> Flags
    Game --> Waves & Towers & Engine & Map & Particles
    Game --> Render & Audio
    Game --> Marble
    Render --> Flags
```

| Layer | Role |
|-------|------|
| `app/page.tsx` | Two-state router: the country picker until a country is chosen, then the game |
| `components/CountrySelect` + `FlagMarble` | Picker UI and the lazy-loaded three.js glossy marble |
| `components/Game.tsx` | Owns the requestAnimationFrame loop, refs-as-state, the HUD, and the floating 3D base marble |
| `lib/game/{types,map,waves,towers,engine,particles}` | Deterministic, DOM-free simulation - path math, wave scaling, tower combat, particles |
| `lib/game/render.ts` + `lib/game/audio.ts` | Browser-only 2D canvas renderer and the zero-asset WebAudio sound engine |
| `lib/countries.ts` + `lib/flagImage.ts` | 194-country data and the cached SVG-to-texture/palette pipeline |
| `tests/game.test.ts` | 26 `node:test` cases over the entire simulation layer |

## Tech stack

- **Next.js 16** (App Router, static export) and **React 19**
- **TypeScript** in strict mode
- **three.js** + **@react-three/fiber** + **@react-three/drei** for the 3D marble
- **HTML5 Canvas 2D** for the tower-defense arena (performant, no WebGL needed for gameplay)
- **Tailwind CSS 4** for the UI
- **node:test** for unit tests, **ESLint** + **tsc** for quality gates
- **Vercel** for hosting, **GitHub Actions** for CI

## Quick start

```bash
git clone https://github.com/bunlongheng/country-defense.git
cd country-defense
npm install
npm run dev
```

Open **http://localhost:3033**.

> Requires Node 22.6 or newer (the test runner uses `--experimental-strip-types`).

## Development

```bash
npm run dev        # dev server on http://localhost:3033
npm run build      # production build
npm run lint       # ESLint
npm run typecheck  # tsc --noEmit (includes tests)
npm test           # 26 node:test cases over lib/game
```

Git hooks (via Husky) run the tests on commit and lint + typecheck on push. CI runs lint, typecheck, tests, and a production build on every push and pull request.

## Configuration

No environment variables are required to run, build, or deploy this app. It is fully static and client-side.

## Project layout

```
app/
  layout.tsx            root layout, metadata, black theme
  page.tsx              phase router (picker <-> game)
  globals.css           Tailwind + base styles
components/
  CountrySelect.tsx     194-country picker + search + marble preview
  FlagMarble.tsx        three.js glossy flag sphere (picker + home base)
  Game.tsx              rAF game loop, HUD, build/upgrade menus
lib/
  countries.ts          194 recognized countries + search helpers
  flagImage.ts          cached SVG-to-Image/texture + flag-palette pipeline
  game/
    types.ts            shared game types (tile-unit coordinates)
    map.ts              arena grid + path geometry
    waves.ts            wave composition (every country once) + hp/speed scaling
    towers.ts           7 tower definitions, upgrade/sell, targeting
    engine.ts           pure per-frame step: move, fire, splash, chain, freeze, reap
    particles.ts        smoke + spark + ember particle system
    render.ts           2D canvas renderer (arena, towers, effects)
    audio.ts            zero-asset WebAudio sound engine
public/flags/           194 self-hosted flag SVGs
tests/game.test.ts      26 unit tests over the simulation layer
```

## License

[MIT](LICENSE) (c) Bunlong Heng
