"use client";

import * as React from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import * as THREE from "three";

function OrangeBody() {
  const group = React.useRef<THREE.Group>(null);
  const bodyRef = React.useRef<THREE.Mesh>(null);

  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();
    if (group.current) {
      group.current.position.y = Math.sin(t * 1.2) * 0.15;
      group.current.rotation.z = Math.sin(t * 0.8) * 0.06;
    }
  });

  return (
    <group ref={group} position={[0, -0.2, 0]}>
      {/* main body — slightly squished sphere */}
      <mesh ref={bodyRef} scale={[1, 0.95, 0.95]}>
        <sphereGeometry args={[1, 32, 32]} />
        <meshStandardMaterial
          color="#F26419"
          roughness={0.35}
          metalness={0.05}
        />
      </mesh>

      {/* belly highlight */}
      <mesh position={[0, -0.15, 0.7]} scale={[0.55, 0.45, 0.2]}>
        <sphereGeometry args={[1, 16, 16]} />
        <meshStandardMaterial
          color="#FFD5A3"
          roughness={0.5}
          transparent
          opacity={0.6}
        />
      </mesh>

      {/* leaf stem */}
      <mesh position={[0, 1.0, 0]} rotation={[0, 0, 0.2]}>
        <cylinderGeometry args={[0.04, 0.04, 0.35, 8]} />
        <meshStandardMaterial color="#5A8C3C" roughness={0.6} />
      </mesh>

      {/* leaf */}
      <mesh position={[0.15, 1.22, 0]} rotation={[0.3, 0.4, 0.6]}>
        <sphereGeometry args={[0.18, 8, 8]} />
        <meshStandardMaterial
          color="#7BC950"
          roughness={0.5}
          metalness={0.05}
        />
      </mesh>

      <Eyes />
      <Mouth />
      <Cheeks />
      <Arms />
    </group>
  );
}

function Eyes() {
  const leftRef = React.useRef<THREE.Group>(null);
  const rightRef = React.useRef<THREE.Group>(null);

  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();
    const blink = Math.sin(t * 3) > 0.97 ? 0.1 : 1;
    if (leftRef.current) leftRef.current.scale.y = blink;
    if (rightRef.current) rightRef.current.scale.y = blink;
  });

  return (
    <>
      {/* left eye */}
      <group ref={leftRef} position={[-0.3, 0.2, 0.85]}>
        <mesh>
          <sphereGeometry args={[0.16, 16, 16]} />
          <meshStandardMaterial color="#FFFFFF" roughness={0.3} />
        </mesh>
        <mesh position={[0.03, 0.02, 0.1]}>
          <sphereGeometry args={[0.09, 12, 12]} />
          <meshStandardMaterial color="#2D2014" roughness={0.4} />
        </mesh>
        <mesh position={[0.06, 0.06, 0.14]}>
          <sphereGeometry args={[0.035, 8, 8]} />
          <meshStandardMaterial
            color="#FFFFFF"
            emissive="#FFFFFF"
            emissiveIntensity={0.5}
          />
        </mesh>
      </group>

      {/* right eye */}
      <group ref={rightRef} position={[0.3, 0.2, 0.85]}>
        <mesh>
          <sphereGeometry args={[0.16, 16, 16]} />
          <meshStandardMaterial color="#FFFFFF" roughness={0.3} />
        </mesh>
        <mesh position={[-0.03, 0.02, 0.1]}>
          <sphereGeometry args={[0.09, 12, 12]} />
          <meshStandardMaterial color="#2D2014" roughness={0.4} />
        </mesh>
        <mesh position={[-0.06, 0.06, 0.14]}>
          <sphereGeometry args={[0.035, 8, 8]} />
          <meshStandardMaterial
            color="#FFFFFF"
            emissive="#FFFFFF"
            emissiveIntensity={0.5}
          />
        </mesh>
      </group>
    </>
  );
}

function Mouth() {
  const curve = React.useMemo(() => {
    const c = new THREE.QuadraticBezierCurve3(
      new THREE.Vector3(-0.15, -0.15, 0.92),
      new THREE.Vector3(0, -0.25, 0.96),
      new THREE.Vector3(0.15, -0.15, 0.92),
    );
    return new THREE.TubeGeometry(c, 12, 0.025, 6, false);
  }, []);

  return (
    <mesh geometry={curve}>
      <meshStandardMaterial color="#C04A10" roughness={0.5} />
    </mesh>
  );
}

function Cheeks() {
  return (
    <>
      <mesh position={[-0.55, -0.02, 0.7]}>
        <sphereGeometry args={[0.12, 12, 12]} />
        <meshStandardMaterial
          color="#FF8888"
          transparent
          opacity={0.45}
          roughness={0.6}
        />
      </mesh>
      <mesh position={[0.55, -0.02, 0.7]}>
        <sphereGeometry args={[0.12, 12, 12]} />
        <meshStandardMaterial
          color="#FF8888"
          transparent
          opacity={0.45}
          roughness={0.6}
        />
      </mesh>
    </>
  );
}

function Arms() {
  const leftRef = React.useRef<THREE.Mesh>(null);
  const rightRef = React.useRef<THREE.Mesh>(null);

  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();
    if (leftRef.current) {
      leftRef.current.rotation.z = 0.4 + Math.sin(t * 2) * 0.15;
    }
    if (rightRef.current) {
      rightRef.current.rotation.z = -0.4 - Math.sin(t * 2 + 1) * 0.15;
    }
  });

  return (
    <>
      <mesh ref={leftRef} position={[-0.9, -0.1, 0.15]} rotation={[0, 0, 0.4]}>
        <capsuleGeometry args={[0.1, 0.35, 4, 8]} />
        <meshStandardMaterial color="#E8580C" roughness={0.4} />
      </mesh>
      <mesh ref={rightRef} position={[0.9, -0.1, 0.15]} rotation={[0, 0, -0.4]}>
        <capsuleGeometry args={[0.1, 0.35, 4, 8]} />
        <meshStandardMaterial color="#E8580C" roughness={0.4} />
      </mesh>
    </>
  );
}

function GroundShadow() {
  const ref = React.useRef<THREE.Mesh>(null);

  useFrame(({ clock }) => {
    if (!ref.current) return;
    const t = clock.getElapsedTime();
    const lift = (Math.sin(t * 1.2) + 1) / 2;
    const s = 1 - lift * 0.18;
    ref.current.scale.set(s, s, 1);
    (ref.current.material as THREE.MeshBasicMaterial).opacity = 0.32 - lift * 0.1;
  });

  return (
    <mesh ref={ref} position={[0, -1.25, 0]} rotation={[-Math.PI / 2, 0, 0]} scale={[0.9, 0.9, 1]}>
      <circleGeometry args={[1, 40]} />
      <meshBasicMaterial color="#000000" transparent opacity={0.3} depthWrite={false} />
    </mesh>
  );
}

function FloatingSparkles({ count = 40 }: { count?: number }) {
  const ref = React.useRef<THREE.Points>(null);

  const positions = React.useMemo(() => {
    const pos = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 8;
      pos[i * 3 + 1] = (Math.random() - 0.5) * 6;
      pos[i * 3 + 2] = (Math.random() - 0.5) * 4 - 2;
    }
    return pos;
  }, [count]);

  useFrame(({ clock }) => {
    if (!ref.current) return;
    const t = clock.getElapsedTime();
    ref.current.rotation.y = t * 0.03;
    const posAttr = ref.current.geometry.getAttribute("position");
    if (!posAttr) return;
    const arr = posAttr.array as Float32Array;
    for (let i = 0; i < count; i++) {
      arr[i * 3 + 1] = (arr[i * 3 + 1] ?? 0) + Math.sin(t * 0.5 + i) * 0.002;
    }
    posAttr.needsUpdate = true;
  });

  return (
    <points ref={ref}>
      <bufferGeometry>
        <bufferAttribute
          attach="attributes-position"
          args={[positions, 3]}
        />
      </bufferGeometry>
      <pointsMaterial
        size={0.06}
        sizeAttenuation
        color="#FFD5A3"
        transparent
        opacity={0.7}
        depthWrite={false}
        blending={THREE.AdditiveBlending}
      />
    </points>
  );
}

export function SomSomMascot({ className }: { className?: string }) {
  const [reduce, setReduce] = React.useState(false);

  React.useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduce(mq.matches);
    const fn = () => setReduce(mq.matches);
    mq.addEventListener("change", fn);
    return () => mq.removeEventListener("change", fn);
  }, []);

  return (
    <div aria-hidden className={className ?? "h-full w-full"}>
      <Canvas
        camera={{ position: [0, 0, 4.1], fov: 40 }}
        dpr={[1, 2]}
        gl={{ antialias: true, alpha: true }}
        frameloop={reduce ? "demand" : "always"}
        style={{ width: "100%", height: "100%" }}
      >
        <ambientLight intensity={0.85} />
        <hemisphereLight args={["#FFF1DC", "#7A2E08", 0.7]} />
        <directionalLight position={[3, 4, 5]} intensity={1.4} color="#FFF5E6" />
        <pointLight position={[-3, 2, 3]} intensity={1.1} color="#FFB36B" />
        <pointLight position={[2, -1, 2]} intensity={0.6} color="#FF8844" />
        <GroundShadow />
        <OrangeBody />
        <FloatingSparkles />
      </Canvas>
    </div>
  );
}
