"use client";

import { useMemo, useRef } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import { type VizNode, type VizStatus, STATUS_COLOR } from "@/lib/viz";
import { placeOnCap } from "@/lib/sphere-layout";
import { Starfield } from "./Starfield";
import { SphereShell } from "./SphereShell";
import { ServiceCard } from "./ServiceCard";

const RADIUS = 6;
const MARGIN = 0.3;
export const MAXO = 48;

const SEVERITY: Record<VizStatus, number> = { DOWN: 0, DEGRADED: 1, UP: 2, UNKNOWN: 3 };

function hexRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

// Dreht Sphere + Cards so, dass die gewählte Card-Richtung zur Kamera zeigt.
function FocusRotator({
  targetDir,
  children,
}: {
  targetDir: [number, number, number] | null;
  children: React.ReactNode;
}) {
  const ref = useRef<THREE.Group>(null);
  const q = useMemo(() => new THREE.Quaternion(), []);
  const from = useMemo(() => new THREE.Vector3(), []);
  const to = useMemo(() => new THREE.Vector3(), []);
  useFrame((state, delta) => {
    if (!ref.current) return;
    if (targetDir) {
      from.set(targetDir[0], targetDir[1], targetDir[2]).normalize();
      to.copy(state.camera.position).normalize();
      q.setFromUnitVectors(from, to);
    } else {
      q.identity();
    }
    ref.current.quaternion.slerp(q, Math.min(1, delta * 2.0));
  });
  return <group ref={ref}>{children}</group>;
}

// Geteilter Puffer: Cards schreiben ihre Puls-Intensität rein, die Sphere liest.
export interface Origins {
  pos: Float32Array;
  col: Float32Array;
  int: Float32Array;
  count: number;
}

export function Scene({
  nodes,
  selectedId,
  onSelect,
}: {
  nodes: VizNode[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}) {
  const ordered = [...nodes].sort((a, b) => SEVERITY[a.status] - SEVERITY[b.status]);
  const { dirs, half } = placeOnCap(ordered.length);
  const limit = half + MARGIN;

  const origins = useRef<Origins>({
    pos: new Float32Array(MAXO * 3),
    col: new Float32Array(MAXO * 3),
    int: new Float32Array(MAXO),
    count: 0,
  });

  // Positionen + Farben je Render setzen (Intensität schreiben die Cards).
  const o = origins.current;
  o.count = Math.min(ordered.length, MAXO);
  for (let i = 0; i < o.count; i++) {
    const d = dirs[i] ?? [0, 0, 1];
    o.pos[i * 3] = d[0];
    o.pos[i * 3 + 1] = d[1];
    o.pos[i * 3 + 2] = d[2];
    const [r, g, b] = hexRgb(STATUS_COLOR[ordered[i].status]);
    o.col[i * 3] = r;
    o.col[i * 3 + 1] = g;
    o.col[i * 3 + 2] = b;
  }

  const camPos = useMemo<[number, number, number]>(() => [0, 0, RADIUS + 11], []);

  const selIdx = ordered.findIndex((n) => n.id === selectedId);
  const selectedDir = selIdx >= 0 ? dirs[selIdx] ?? null : null;

  return (
    <Canvas
      className="touch-none"
      camera={{ position: camPos, fov: 40 }}
      gl={{ antialias: true, alpha: false }}
      dpr={[1, 2]}
      onPointerMissed={() => onSelect(null)}
    >
      <color attach="background" args={["#102035"]} />
      <fog attach="fog" args={["#102035", 14, 30]} />
      <Starfield />
      <Starfield count={520} sizeScale={2.4} spread={230} />

      <FocusRotator targetDir={selectedDir}>
        <SphereShell radius={RADIUS} origins={origins} focused={selectedId != null} />
        {ordered.map((n, i) => (
          <ServiceCard
            key={n.id}
            node={n}
            dir={dirs[i] ?? [0, 0, 1]}
            radius={RADIUS}
            anySelected={selectedId != null}
            selected={selectedId === n.id}
            onSelect={onSelect}
            origins={origins}
            index={i}
          />
        ))}
      </FocusRotator>

      <OrbitControls
        makeDefault
        enabled={selectedId == null}
        enablePan={false}
        enableZoom
        minDistance={12}
        maxDistance={28}
        enableDamping
        dampingFactor={0.045}
        rotateSpeed={0.4}
        zoomSpeed={0.6}
        minPolarAngle={Math.PI / 2 - limit}
        maxPolarAngle={Math.PI / 2 + limit}
        minAzimuthAngle={-limit}
        maxAzimuthAngle={limit}
      />
    </Canvas>
  );
}
