"use client";

import { useRef, useMemo, useSyncExternalStore } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { Environment, Lightformer } from "@react-three/drei";
import * as THREE from "three";

// A real 3D golden winner's trophy: a lathed cup with handles, a metallic gold
// clearcoat material lit by a procedural studio (no external HDR, CSP-safe), gently
// bobbing and spinning so the reflections sweep across it. Used on the win screen.
function TrophyMesh() {
  const group = useRef<THREE.Group>(null);

  useFrame((state, dt) => {
    if (!group.current) return;
    group.current.rotation.y += dt * 0.9; // slow victorious spin
    group.current.position.y = 0.05 + Math.sin(state.clock.elapsedTime * 1.6) * 0.06; // bob
  });

  // half-profile of the cup, revolved around Y: base -> pedestal -> stem -> knob ->
  // bowl (out to the rim, then back down the inner wall to the centre = hollow cup)
  const profile = useMemo(
    () =>
      [
        [0.02, -1.5],
        [0.6, -1.5],
        [0.6, -1.36],
        [0.2, -1.28],
        [0.14, -0.7],
        [0.34, -0.52],
        [0.17, -0.42],
        [0.34, -0.26],
        [0.64, 0.12],
        [0.74, 0.56],
        [0.68, 0.56],
        [0.52, 0.12],
        [0.0, -0.14],
      ].map(([x, y]) => new THREE.Vector2(x, y)),
    [],
  );

  return (
    <group ref={group} scale={1.15}>
      {/* the cup */}
      <mesh>
        <latheGeometry args={[profile, 96]} />
        <meshStandardMaterial color="#ffd24a" metalness={1} roughness={0.18} envMapIntensity={1.5} />
      </mesh>
      {/* two side handles */}
      {[-1, 1].map((s) => (
        <mesh key={s} position={[s * 0.66, 0.28, 0]} rotation={[Math.PI / 2, 0, 0]} scale={[1, 1, 1]}>
          <torusGeometry args={[0.26, 0.055, 20, 40, Math.PI * 1.15]} />
          <meshStandardMaterial color="#ffcf3f" metalness={1} roughness={0.2} envMapIntensity={1.5} />
        </mesh>
      ))}
      {/* a dark marble plinth under the cup */}
      <mesh position={[0, -1.62, 0]}>
        <cylinderGeometry args={[0.62, 0.72, 0.22, 48]} />
        <meshStandardMaterial color="#1b2130" metalness={0.6} roughness={0.35} envMapIntensity={0.8} />
      </mesh>
    </group>
  );
}

// Procedural studio - bright rect + warm fills give the gold its glint, all from
// light shapes (no fetched HDR) so the CSP stays locked to 'self'.
function Studio() {
  return (
    <>
      <ambientLight intensity={0.6} />
      <directionalLight position={[4, 8, 5]} intensity={2.4} color="#fff2cc" />
      <directionalLight position={[-6, 2, -3]} intensity={0.7} color="#9ec5ff" />
      <Environment resolution={256}>
        <Lightformer form="rect" intensity={4} position={[3, 5, 4]} scale={[7, 7, 1]} color="#ffffff" />
        <Lightformer form="rect" intensity={2} position={[-4, 2, 2]} scale={[5, 5, 1]} color="#ffd27f" />
        <Lightformer form="circle" intensity={1.4} position={[0, -3, 3]} scale={[6, 3, 1]} color="#5a5a72" />
      </Environment>
    </>
  );
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

export default function Trophy3D() {
  const webgl = useSyncExternalStore(noopSubscribe, hasWebGL, () => false);

  // graceful fallback: a big emoji trophy where WebGL is unavailable
  if (!webgl) return <div style={{ fontSize: 96, lineHeight: 1 }}>🏆</div>;

  return (
    <div className="relative h-44 w-44 sm:h-52 sm:w-52">
      {/* warm glow halo behind the cup */}
      <div className="pointer-events-none absolute inset-0 rounded-full bg-amber-400/25 blur-2xl" />
      <Canvas camera={{ position: [0, 0.2, 4.4], fov: 42 }} gl={{ antialias: true, alpha: true }} dpr={[1, 2]}>
        <Studio />
        <TrophyMesh />
      </Canvas>
    </div>
  );
}
