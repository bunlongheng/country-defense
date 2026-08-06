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

const NSHARD = 13; // irregular fragments
const HOLD = 0.16; // seconds intact before it cracks
const GRAVITY = 4.4;
const FLOOR = -1.4;

type Shard = {
  vel: THREE.Vector3;
  spin: THREE.Vector3;
  gScale: number; // gravity multiplier (floaters barely fall)
  floater: boolean;
};

function randDir(): THREE.Vector3 {
  const u = Math.random() * 2 - 1;
  const t = Math.random() * Math.PI * 2;
  const s = Math.sqrt(1 - u * u);
  return new THREE.Vector3(s * Math.cos(t), u, s * Math.sin(t));
}

// Equirectangular UV so each shard samples the right slice of the flag, matching
// the spinning marble. atan2 wraps at the back seam, so callers fix seam faces.
function uvOf(x: number, y: number, z: number): [number, number] {
  return [
    0.5 + Math.atan2(x, z) / (2 * Math.PI),
    0.5 - Math.asin(Math.max(-1, Math.min(1, y))) / Math.PI,
  ];
}

// Fracture the sphere into IRREGULAR shards: scatter random crack seeds over an
// icosphere and hand each triangle to its nearest seed, so pieces come out as
// jagged fragments (not the neat rectangular tiles a lat/long grid produced).
// Each shard is recentred on its own centroid so it can tumble in place; parked
// at that centroid, the shards reconstruct the intact marble.
function buildShards(): THREE.Group {
  const g = new THREE.Group();
  const src = new THREE.IcosahedronGeometry(1, 3).toNonIndexed();
  const pos = src.getAttribute("position") as THREE.BufferAttribute;
  const faces = pos.count / 3;

  const seeds = Array.from({ length: NSHARD }, randDir);
  const buckets: number[][] = seeds.map(() => []);
  const cen = new THREE.Vector3();
  for (let f = 0; f < faces; f++) {
    cen.set(0, 0, 0);
    for (let j = 0; j < 3; j++) {
      cen.x += pos.getX(f * 3 + j) / 3;
      cen.y += pos.getY(f * 3 + j) / 3;
      cen.z += pos.getZ(f * 3 + j) / 3;
    }
    cen.normalize();
    let best = 0;
    let bestDot = -Infinity;
    for (let i = 0; i < seeds.length; i++) {
      const d = cen.dot(seeds[i]);
      if (d > bestDot) {
        bestDot = d;
        best = i;
      }
    }
    buckets[best].push(f);
  }

  for (const faceList of buckets) {
    if (faceList.length === 0) continue;
    const positions = new Float32Array(faceList.length * 9);
    const uvs = new Float32Array(faceList.length * 6);
    faceList.forEach((f, k) => {
      const us: number[] = [];
      for (let j = 0; j < 3; j++) {
        const vx = pos.getX(f * 3 + j);
        const vy = pos.getY(f * 3 + j);
        const vz = pos.getZ(f * 3 + j);
        positions[k * 9 + j * 3] = vx;
        positions[k * 9 + j * 3 + 1] = vy;
        positions[k * 9 + j * 3 + 2] = vz;
        const [u, v] = uvOf(vx, vy, vz);
        us.push(u);
        uvs[k * 6 + j * 2] = u;
        uvs[k * 6 + j * 2 + 1] = v;
      }
      // seam fix: a triangle straddling the back seam has u's far apart - push
      // the small ones past 1 so the slice stays contiguous (needs wrapS repeat)
      if (Math.max(...us) - Math.min(...us) > 0.5) {
        for (let j = 0; j < 3; j++) if (us[j] < 0.5) uvs[k * 6 + j * 2] = us[j] + 1;
      }
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geo.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
    geo.computeVertexNormals();
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

    // A gentle outward pop plus a downward bias so most pieces fall; a few top
    // shards float up and fade. Kept tight so the whole break stays compact.
    const dir = c.clone().normalize();
    const floater = c.y > 0.35 && Math.random() < 0.5;
    const vel = dir.multiplyScalar(0.28 + Math.random() * 0.4);
    vel.x += (Math.random() - 0.5) * 0.35;
    vel.z += (Math.random() - 0.5) * 0.35;
    if (floater) vel.y = 0.4 + Math.random() * 0.35;
    else vel.y += 0.15;
    const spin = new THREE.Vector3(
      Math.random() - 0.5,
      Math.random() - 0.5,
      Math.random() - 0.5,
    ).multiplyScalar(4);
    (mesh.userData as { shard: Shard }).shard = {
      vel,
      spin,
      gScale: floater ? 0.16 : 1,
      floater,
    };
    g.add(mesh);
  }
  src.dispose();
  return g;
}

function Egg({ code }: { code: string }) {
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
        tex.wrapS = THREE.RepeatWrapping; // lets seam shards sample u > 1
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
    <div className="h-36 w-36">
      <Canvas
        camera={{ position: [0, 0.2, 5.2], fov: 36 }}
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
