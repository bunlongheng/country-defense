"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls, Environment, Lightformer } from "@react-three/drei";
import * as THREE from "three";
import { loadFlagImage, flagToCanvas } from "@/lib/flagImage";
import FlagMarble2D from "./FlagMarble2D";

// True 3D glossy flag marble - the same recipe as the racer podium: a high-poly
// sphere with a clearcoat physical material lit by a procedural Environment map,
// so the reflections slide across the surface as it turns and the spin reads as
// a real rotating ball (not a flag scrolling sideways). Drag to spin; it also
// auto-rotates. Falls back to the 2D canvas marble when WebGL is unavailable.
function Sphere({ code }: { code: string }) {
  const meshRef = useRef<THREE.Mesh>(null);
  const matRef = useRef<THREE.MeshPhysicalMaterial>(null);
  const [texture, setTexture] = useState<THREE.Texture | null>(null);

  // A map added to an already-compiled material needs an explicit recompile,
  // otherwise the flag never shows and the sphere stays blank.
  useEffect(() => {
    if (matRef.current) matRef.current.needsUpdate = true;
    return () => texture?.dispose();
  }, [texture]);

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

  useFrame((_, dt) => {
    if (meshRef.current) meshRef.current.rotation.y += dt * 0.5;
  });

  return (
    <mesh ref={meshRef}>
      <sphereGeometry args={[1, 64, 64]} />
      <meshPhysicalMaterial
        ref={matRef}
        map={texture ?? undefined}
        color={texture ? "#ffffff" : "#334155"}
        roughness={0.16}
        metalness={0}
        clearcoat={1}
        clearcoatRoughness={0.06}
        envMapIntensity={1.15}
        reflectivity={0.6}
      />
    </mesh>
  );
}

// Procedural studio - reflections come from these light shapes (no HDR fetched),
// so the marble stays glossy while the CSP stays locked to 'self'.
function Studio() {
  return (
    <>
      <ambientLight intensity={0.5} />
      <directionalLight position={[4, 8, 5]} intensity={2} />
      <directionalLight position={[-6, 3, -4]} intensity={0.6} color="#9ec5ff" />
      <Environment resolution={256}>
        <Lightformer form="rect" intensity={3} position={[3, 4, 4]} scale={[6, 6, 1]} color="#ffffff" />
        <Lightformer form="circle" intensity={1.4} position={[-4, 2, -3]} scale={[4, 4, 1]} color="#88b7ff" />
        <Lightformer form="rect" intensity={1} position={[0, -3, 2]} scale={[8, 3, 1]} color="#3a3a52" />
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

export default function FlagMarble3D({ code }: { code: string }) {
  // Client-only capability check, hydration-safe (server sees false, so it and
  // the 2D fallback render match on the first paint before WebGL takes over).
  const webgl = useSyncExternalStore(noopSubscribe, hasWebGL, () => false);

  if (!webgl) return <FlagMarble2D code={code} />;

  return (
    <Canvas
      camera={{ position: [0, 0, 3.1], fov: 42 }}
      gl={{ antialias: true, alpha: true }}
      dpr={[1, 2]}
    >
      <Studio />
      <Sphere code={code} />
      <OrbitControls
        enablePan={false}
        enableZoom={false}
        autoRotate
        autoRotateSpeed={1.1}
        rotateSpeed={0.7}
      />
    </Canvas>
  );
}
