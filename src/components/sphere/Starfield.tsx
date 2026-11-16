"use client";

// Sternenfeld 1:1 übernommen aus dem OTRS ai-proxy Netzwerk-Modul
// (otrs-llm-tools/app/(admin)/network/network-neuron.tsx, ~Z. 395–452 + 669).
// NUR die Sterne (kein Skybox/Cubemap). Als R3F-Komponente gekapselt.

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

export function Starfield({
  count = 1500,
  sizeScale = 1,
  spread = 195,
}: {
  count?: number;
  sizeScale?: number;
  spread?: number;
} = {}) {
  const ref = useRef<THREE.Points>(null);
  const uniforms = useMemo(() => ({ uTime: { value: 0 } }), []);

  const points = useMemo(() => {
    const STAR_N = count;
    const dustGeo = new THREE.BufferGeometry();
    const dp = new Float32Array(STAR_N * 3);
    const aPhase = new Float32Array(STAR_N);
    const aSize = new Float32Array(STAR_N);
    const aFlare = new Float32Array(STAR_N);
    const aSpeed = new Float32Array(STAR_N);
    for (let i = 0; i < STAR_N; i++) {
      dp[i * 3] = (Math.random() - 0.5) * spread;
      dp[i * 3 + 1] = (Math.random() - 0.5) * spread;
      dp[i * 3 + 2] = (Math.random() - 0.5) * spread;
      aPhase[i] = Math.random() * Math.PI * 2;
      const big = Math.random() < 0.12;
      aSize[i] = (big ? 3.0 + Math.random() * 3.5 : 1.0 + Math.random() * 1.6) * sizeScale;
      // NUR kleine Sterne funkeln (~25% davon) — große bleiben ruhige, steady Lichter.
      aFlare[i] = !big && Math.random() < 0.25 ? 0.3 + Math.pow(Math.random(), 2.0) * 0.7 : 0.0;
      aSpeed[i] = 0.7 + Math.random() * 2.3; // eigene Funkel-Frequenz pro Stern
    }
    dustGeo.setAttribute("position", new THREE.BufferAttribute(dp, 3));
    dustGeo.setAttribute("aPhase", new THREE.BufferAttribute(aPhase, 1));
    dustGeo.setAttribute("aSize", new THREE.BufferAttribute(aSize, 1));
    dustGeo.setAttribute("aFlare", new THREE.BufferAttribute(aFlare, 1));
    dustGeo.setAttribute("aSpeed", new THREE.BufferAttribute(aSpeed, 1));
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      uniforms,
      vertexShader: `
        attribute float aPhase; attribute float aSize; attribute float aFlare; attribute float aSpeed;
        uniform float uTime; varying float vFlare;
        float h11(float n){ return fract(sin(n)*43758.5453123); }
        float vn(float x){ float i=floor(x); float f=fract(x); return mix(h11(i), h11(i+1.0), f*f*(3.0-2.0*f)); }
        void main(){
          float rate = 1.6 + aSpeed*1.8;              // ~3-6 „Hz" → ruhiges Schimmern, kein Strobo
          float n = vn(uTime*rate + aPhase*91.7);     // Wert-Rausch → unregelmäßiges Funkeln (kein Sinus)
          vFlare = pow(n, 2.2) * aFlare;              // nur die Funkel-Sterne, meist dunkel, seltene Blitzer
          vec4 mv = modelViewMatrix*vec4(position,1.0);
          gl_PointSize = aSize * (1.25 + 2.8*vFlare);
          gl_Position = projectionMatrix*mv;
        }`,
      fragmentShader: `
        varying float vFlare;
        void main(){
          vec2 uv = gl_PointCoord - 0.5;
          float d = length(uv);
          float core = smoothstep(0.5, 0.0, d);
          float ax = abs(uv.x), ay = abs(uv.y);
          float spikeH = smoothstep(0.08, 0.0, ay) * (1.0 - smoothstep(0.0, 0.5, ax));
          float spikeV = smoothstep(0.08, 0.0, ax) * (1.0 - smoothstep(0.0, 0.5, ay));
          float spikes = (spikeH + spikeV) * vFlare;
          vec3 col = mix(vec3(0.34,0.58,1.0), vec3(1.0), vFlare);
          float alpha = core*(0.62 + 0.55*vFlare) + spikes*0.95;
          if (alpha < 0.004) discard;
          gl_FragColor = vec4(col, alpha);
        }`,
    });
    return new THREE.Points(dustGeo, mat);
  }, [uniforms, count, sizeScale, spread]);

  useFrame((state) => {
    const t = state.clock.elapsedTime;
    uniforms.uTime.value = t;
    if (ref.current) {
      ref.current.rotation.y = t * 0.018;
      ref.current.rotation.x = Math.sin(t * 0.01) * 0.05;
    }
  });

  return <primitive object={points} ref={ref} />;
}
