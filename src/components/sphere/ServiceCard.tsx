"use client";

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { type VizNode, STATUS_COLOR, liveUptimeMs } from "@/lib/viz";
import type { Dir } from "@/lib/sphere-layout";
import type { Origins } from "./Scene";

const FOCUS_SCALE = 2.4; // Ziel-Größe im Fokus (Übergang; Face blendet dann aus)
const WHITE = new THREE.Color(1, 1, 1);

const CARD_W = 2.0;
const CARD_H = 1.26;
const TW = 512;
const TH = 322;

function sizeFor(status: string): number {
  switch (status) {
    case "DOWN": return 2.0;
    case "DEGRADED": return 1.5;
    case "UP": return 1.0;
    default: return 0.82;
  }
}

function fmtDur(ms: number | null): string {
  if (ms == null) return "—";
  const s = Math.max(0, ms / 1000);
  if (s < 60) return `${Math.floor(s)}s`;
  const m = s / 60;
  if (m < 60) return `${Math.floor(m)}m`;
  const h = m / 60;
  if (h < 24) return `${Math.floor(h)}h ${Math.floor(m % 60)}m`;
  const d = h / 24;
  return `${Math.floor(d)}d ${Math.floor(h % 24)}h`;
}
function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// weiche, runde Glow-Textur (einmal, für alle Cards)
let GLOW: THREE.CanvasTexture | null = null;
function glowTex(): THREE.CanvasTexture {
  if (GLOW) return GLOW;
  const s = 160;
  const c = document.createElement("canvas");
  c.width = c.height = s;
  const ctx = c.getContext("2d")!;
  const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.35, "rgba(255,255,255,0.45)");
  g.addColorStop(0.7, "rgba(255,255,255,0.12)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
  GLOW = new THREE.CanvasTexture(c);
  return GLOW;
}

interface Props {
  node: VizNode;
  dir: Dir;
  radius: number;
  anySelected: boolean;
  selected: boolean;
  onSelect: (id: string) => void;
  origins: React.RefObject<Origins>;
  index: number;
}

export function ServiceCard({ node, dir, radius, anySelected, selected, onSelect, origins, index }: Props) {
  const groupRef = useRef<THREE.Group>(null);
  const faceMat = useRef<THREE.MeshBasicMaterial>(null);
  const glowMat = useRef<THREE.MeshBasicMaterial>(null);
  const flash = useRef(0);
  const sphereRise = useRef(0); // verzögerter Follower → Sphere reagiert nach der Card
  const echo = useRef(0); // langsam abklingender Nachhall für die Sphere
  const dimCur = useRef(1);
  const selCur = useRef(0);
  const focusA = useRef(0); // 0..1 Fokus (Card wächst)

  const color = STATUS_COLOR[node.status];
  const size = useMemo(() => sizeFor(node.status), [node.status]);
  const three = useMemo(() => new THREE.Color(color), [color]);
  const glow = useMemo(() => glowTex(), []);
  const _q = useMemo(() => new THREE.Quaternion(), []);
  const hovered = useRef(false);
  const hoverCur = useRef(0);
  const prevCyc = useRef(0); // vorheriger Zyklus-Fortschritt → Wrap = Check

  // phasenbasierter Zyklus-Fortschritt (0..1) im Check-Intervall
  const cyc = () => {
    const intervalMs = node.intervalSec * 1000;
    const phaseMs = node.phase * intervalMs;
    return ((((Date.now() - phaseMs) % intervalMs) + intervalMs) % intervalMs) / intervalMs;
  };

  // eigenes Canvas + Textur, wird pro Frame neu gezeichnet (animierte Puls-Linie + Live-Zeiten)
  const face = useMemo(() => {
    const canvas = document.createElement("canvas");
    canvas.width = TW;
    canvas.height = TH;
    const tex = new THREE.CanvasTexture(canvas);
    tex.anisotropy = 4;
    return { canvas, ctx: canvas.getContext("2d")!, tex };
  }, []);

  const position = useMemo(
    () => new THREE.Vector3(dir[0], dir[1], dir[2]).normalize().multiplyScalar(radius),
    [dir, radius],
  );

  function draw() {
    const ctx = face.ctx;
    ctx.clearRect(0, 0, TW, TH);
    // Karten-Grundfläche
    roundRect(ctx, 8, 8, TW - 16, TH - 16, 40);
    ctx.fillStyle = "#192d44";
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = color;
    ctx.globalAlpha = 0.38;
    ctx.stroke();
    ctx.globalAlpha = 1;
    // dezenter oberer Lichtsaum
    ctx.save();
    ctx.beginPath();
    roundRect(ctx, 8, 8, TW - 16, TH - 16, 40);
    ctx.clip();
    const gg = ctx.createLinearGradient(0, 8, 0, 90);
    gg.addColorStop(0, "rgba(255,255,255,0.05)");
    gg.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = gg;
    ctx.fillRect(8, 8, TW - 16, 82);
    ctx.restore();
    ctx.textBaseline = "alphabetic";

    // Progress-Ring oben rechts (nächster Check) + Check-Flash
    const cx = TW - 54, cy = 54, rad = 24;
    const prog = node.enabled && node.lastCheckedMs != null ? cyc() : 0;
    ctx.beginPath();
    ctx.arc(cx, cy, rad, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(177,195,217,0.18)";
    ctx.lineWidth = 4;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx, cy, rad, -Math.PI / 2, -Math.PI / 2 + prog * Math.PI * 2);
    ctx.strokeStyle = color;
    ctx.lineWidth = 4;
    ctx.lineCap = "round";
    ctx.stroke();
    ctx.lineCap = "butt";
    const fl = flash.current;
    if (fl > 0.02) {
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      ctx.globalAlpha = fl;
      ctx.beginPath();
      ctx.arc(cx, cy, rad, 0, Math.PI * 2);
      ctx.strokeStyle = color;
      ctx.lineWidth = 9;
      ctx.stroke();
      ctx.globalAlpha = fl * 0.95;
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.restore();
    }

    // Header: LED + Name
    ctx.beginPath();
    ctx.arc(42, 50, 7, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.globalAlpha = 0.5;
    ctx.beginPath();
    ctx.arc(42, 50, 12, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.restore();

    let fs = 38;
    const maxW = TW - 64 - 76; // Ring-Bereich rechts freihalten
    ctx.font = `bold ${fs}px system-ui, sans-serif`;
    while (ctx.measureText(node.label).width > maxW && fs > 15) {
      fs -= 2;
      ctx.font = `bold ${fs}px system-ui, sans-serif`;
    }
    ctx.fillStyle = "#edf4fc";
    ctx.fillText(node.label, 62, 60);

    // SEIT (Hero)
    ctx.font = "13px system-ui, sans-serif";
    ctx.fillStyle = "rgba(177,195,217,0.7)";
    // Läuft der Dienst und meldet seine Laufzeit, zählt die seit dem letzten
    // Start oder Deploy. Sonst: seit wann der Status unverändert ist.
    const uptime = liveUptimeMs(node);
    ctx.fillText(uptime != null ? "L A U F Z E I T" : "S E I T", 34, 116);
    ctx.font = "bold 56px system-ui, sans-serif";
    ctx.fillStyle = color;
    ctx.fillText(fmtDur(uptime ?? (node.stateSinceMs != null ? Date.now() - node.stateSinceMs : null)), 32, 172);

    // Divider
    ctx.strokeStyle = "rgba(177,195,217,0.14)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(34, 200);
    ctx.lineTo(TW - 34, 200);
    ctx.stroke();

    // Sekundär-Stats
    const col2 = TW / 2 + 10;
    ctx.font = "11px system-ui, sans-serif";
    ctx.fillStyle = "rgba(177,195,217,0.65)";
    ctx.fillText("ANTWORTZEIT", 34, 228);
    ctx.fillText("INTERVALL", col2, 228);
    ctx.font = "22px system-ui, sans-serif";
    ctx.fillStyle = "#d3e0f0";
    ctx.fillText(node.responseMs != null ? `${node.responseMs} ms` : "—", 34, 256);
    ctx.fillText(`${node.intervalSec} s`, col2, 256);

    // Letzter grüner Check — nur wenn nicht UP
    if (node.status !== "UP") {
      ctx.font = "11px system-ui, sans-serif";
      ctx.fillStyle = "rgba(177,195,217,0.65)";
      ctx.fillText("LETZTER OK", 34, 290);
      ctx.font = "16px system-ui, sans-serif";
      ctx.fillStyle = color;
      const lo = node.lastUpMs != null ? `vor ${fmtDur(Date.now() - node.lastUpMs)}` : "—";
      ctx.fillText(lo, 34 + ctx.measureText("LETZTER OK ").width + 6, 291);
    }

    face.tex.needsUpdate = true;
  }

  useFrame((state, delta) => {
    // Check-Ereignisse (phasengestaffelt) → Flash beim Zyklus-Wrap.
    flash.current *= 0.9;
    const c = cyc();
    if (node.enabled && node.lastCheckedMs != null && c < prevCyc.current) flash.current = 1;
    prevCyc.current = c;
    const f = flash.current;

    // Rollover: leichter, atmender Puls solange gehovert (auch in die Sphere)
    hoverCur.current += ((hovered.current ? 1 : 0) - hoverCur.current) * Math.min(1, delta * 8);
    const hoverPulse = hoverCur.current * (0.4 + 0.35 * Math.sin(state.clock.elapsedTime * 5));

    // Der Puls wandert von der Card in die Sphere: sphereRise folgt dem Card-Flash
    // VERZÖGERT (peakt ~150ms später), echo lässt ihn dann langsam nachhallen.
    sphereRise.current += (f - sphereRise.current) * 0.1;
    echo.current = Math.max(sphereRise.current, echo.current * 0.978);
    if (origins.current && index < origins.current.int.length) {
      origins.current.int[index] = 0.08 + echo.current * 1.7 + hoverPulse * 0.35; // Check + Hover
    }

    const k = Math.min(1, delta * 5);
    const targetDim = anySelected && !selected ? 0.16 : 1;
    dimCur.current += (targetDim - dimCur.current) * k;
    selCur.current += ((selected ? 1 : 0) - selCur.current) * k;
    focusA.current += ((selected ? 1 : 0) - focusA.current) * Math.min(1, delta * 3);
    const dim = dimCur.current;
    const fa = focusA.current * focusA.current * (3 - 2 * focusA.current); // smoothstep

    draw();
    // Face/Glow deutlich schneller ausblenden als der Scale-Übergang läuft →
    // die low-res Card ist weg, bevor das scharfe HTML-Panel greift.
    const hide = Math.min(1, focusA.current * 3.2);

    if (groupRef.current) {
      const g = groupRef.current;
      // Billboard zur Kamera — auch wenn die Eltern-Gruppe (Fokus-Rotation) gedreht ist
      if (g.parent) {
        g.parent.getWorldQuaternion(_q);
        _q.invert();
        g.quaternion.copy(_q).multiply(state.camera.quaternion);
      } else {
        g.quaternion.copy(state.camera.quaternion);
      }
      // Tiefen-Skalierung + Fokus-Wachstum
      const dist = position.distanceTo(state.camera.position);
      const depth = THREE.MathUtils.clamp(THREE.MathUtils.mapLinear(dist, 11, 16, 1.18, 0.82), 0.82, 1.18);
      const normalScale = size * depth * (1 + f * 0.06) * (1 + selCur.current * 0.05);
      g.scale.setScalar(normalScale + (FOCUS_SCALE - normalScale) * fa);
    }
    if (faceMat.current) {
      faceMat.current.color.setScalar((1 + f * 0.7) * dim);
      faceMat.current.opacity = dim * (1 - hide);
    }
    if (glowMat.current) {
      // Background-Glow: Check-Flash + Hover-Puls; beim Check weiß-grün (lighter);
      // im Fokus schnell ausblenden (nur die Sphere pulst dann im BG).
      glowMat.current.opacity = (0.05 + f * 1.4 + hoverPulse * 0.5) * dim * (1 - hide);
      glowMat.current.color.copy(three).lerp(WHITE, f * 0.6);
    }
  });

  return (
    <group ref={groupRef} position={position}>
      <mesh position={[0, 0, -0.05]} renderOrder={10}>
        <planeGeometry args={[CARD_W * 2.4, CARD_H * 2.9]} />
        <meshBasicMaterial
          ref={glowMat}
          map={glow}
          color={three}
          transparent
          opacity={0.03}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          depthTest={false}
          toneMapped={false}
        />
      </mesh>
      <mesh
        renderOrder={11}
        onPointerDown={(e) => {
          e.stopPropagation();
          onSelect(node.id);
        }}
        onPointerOver={() => {
          hovered.current = true;
          document.body.style.cursor = "pointer";
        }}
        onPointerOut={() => {
          hovered.current = false;
          document.body.style.cursor = "";
        }}
      >
        <planeGeometry args={[CARD_W, CARD_H]} />
        <meshBasicMaterial ref={faceMat} map={face.tex} transparent depthWrite={false} depthTest={false} toneMapped={false} />
      </mesh>
    </group>
  );
}
