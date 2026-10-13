// som-portal-v2/src/ui/flair/AmbientOrbBg.tsx
"use client";

import * as React from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import * as THREE from "three";

/**
 * Ambient orb — slow, intentional. One central soft sphere + sparse particles
 * drifting around it, SOM Portal orange brand. Replaces the chaotic noise of
 * ThreeParticlesBg for the hero panel of login.
 */

function Orb() {
  const mesh = React.useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();
    if (mesh.current) {
      mesh.current.rotation.x = Math.sin(t * 0.12) * 0.35;
      mesh.current.rotation.y = t * 0.06;
      const s = 1 + Math.sin(t * 0.4) * 0.03;
      mesh.current.scale.set(s, s, s);
    }
  });

  // Far bottom-right, mostly off-canvas so it reads as a distant sun / atmospheric glow.
  return (
    <mesh ref={mesh} position={[4.2, -3.6, -3.5]}>
      <icosahedronGeometry args={[2.0, 2]} />
      <meshStandardMaterial
        color="#F26419"
        emissive="#F26419"
        emissiveIntensity={0.3}
        roughness={0.6}
        metalness={0.2}
        flatShading
        transparent
        opacity={0.72}
      />
    </mesh>
  );
}

function Sparks({ count = 1800 }: { count?: number }) {
  const geomRef = React.useRef<THREE.BufferGeometry>(null);
  const pointsRef = React.useRef<THREE.Points>(null);

  const [positions, colors] = React.useMemo(() => {
    const pos = new Float32Array(count * 3);
    const col = new Float32Array(count * 3);
    const warm = new THREE.Color("#FFC58A");
    const brand = new THREE.Color("#F26419");
    for (let i = 0; i < count; i++) {
      // Spherical shell further out so the orb is the focal point.
      const r = 3.2 + Math.random() * 4.5;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      pos[i * 3 + 0] = r * Math.sin(phi) * Math.cos(theta);
      pos[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta) * 0.7;
      pos[i * 3 + 2] = r * Math.cos(phi) * 0.5;
      const base = Math.random() < 0.6 ? brand : warm;
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

  useFrame(({ clock }) => {
    if (pointsRef.current) {
      pointsRef.current.rotation.y = clock.getElapsedTime() * 0.02;
    }
  });

  return (
    <points ref={pointsRef}>
      <bufferGeometry ref={geomRef} />
      <pointsMaterial
        size={0.035}
        sizeAttenuation
        vertexColors
        transparent
        opacity={0.75}
        depthWrite={false}
        blending={THREE.AdditiveBlending}
      />
    </points>
  );
}

export function AmbientOrbBg() {
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
        background:
          "radial-gradient(ellipse at 42% 38%, oklch(0.26 0.085 42) 0%, oklch(0.14 0.045 42) 55%, oklch(0.08 0.025 42) 100%)",
      }}
    >
      <Canvas
        camera={{ position: [0, 0, 7], fov: 50 }}
        dpr={[1, 2]}
        gl={{ antialias: true, alpha: true }}
        frameloop={reduce ? "demand" : "always"}
      >
        <ambientLight intensity={0.4} />
        <pointLight position={[-6, 4, 6]} intensity={2.4} color="#FFB36B" />
        <pointLight position={[6, -3, 4]} intensity={1.6} color="#F26419" />
        <Orb />
        <Sparks />
      </Canvas>
      {/* Soft radial glow bleeding from where the orb sits. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse at 82% 85%, oklch(0.42 0.14 42 / 0.6) 0%, transparent 42%)",
          mixBlendMode: "screen",
        }}
      />
      {/* Vignette: darken top-left so the headline sits on a quiet surface. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "linear-gradient(135deg, oklch(0.05 0.015 42 / 0.65) 0%, oklch(0.05 0.015 42 / 0.1) 55%, transparent 100%)",
        }}
      />
    </div>
  );
}
