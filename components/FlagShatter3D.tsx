"use client";

/* eslint-disable react-hooks/immutability, react-hooks/refs */
// This component drives a THREE.js scene graph imperatively - the standard
// react-three-fiber pattern: the shard group is built once, then its meshes are
// mutated every frame in useFrame (positions, rotations, material opacity).
// React Compiler's immutability/refs rules target React state, not a THREE scene
// graph, so they are turned off for this file.

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { Environment, Lightformer, ContactShadows } from "@react-three/drei";
import * as THREE from "three";
import { loadFlagImage, flagToCanvas } from "@/lib/flagImage";
import FlagMarble2D from "./FlagMarble2D";

// The defeated country's flag marble cracking open like an egg: the glossy
// sphere is built from curved eggshell shards (lat/long patches of the same
// sphere) that hold intact for a beat, then split and tumble - most fall under
// gravity and settle on the floor, a few small top shards float up and fade.
// Real WebGL, no lines drawn on top. Falls back to a static flag with no WebGL.

const NB = 4; // latitude bands
const NS = 8; // longitude sectors
const HOLD = 0.18; // seconds intact before it cracks
const GRAVITY = 5.2;
const FLOOR = -1.55;

type Shard = {
  vel: THREE.Vector3;
  spin: THREE.Vector3;
  gScale: number; // gravity multiplier (floaters barely fall)
  floater: boolean;
};

// Build the shell once: each shard is a curved patch of the same sphere,
// recentred on its own centroid so it can tumble in place; positioned at that
// centroid, the shards reconstruct the intact marble.
function buildShards(): THREE.Group {
  const g = new THREE.Group();
  for (let b = 0; b < NB; b++) {
    for (let s = 0; s < NS; s++) {
      const geo = new THREE.SphereGeometry(
        1,
        6,
        5,
        (s * 2 * Math.PI) / NS,
        (2 * Math.PI) / NS,
        (b * Math.PI) / NB,
        Math.PI / NB,
      );
      geo.computeBoundingBox();
      const c = new THREE.Vector3();
      geo.boundingBox!.getCenter(c);
      geo.translate(-c.x, -c.y, -c.z);

      const mat = new THREE.MeshPhysicalMaterial({
        color: "#c9ccd1",
        roughness: 0.18,
        metalness: 0,
        clearcoat: 1,
        clearcoatRoughness: 0.06,
        envMapIntensity: 1.15,
        side: THREE.DoubleSide,
        transparent: true,
      });

      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.copy(c);

      // Explode outward from the shell, plus a downward bias so most pieces
      // fall. Top-band shards get a floaty upward pop and barely any gravity.
      const dir = c.clone().normalize();
      const floater = b === 0 && (b * NS + s) % 2 === 0;
      const out = 0.5 + ((b * NS + s) % 5) * 0.14;
      const vel = dir.multiplyScalar(out);
      vel.x += (((s * 7 + b * 13) % 10) / 10 - 0.5) * 0.5;
      vel.z += (((s * 3 + b * 5) % 10) / 10 - 0.5) * 0.5;
      if (floater) vel.y = 0.6 + (s % 3) * 0.2;
      else vel.y += 0.2;
      const spin = new THREE.Vector3(
        ((s * 5 + b) % 7) - 3,
        ((s + b * 3) % 7) - 3,
        ((s * 2 + b) % 7) - 3,
      ).multiplyScalar(1.1);
      (mesh.userData as { shard: Shard }).shard = {
        vel,
        spin,
        gScale: floater ? 0.16 : 1,
        floater,
      };
      g.add(mesh);
    }
  }
  return g;
}

function Egg({ code }: { code: string }) {
  // The shard group is a live THREE object we mutate every frame, so it lives in
  // a ref (built once), not a memo - refs are the sanctioned mutable escape hatch.
  // The shard group is a live THREE object we mutate every frame, so it lives in
  // a ref (built once) - refs are the sanctioned mutable escape hatch. Every
  // callback reads it back through the ref; it is never an effect dependency.
  const groupRef = useRef<THREE.Group | null>(null);
  if (!groupRef.current) groupRef.current = buildShards();
  const tRef = useRef(0);
  const [texture, setTexture] = useState<THREE.CanvasTexture | null>(null);

  useEffect(() => {
    const group = groupRef.current!;
    return () =>
      group.children.forEach((m) => {
        (m as THREE.Mesh).geometry.dispose();
        ((m as THREE.Mesh).material as THREE.Material).dispose();
      });
  }, []);

  // Load the country's flag once.
  useEffect(() => {
    let alive = true;
    loadFlagImage(code)
      .then((img) => {
        if (!alive) return;
        const tex = new THREE.CanvasTexture(flagToCanvas(img));
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.anisotropy = 8;
        setTexture((prev) => {
          prev?.dispose();
          return tex;
        });
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [code]);

  // Wrap the flag onto every shard once it loads, so the pieces are the actual
  // country (not a flat fallback colour).
  useEffect(() => {
    if (!texture) return;
    for (const child of groupRef.current!.children) {
      const mat = (child as THREE.Mesh).material as THREE.MeshPhysicalMaterial;
      mat.map = texture;
      mat.color.set("#ffffff");
      mat.needsUpdate = true;
    }
  }, [texture]);

  useFrame((_, dtRaw) => {
    const group = groupRef.current!;
    const dt = Math.min(dtRaw, 0.033);
    tRef.current += dt;
    const t = tRef.current;

    if (t < HOLD) {
      group.rotation.y += dt * 0.6; // a live little spin before it breaks
      return;
    }
    for (const child of group.children) {
      const mesh = child as THREE.Mesh;
      const sh = (mesh.userData as { shard: Shard }).shard;
      sh.vel.y -= GRAVITY * sh.gScale * dt;
      mesh.position.addScaledVector(sh.vel, dt);
      mesh.rotation.x += sh.spin.x * dt;
      mesh.rotation.y += sh.spin.y * dt;
      mesh.rotation.z += sh.spin.z * dt;

      if (sh.floater) {
        const mat = mesh.material as THREE.MeshPhysicalMaterial;
        if (mat.opacity > 0) mat.opacity = Math.max(0, mat.opacity - dt * 0.5);
      } else if (mesh.position.y < FLOOR) {
        mesh.position.y = FLOOR;
        sh.vel.y = -sh.vel.y * 0.32; // small bounce, then it settles
        sh.vel.x *= 0.6;
        sh.vel.z *= 0.6;
        sh.spin.multiplyScalar(0.55);
      }
    }
  });

  return <primitive object={groupRef.current} />;
}

let webglSupport: boolean | undefined;
function hasWebGL(): boolean {
  if (webglSupport !== undefined) return webglSupport;
  try {
    const c = document.createElement("canvas");
    webglSupport = !!(c.getContext("webgl2") || c.getContext("webgl"));
  } catch {
    webglSupport = false;
  }
  return webglSupport;
}
const noopSubscribe = () => () => {};

export default function FlagShatter3D({ code }: { code: string }) {
  // Client-only capability check that stays hydration-safe (server sees false).
  const webgl = useSyncExternalStore(noopSubscribe, hasWebGL, () => false);

  if (!webgl) {
    // No WebGL - just show the (unbroken) flag so the screen still reads.
    return (
      <div className="h-40 w-40">
        <FlagMarble2D code={code} />
      </div>
    );
  }

  return (
    <div className="h-44 w-44">
      <Canvas
        camera={{ position: [0, 0.25, 4.3], fov: 40 }}
        gl={{ antialias: true, alpha: true }}
        dpr={[1, 2]}
      >
        <ambientLight intensity={0.5} />
        <directionalLight position={[4, 8, 5]} intensity={2} />
        <directionalLight position={[-6, 3, -4]} intensity={0.6} color="#9ec5ff" />
        <Environment resolution={256}>
          <Lightformer form="rect" intensity={3} position={[3, 4, 4]} scale={[6, 6, 1]} color="#ffffff" />
          <Lightformer form="circle" intensity={1.4} position={[-4, 2, -3]} scale={[4, 4, 1]} color="#88b7ff" />
          <Lightformer form="rect" intensity={1} position={[0, -3, 2]} scale={[8, 3, 1]} color="#3a3a52" />
        </Environment>
        <Egg code={code} />
        <ContactShadows position={[0, FLOOR, 0]} opacity={0.5} scale={6} blur={2.4} far={3} />
      </Canvas>
    </div>
  );
}
