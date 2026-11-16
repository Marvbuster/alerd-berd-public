"use client";

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { Origins } from "./Scene";

// Körper der Sphere: dunkle Kugel mit wanderndem, organischem Plasma/Lavalampen-
// Muster (3D-Value-Noise + fbm + Domain-Warping) und Fresnel-Rand. Zusätzlich
// „Force-Origins": jede Card gibt ihren Puls an ihrer Position ins Plasma ab.

const MAXO = 48;

const VS = `
varying vec3 vLocal; varying vec3 vN; varying vec3 vP;
void main(){
  vLocal = position;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vP = mv.xyz;
  vN = normalize(normalMatrix * normal);
  gl_Position = projectionMatrix * mv;
}
`;

const FS = `
precision highp float;
uniform float uTime;
uniform vec3 uRim;
uniform int uOCount;
uniform vec3 uOPos[${MAXO}];
uniform vec3 uOCol[${MAXO}];
uniform float uOInt[${MAXO}];
varying vec3 vLocal; varying vec3 vN; varying vec3 vP;

float hash(vec3 p){ p = fract(p*0.3183099 + 0.1); p *= 17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
float vnoise(vec3 x){
  vec3 i = floor(x), f = fract(x); f = f*f*(3.0-2.0*f);
  return mix(mix(mix(hash(i+vec3(0,0,0)),hash(i+vec3(1,0,0)),f.x),
                 mix(hash(i+vec3(0,1,0)),hash(i+vec3(1,1,0)),f.x),f.y),
             mix(mix(hash(i+vec3(0,0,1)),hash(i+vec3(1,0,1)),f.x),
                 mix(hash(i+vec3(0,1,1)),hash(i+vec3(1,1,1)),f.x),f.y), f.z);
}
float fbm(vec3 p){ float v=0.0, a=0.5; for(int i=0;i<4;i++){ v+=a*vnoise(p); p*=2.02; a*=0.5; } return v; }

void main(){
  vec3 dir = normalize(vLocal);
  vec3 q = dir * 2.6;
  float t = uTime * 0.09;

  vec3 warp = vec3(
    fbm(q + vec3(0.0, t, 0.0)),
    fbm(q + vec3(5.2, t*0.8, 1.3)),
    fbm(q + vec3(t*0.6, 2.7, 4.1))
  );
  float n = fbm(q + warp*1.9 + vec3(0.0, -t*1.2, 0.0));
  n = smoothstep(0.15, 0.95, n);

  // Force-Origins: Card-Puls beult + färbt das Plasma an ihrer Position
  vec3 add = vec3(0.0);
  for (int i = 0; i < ${MAXO}; i++) {
    if (i >= uOCount) break;
    vec3 op = normalize(uOPos[i]);
    // leichtes, pro Origin zufälliges Wandern des Puls-Spots (tangential)
    float sd = hash(op * 3.7) * 6.2831;
    vec3 t1 = normalize(cross(op, vec3(0.0, 1.0, 0.0)) + vec3(0.0011));
    vec3 t2 = cross(op, t1);
    vec3 opd = normalize(op + (t1 * sin(uTime * 0.25 + sd) + t2 * cos(uTime * 0.21 + sd * 1.3)) * 0.06);
    float prox = smoothstep(0.80, 1.0, dot(dir, opd));
    float amt = uOInt[i] * prox;
    n += amt * 0.45;
    add += uOCol[i] * amt;
  }

  vec3 c1 = vec3(0.012, 0.022, 0.058);
  vec3 c2 = vec3(0.028, 0.105, 0.240);
  vec3 c3 = vec3(0.090, 0.300, 0.640);
  vec3 col = mix(c1, c2, smoothstep(0.25, 0.6, n));
  col = mix(col, c3, smoothstep(0.66, 0.98, n) * 0.75);

  float vein = smoothstep(0.02, 0.0, abs(n - 0.62));
  col += uRim * vein * 0.15;

  // Puls-Farbe der Cards einblenden (kräftigerer Peak)
  col += add * (0.8 + n * 1.0);

  vec3 V = normalize(-vP);
  float fres = pow(1.0 - max(dot(normalize(vN), V), 0.0), 2.6);
  col = mix(col, uRim, fres * 0.7);

  gl_FragColor = vec4(col, 1.0);
}
`;

// Atmosphären-Glow: größere Backside-Kugel, additiv. Der Planet (opak) verdeckt
// die Mitte via Depth → übrig bleibt ein leuchtender Ring am Rand.
// Nebel-Glow: kamera-zugewandtes Quad hinter dem Planeten. fbm-Noise macht
// wabernde, ausgefranste Schwaden statt perfektem Ring; der Planet (opak)
// verdeckt die Mitte → außen bleibt organischer, animierter Nebel.
const GLOW_VS = `
varying vec2 vUv;
void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;
const GLOW_FS = `
precision highp float;
uniform float uTime; uniform vec3 uColor; uniform float uIntensity;
varying vec2 vUv;
float hash(vec3 p){ p = fract(p*0.3183099 + 0.1); p *= 17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
float vnoise(vec3 x){
  vec3 i = floor(x), f = fract(x); f = f*f*(3.0-2.0*f);
  return mix(mix(mix(hash(i+vec3(0,0,0)),hash(i+vec3(1,0,0)),f.x),
                 mix(hash(i+vec3(0,1,0)),hash(i+vec3(1,1,0)),f.x),f.y),
             mix(mix(hash(i+vec3(0,0,1)),hash(i+vec3(1,0,1)),f.x),
                 mix(hash(i+vec3(0,1,1)),hash(i+vec3(1,1,1)),f.x),f.y), f.z);
}
float fbm(vec3 p){ float v=0.0,a=0.5; for(int i=0;i<5;i++){ v+=a*vnoise(p); p*=2.03; a*=0.5; } return v; }
void main(){
  vec2 p = (vUv - 0.5) * 2.0;   // -1..1
  float r = length(p);
  if (r >= 1.0) discard;
  float t = uTime * 0.05;
  // Domain-Warp für wirbelnde Schwaden
  float warp = fbm(vec3(p * 2.0, t));
  float n = fbm(vec3(p * 3.2 + warp * 1.8, t * 1.2));
  float fine = fbm(vec3(p * 7.5 - warp * 1.2, t * 0.9));   // feines Detail
  float dens = fbm(vec3(p * 1.1, t * 0.5 + 4.0));          // grobe Dichte-Schwaden
  float f = n * (0.55 + 0.7 * fine);
  f = pow(clamp(f, 0.0, 1.0), 1.6);                        // mehr Kontrast
  // ausgefranster, verrauschter Außenrand (nicht perfekt rund)
  float outer = 0.95 + 0.46 * (n - 0.5);
  float glow = smoothstep(outer, 0.55, r);                 // vom Planetenrand nach außen
  glow *= (0.18 + 1.25 * f) * (0.4 + 0.95 * dens);         // heterogen
  glow = clamp(glow, 0.0, 1.0);
  gl_FragColor = vec4(uColor * glow * uIntensity, 1.0);
}
`;

export function SphereShell({ radius, origins, focused }: { radius: number; origins: React.RefObject<Origins>; focused: boolean }) {
  const groupRef = useRef<THREE.Group>(null);
  const _q = useMemo(() => new THREE.Quaternion(), []);
  // Material + Mesh imperativ (wie das Sternenfeld) — Uniform-Mutation kommt so
  // zuverlässig am Shader an; JSX-<shaderMaterial> hat sie hier verschluckt.
  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uRim: { value: new THREE.Color(0.18, 0.42, 0.95) },
      uOCount: { value: 0 },
      uOPos: { value: origins.current.pos },
      uOCol: { value: origins.current.col },
      uOInt: { value: origins.current.int },
    }),
    [origins],
  );

  const mesh = useMemo(() => {
    const geo = new THREE.SphereGeometry(radius * 0.96, 96, 64);
    const mat = new THREE.ShaderMaterial({ vertexShader: VS, fragmentShader: FS, uniforms });
    return new THREE.Mesh(geo, mat);
  }, [radius, uniforms]);

  const glowUniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uColor: { value: new THREE.Color(0.24, 0.55, 1.0) },
      uIntensity: { value: 0.62 },
    }),
    [],
  );
  const glow = useMemo(() => {
    const geo = new THREE.PlaneGeometry(radius * 3.1, radius * 3.1);
    const mat = new THREE.ShaderMaterial({
      vertexShader: GLOW_VS,
      fragmentShader: GLOW_FS,
      uniforms: glowUniforms,
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false,
    });
    const m = new THREE.Mesh(geo, mat);
    m.renderOrder = 1;
    return m;
  }, [radius, glowUniforms]);

  useFrame((state, delta) => {
    uniforms.uTime.value = state.clock.elapsedTime;
    uniforms.uOCount.value = origins.current.count;
    glowUniforms.uTime.value = state.clock.elapsedTime;
    // Billboard: Nebel-Quad immer zur Kamera (parent-korrigiert wg. Fokus-Rotation)
    if (glow.parent) {
      glow.parent.getWorldQuaternion(_q);
      _q.invert();
      glow.quaternion.copy(_q).multiply(state.camera.quaternion);
    } else {
      glow.quaternion.copy(state.camera.quaternion);
    }
    // Bei Fokus: Plasma + Nebel smooth aufziehen, bis der Hintergrund gefüllt ist
    if (groupRef.current) {
      const target = focused ? 2.1 : 1.0;
      const s = groupRef.current.scale.x + (target - groupRef.current.scale.x) * Math.min(1, delta * 2.4);
      groupRef.current.scale.setScalar(s);
    }
  });

  return (
    <group ref={groupRef}>
      <primitive object={glow} />
      <primitive object={mesh} />
    </group>
  );
}
