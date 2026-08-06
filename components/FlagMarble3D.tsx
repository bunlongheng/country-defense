"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
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

// A white, see-through, glossy shield bubble that waves gently around the base
// marble - a fresnel rim (bright at the edges) plus a soft time-shimmer, with a
// low-frequency ripple displacing the surface so it looks like a living bubble.
const SHIELD_VERT = `
  uniform float uTime;
  varying vec3 vN;
  varying vec3 vView;
  void main() {
    vec3 p = position;
    // a very gentle ripple - kept tiny so the bubble never bulges past the frame
    float w = sin(p.y * 6.0 + uTime * 3.0) * 0.006 + sin(p.x * 5.0 - uTime * 2.0) * 0.006;
    p += normal * w;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    vN = normalize(normalMatrix * normal);
    vView = normalize(-mv.xyz);
    gl_Position = projectionMatrix * mv;
  }
`;
const SHIELD_FRAG = `
  uniform float uTime;
  varying vec3 vN;
  varying vec3 vView;
  void main() {
    // thin, glassy skin: a soft fresnel rim on near-invisible glass, so it reads
    // as a delicate see-through bubble rather than a solid white shell
    float fres = pow(1.0 - max(dot(vN, vView), 0.0), 3.0);
    float shimmer = 0.015 + 0.02 * sin(uTime * 4.0);
    float a = fres * 0.32 + shimmer;
    gl_FragColor = vec4(vec3(1.0), a);
  }
`;

function ShieldBubble() {
  const meshRef = useRef<THREE.Mesh>(null);
  const matRef = useRef<THREE.ShaderMaterial>(null);
  const uniforms = useMemo(() => ({ uTime: { value: 0 } }), []);
  useFrame((_, dt) => {
    if (matRef.current) matRef.current.uniforms.uTime.value += dt;
    if (meshRef.current) meshRef.current.rotation.y += dt * 0.25;
  });
  return (
    <mesh ref={meshRef} scale={1.08}>
      <sphereGeometry args={[1, 48, 48]} />
      <shaderMaterial
        ref={matRef}
        uniforms={uniforms}
        vertexShader={SHIELD_VERT}
        fragmentShader={SHIELD_FRAG}
        transparent
        depthWrite={false}
        side={THREE.DoubleSide}
      />
    </mesh>
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

export default function FlagMarble3D({
  code,
  shield = false,
}: {
  code: string;
  shield?: boolean;
}) {
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
      {shield && <ShieldBubble />}
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
