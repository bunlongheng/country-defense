<div align="center">
  <img src="docs/icon.png" alt="Country Defense" width="96" height="96" />
  <h1>Country Defense</h1>
  <p><em>Kid-friendly browser tower-defense: defend your country's 3D flag marble across 10 stages</em></p>
  <p><a href="https://country-defense-bheng.vercel.app">Live</a> &middot; <a href="https://github.com/bunlongheng/country-defense">Repo</a> &middot; <a href="https://bunlongheng.com/projects?name=country-defense">Portfolio</a></p>
  <img src="docs/social-preview.png" alt="Country Defense - preview" width="820" />
</div>

---

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

---

<p align="center">
  <sub>Built by <a href="https://bunlongheng.com">Bunlong Heng</a> &middot; <a href="https://bunlongheng.com/projects/country-defense">See it in my portfolio &rarr;</a></sub>
</p>

---

<div align="center">

<a href="https://bunlongheng.com"><img src="https://img.shields.io/badge/-bunlongheng.com-3A3A3C?style=for-the-badge&amp;labelColor=2A2A2C&amp;logo=data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABwAAAAcCAMAAABF0y%2BmAAADAFBMVEXx8vLq6v%2F19fX09PT8%2Ff309PT5%2BfnAwMBMaXHx8vL19fX5%2Bfny8vL09PT39%2Ff6%2Bfn6%2Bvr09PTx8fH4%2BPn%2F8vLy8%2FP09PTz8%2FPy8vL%2F%2F%2F%2Fz9PTz9PP19fby8vP19PXz8%2FT19%2Fb08%2FTx8vLy8vL09vby8%2FL29vf19fTv8PDz9vb7%2Bvn%2F%2Ff%2F9%2Ff3w8vH29fb%2F%2FP339%2Ff5%2Bfn59%2Ff19PT09PR7rao3VF3%2F%2Fv8AKDR6sqsBV1vv8fL4%2BPiux8b8%2Bvq90NDy8%2FR%2BlpppnZyZqrACLTxclZJSkI9en5ssZ2luqaUAeWgqbW4BX1gCfG0%2Fa3QaVG0MN0UKNUKUpKsGpYMAKjoRQ1UDf3AQRloJqIgEm32d0cUBg3ElbnQIln8eVWgrmIdP0KzF5d5s2acdfHwppJCP5MMXl4Tz8%2FLv8%2FP39%2FiewL5%2BqahYf4IrTFZkk5KlxsREiIYAHiqDnKFmnJowc3IdVllvpKK7zc3D2tnk5%2BmuycdwpKKuub2yv8Ly%2B%2FkAMT7z%2Bvjq7e09gH93q6kGdWpGgoJZmJSlw8M7c3WwyceTw76w1M8mYmpFfX8lW2AFOEpGiYhxqqRrqaRb2rdIsZ8AVE91jpU7d3t3saqBoKhako4AWVEcUlg3aWwDupAHb2YwmIkPP1ERSVA7WmZ8tq8HT14oZW%2BYuLsMl3wQT10ROksENUc8Z3MJSGVLh4dqpJ%2BXr7U51awUgHM4v6ad1MkPuJZAiowVd3IEhnZH0aoYrI05p5sDtYwkzZ8EPViYxsRel5USbHAIgmwIM0gQamzU4uF2malQi4oWQFQ1zaYrp4UXlYwfiHoyxqFE1q4qeX4yn5JIxKkdrX1b1rAbWGvd5Oh91sRijpomsJEVc3Ukc34dqIcwuJVKwZIXkoQZcXlNv5g%2BqZUZvpNl2rPG9N0WkIoNqouW4sVPwp%2BM0b6h0ssfq4d%2F1r8hpo%2Fh9e4AamUjnI9avaBixqgklYWSwL4xtItUxplYl5qZ58mq78wMgnYXfnlOmJaR1L%2Bj78ny9fS%2FrXQPAAAAFXRSTlP7Brvx%2FsJhAgD87r4U72C4uGH8vhRDodYHAAAACXBIWXMAAAsTAAALEwEAmpwYAAAC6UlEQVQokS2Sd3BUVRSHb0KS3QRCiZw5t%2By9j33zXjZkyUs2uekhEAi9dwRCL4JUEQRFAQUs9A4WOopKU0GpFoqCBZUivaqoFKkWLIS5GX7%2FfnPO78yZj%2Fj8UTViK6HggvNgSGuluEZRKbZqlN9H%2FFWiWUzIFQK5fhjOIRTDoqv4ia86S4q3KSByHdSqIhxofBKr5iNxLMm2bQqWVkorJ%2BAkO46nkQJhceSRmCTDvKJIJBLJzMxMLU6POJ4eBPF1KpNEbdt2Cms4LCcnZ%2FX6D3d%2BsKJJ7VSlNLoqgbjUtmkKKxlVmpf3bsFXW3d1b77gueJAQIPQBCilkMKemNi23Ts9T35%2FaMe2rsvmTypylGUFCSIYWJLXrm2nUwOPfNO5w%2B73Okxnjqe0JigQEL3JizoeONr%2F2u99vju4fd1rdZnyspQmnGvAUBprWNqz348%2FhXN%2F6P1%2By4Uvs%2FJkpRQRwpJBRVn7vf16Dfitz5XevQqWt3yalXtKaRIUQmglWfsu5y7%2BMrDs0TMftWo1ZVy64xioOVpcIdt8%2Fvqvf9%2F859KJsrLmrzA%2BOKC0IkFEtJza7JOfr%2FYd0P9G98tdOxe0Hp9qJrOIBgDuOeEtp%2F%2B4d%2FvWX%2F%2F9u%2B%2FtlaUTmOWZg7SQEEyuFe52%2BML9O3cZO%2F5xl06zn2VcadOJUqJTzt7a82XfP7sx9vmGNm1m1MstV4IHCVAAoTLqL1372ddn%2Fz%2B2v%2FWq12c1fSpsaeQWAZAANntxzuI3e3zbo8XGpm%2FMnNqiXrh%2BljaPd6UUabkjps19tdGnX2zKb9b4pTFDCzOMLmYtpW5h%2BpCRTeYtyV%2BT36zx808OL4xYGoFrkqDTbJpSXLdRgwbPZL%2BQnT129OOPFVEEsAMJpHKdeKMJgJSAiALdjJANQKnRJI4R6boAKEwLCiGoBBegQjBftQo1KQWOlplFKSV9qGaF1NpAE7QQESTlMSy6pp%2F4%2FFFVYxMNRBTaiM0tkImxNaL8vgfDR8gvoYRaxgAAAABJRU5ErkJggg%3D%3D" alt="bunlongheng.com"></a>
<a href="https://www.linkedin.com/in/bunlongheng/"><img src="https://img.shields.io/badge/LinkedIn-0A66C2?style=for-the-badge&logo=linkedin&logoColor=white" alt="LinkedIn"></a>
<a href="https://www.instagram.com/ibunlong/"><img src="https://img.shields.io/badge/Instagram-C13584?style=for-the-badge&logo=instagram&logoColor=white" alt="Instagram"></a>
<a href="mailto:bheng.code@gmail.com"><img src="https://img.shields.io/badge/Email-2E7D32?style=for-the-badge&logo=gmail&logoColor=white" alt="Email"></a>

<br>

Built by **[Bunlong](https://bunlongheng.com)** &nbsp;&middot;&nbsp; [more apps](https://bunlongheng.com/projects)

</div>
