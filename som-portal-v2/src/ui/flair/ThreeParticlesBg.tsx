// som-portal-v2/src/ui/flair/ThreeParticlesBg.tsx
"use client";

import * as React from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import * as THREE from "three";

/**
 * Flair option A — Three.js particles in SOM Portal brand tones.
 *
 * Palette matches v1 TrueMoney orange (#F26419): two warm particle colours
 * blended per-point so the field reads as hot embers over a deep-brown base.
 */

type ParticleProps = { count?: number };

function Particles({ count = 4500 }: ParticleProps) {
  const geomRef = React.useRef<THREE.BufferGeometry>(null);
  const matRef = React.useRef<THREE.PointsMaterial>(null);
  const pointsRef = React.useRef<THREE.Points>(null);

  // Positions + per-point colour. Mix two warm hues so the field feels alive.
  const [positions, colors] = React.useMemo(() => {
    const pos = new Float32Array(count * 3);
    const col = new Float32Array(count * 3);

    // Two brand-adjacent sRGB colours — hot orange + ember amber.
    const c1 = new THREE.Color("#FFB07A"); // light coral-orange
    const c2 = new THREE.Color("#F26419"); // SOM brand orange
    const c3 = new THREE.Color("#FFD38A"); // warm amber highlight

    for (let i = 0; i < count; i++) {
      const r = Math.pow(Math.random(), 0.55) * 6.2;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      pos[i * 3 + 0] = r * Math.sin(phi) * Math.cos(theta);
      pos[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta) * 0.55;
      pos[i * 3 + 2] = r * Math.cos(phi) * 0.4;

      const m = Math.random();
      const base = m < 0.55 ? c2 : m < 0.9 ? c1 : c3;
      col[i * 3 + 0] = base.r;
      col[i * 3 + 1] = base.g;
      col[i * 3 + 2] = base.b;
    }
    return [pos, col];
  }, [count]);

  React.useEffect(() => {
    const g = geomRef.current;
    if (!g) return;
    g.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    g.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    g.computeBoundingSphere();
  }, [positions, colors]);

  useFrame((state) => {
    const t = state.clock.getElapsedTime();
    if (pointsRef.current) {
      pointsRef.current.rotation.y = t * 0.055;
      pointsRef.current.rotation.x = Math.sin(t * 0.22) * 0.1;
    }
  });

  return (
    <points ref={pointsRef}>
      <bufferGeometry ref={geomRef} />
      <pointsMaterial
        ref={matRef}
        size={0.05}
        sizeAttenuation
        vertexColors
        transparent
        opacity={0.95}
        depthWrite={false}
        blending={THREE.AdditiveBlending}
      />
    </points>
  );
}

export function ThreeParticlesBg() {
  const [reduce, setReduce] = React.useState(false);
  React.useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduce(mq.matches);
    const onChange = () => setReduce(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 overflow-hidden"
      style={{
        // Deep warm base (burnt chocolate → near-black) so additive orange reads.
        background:
          "radial-gradient(ellipse at 32% 22%, oklch(0.30 0.08 42) 0%, oklch(0.18 0.05 42) 55%, oklch(0.10 0.025 42) 100%)",
      }}
    >
      <Canvas
        camera={{ position: [0, 0, 6], fov: 60 }}
        dpr={[1, 2]}
        gl={{ antialias: true, alpha: true }}
        frameloop={reduce ? "demand" : "always"}
      >
        <Particles />
      </Canvas>
    </div>
  );
}
