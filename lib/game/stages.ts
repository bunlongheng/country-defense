import type { Vec2 } from "./types.ts";

// The 10-stage journey. Each stage has its OWN winding path, its OWN scenery
// (ground + road colors and signature decorations), optional no-build zones
// (water / lava the player cannot place towers on), and a difficulty multiplier
// that ramps ~10% per stage. Same 193 invaders on every stage - only the arena,
// the route and the toughness change.

export type Decor =
  | "forest"
  | "desert"
  | "beach"
  | "savanna"
  | "stadium"
  | "river"
  | "ice"
  | "canyon"
  | "tropical"
  | "volcano";

export interface Scenery {
  ground: [string, string]; // vertical ground gradient (top -> bottom)
  road: [string, string, string]; // road strokes: dark edge, mid, light center
  accent: string; // themed accent for build-pad flowers / bushes
  fleck: string; // little specks scattered on the road
  decor: Decor; // which signature props to scatter
}

export interface Stage {
  id: number; // 1..10
  name: string;
  scenery: Scenery;
  waypoints: Vec2[]; // entry (x:-1) ... base (last point)
  noBuild: string[]; // extra blocked "c,r" tiles (water / lava), also drawn themed
  hpMul: number; // per-stage HP multiplier on top of the difficulty growth
}

// Small helper to build a rectangle of "c,r" keys for a no-build zone.
function zone(c0: number, r0: number, c1: number, r1: number): string[] {
  const out: string[] = [];
  for (let c = c0; c <= c1; c++) for (let r = r0; r <= r1; r++) out.push(`${c},${r}`);
  return out;
}

export const STAGES: Stage[] = [
  {
    id: 1,
    name: "Greenwood",
    scenery: {
      ground: ["#1c2b16", "#0e1a0c"],
      road: ["rgba(41,30,20,0.9)", "#5a4326", "#6f5330"],
      accent: "#f9a8d4",
      fleck: "#3a2a18",
      decor: "forest",
    },
    waypoints: [
      { x: -1, y: 1 },
      { x: 11, y: 1 },
      { x: 11, y: 4 },
      { x: 2, y: 4 },
      { x: 2, y: 7 },
      { x: 13, y: 7 },
    ],
    noBuild: [],
    hpMul: 1,
  },
  {
    id: 2,
    name: "Dune Sea",
    scenery: {
      ground: ["#c2a15e", "#9c7d42"],
      road: ["rgba(120,92,45,0.9)", "#d8b877", "#e8cf9a"],
      accent: "#fb923c",
      fleck: "#8a6a34",
      decor: "desert",
    },
    waypoints: [
      { x: -1, y: 7 },
      { x: 11, y: 7 },
      { x: 11, y: 4 },
      { x: 2, y: 4 },
      { x: 2, y: 1 },
      { x: 13, y: 1 },
    ],
    noBuild: [],
    hpMul: 1.1,
  },
  {
    id: 3,
    name: "Sunny Shores",
    scenery: {
      ground: ["#e6d5a7", "#cdb984"],
      road: ["rgba(150,120,70,0.85)", "#e3cd97", "#efe0b6"],
      accent: "#38bdf8",
      fleck: "#b39b64",
      decor: "beach",
    },
    // water fills the bottom band; the path hugs the sand above it
    waypoints: [
      { x: -1, y: 4 },
      { x: 3, y: 4 },
      { x: 3, y: 1 },
      { x: 10, y: 1 },
      { x: 10, y: 4 },
      { x: 13, y: 4 },
    ],
    noBuild: zone(0, 7, 13, 8),
    hpMul: 1.2,
  },
  {
    id: 4,
    name: "Wild Savanna",
    scenery: {
      ground: ["#b7a955", "#8f7a3c"],
      road: ["rgba(110,86,40,0.9)", "#c9a95f", "#dcc07f"],
      accent: "#facc15",
      fleck: "#7e6a34",
      decor: "savanna",
    },
    waypoints: [
      { x: -1, y: 1 },
      { x: 3, y: 1 },
      { x: 3, y: 7 },
      { x: 6, y: 7 },
      { x: 6, y: 1 },
      { x: 9, y: 1 },
      { x: 9, y: 7 },
      { x: 13, y: 7 },
    ],
    noBuild: [],
    hpMul: 1.3,
  },
  {
    id: 5,
    name: "World Cup Pitch",
    scenery: {
      ground: ["#2f8f3e", "#217a30"],
      road: ["rgba(255,255,255,0.35)", "#3a9a49", "#46a856"],
      accent: "#ffffff",
      fleck: "#ffffff",
      decor: "stadium",
    },
    waypoints: [
      { x: -1, y: 4 },
      { x: 11, y: 4 },
      { x: 11, y: 1 },
      { x: 2, y: 1 },
      { x: 2, y: 7 },
      { x: 13, y: 7 },
    ],
    noBuild: [],
    hpMul: 1.4,
  },
  {
    id: 6,
    name: "Riverbend",
    scenery: {
      ground: ["#1f3a1a", "#122610"],
      road: ["rgba(41,30,20,0.9)", "#5a4326", "#6f5330"],
      accent: "#38bdf8",
      fleck: "#2a3a18",
      decor: "river",
    },
    waypoints: [
      { x: -1, y: 2 },
      { x: 11, y: 2 },
      { x: 11, y: 6 },
      { x: 2, y: 6 },
      { x: 2, y: 4 },
      { x: 13, y: 4 },
    ],
    // a river runs down the middle-left as a no-build strip
    noBuild: zone(5, 0, 6, 1).concat(zone(5, 7, 6, 8)),
    hpMul: 1.5,
  },
  {
    id: 7,
    name: "Frostpeak",
    scenery: {
      ground: ["#dce9f2", "#b9cfe0"],
      road: ["rgba(150,170,190,0.8)", "#e7f1f8", "#ffffff"],
      accent: "#60a5fa",
      fleck: "#c4d6e6",
      decor: "ice",
    },
    waypoints: [
      { x: -1, y: 7 },
      { x: 4, y: 7 },
      { x: 4, y: 2 },
      { x: 9, y: 2 },
      { x: 9, y: 7 },
      { x: 13, y: 7 },
    ],
    noBuild: [],
    hpMul: 1.6,
  },
  {
    id: 8,
    name: "Red Canyon",
    scenery: {
      ground: ["#a85a34", "#7a3d22"],
      road: ["rgba(90,50,28,0.9)", "#c47a4a", "#d99366"],
      accent: "#fbbf24",
      fleck: "#6a3a20",
      decor: "canyon",
    },
    waypoints: [
      { x: -1, y: 1 },
      { x: 10, y: 1 },
      { x: 10, y: 3 },
      { x: 3, y: 3 },
      { x: 3, y: 5 },
      { x: 10, y: 5 },
      { x: 10, y: 7 },
      { x: 13, y: 7 },
    ],
    noBuild: [],
    hpMul: 1.7,
  },
  {
    id: 9,
    name: "Aloha Isle",
    scenery: {
      ground: ["#1f6f3a", "#12592c"],
      road: ["rgba(120,92,45,0.9)", "#caa25f", "#ddba82"],
      accent: "#f472b6",
      fleck: "#2a5a1a",
      decor: "tropical",
    },
    waypoints: [
      { x: -1, y: 4 },
      { x: 2, y: 4 },
      { x: 2, y: 1 },
      { x: 6, y: 1 },
      { x: 6, y: 7 },
      { x: 10, y: 7 },
      { x: 10, y: 1 },
      { x: 13, y: 1 },
    ],
    noBuild: zone(0, 8, 13, 8),
    hpMul: 1.8,
  },
  {
    id: 10,
    name: "Mount Doom",
    scenery: {
      ground: ["#2a1410", "#140a08"],
      road: ["rgba(255,90,10,0.5)", "#7a2a12", "#b8431c"],
      accent: "#f97316",
      fleck: "#ff6a1a",
      decor: "volcano",
    },
    waypoints: [
      { x: -1, y: 1 },
      { x: 11, y: 1 },
      { x: 11, y: 7 },
      { x: 5, y: 7 },
      { x: 5, y: 3 },
      { x: 13, y: 3 },
    ],
    // lava pools block a couple of tiles
    noBuild: zone(7, 5, 8, 6),
    hpMul: 1.9,
  },
];

export const TOTAL_STAGES = STAGES.length;

/** The base (player's country) sits at the end of a stage's path. */
export function stageBase(stage: Stage): Vec2 {
  return { ...stage.waypoints[stage.waypoints.length - 1] };
}
