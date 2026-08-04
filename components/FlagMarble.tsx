"use client";

import { useEffect, useRef, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import { loadFlagImage, flagToCanvas } from "@/lib/flagImage";

function Sphere({ code, spin }: { code: string; spin: boolean }) {
  const meshRef = useRef<THREE.Mesh>(null);
  const matRef = useRef<THREE.MeshPhysicalMaterial>(null);
  const [texture, setTexture] = useState<THREE.Texture | null>(null);

  // Adding a map to a material that first compiled without one needs an explicit
  // recompile, otherwise the flag never appears and the sphere stays plain.
  useEffect(() => {
    if (matRef.current) matRef.current.needsUpdate = true;
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

  useFrame((_, delta) => {
    if (spin && meshRef.current) meshRef.current.rotation.y += delta * 0.4;
  });

  return (
    <mesh ref={meshRef} castShadow>
      <sphereGeometry args={[1, 96, 96]} />
      <meshPhysicalMaterial
        ref={matRef}
        map={texture ?? undefined}
        color={texture ? "#ffffff" : "#334155"}
        roughness={0.22}
        metalness={0.05}
        clearcoat={1}
        clearcoatRoughness={0.08}
        reflectivity={0.6}
        sheen={0.4}
        sheenColor="#ffffff"
      />
    </mesh>
  );
}

export default function FlagMarble({
  code,
  spin = true,
  interactive = true,
}: {
  code: string;
  spin?: boolean;
  interactive?: boolean;
}) {
  return (
    <Canvas
      camera={{ position: [0, 0, 3.1], fov: 42 }}
      gl={{ antialias: true, alpha: true }}
      dpr={[1, 2]}
    >
      <ambientLight intensity={0.55} />
      <directionalLight position={[3, 4, 5]} intensity={1.5} />
      <pointLight position={[-4, -2, -3]} intensity={0.6} color="#7dd3fc" />
      {/* bright rim key that reads as a glossy highlight on the marble */}
      <pointLight position={[2, 3, 3]} intensity={1.1} color="#ffffff" />
      <Sphere code={code} spin={spin} />
      {interactive && (
        <OrbitControls
          enablePan={false}
          enableZoom={false}
          autoRotate={spin}
          autoRotateSpeed={1.2}
          rotateSpeed={0.7}
        />
      )}
    </Canvas>
  );
}
