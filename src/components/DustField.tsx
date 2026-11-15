"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";

// A night landscape drawn in dust: a few hundred thousand points on a lit noise terrain that sway
// slowly. Same technique as pineapplehacks.com. `dim` fades it behind results, `stir` makes it
// move faster while a search runs.

const VERT = `
  uniform float uTime;
  uniform float uSize;
  uniform float uScale;
  uniform float uMotion;
  attribute vec3 color;
  varying vec3 vColor;

  float hash(vec3 p) {
    return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
  }

  void main() {
    vec3 p = position;
    float t = uTime;

    // Shared sway: higher ground moves more.
    float amp = (0.012 + 0.04 * max(0.0, (p.y + 3.0) / 8.0)) * uMotion;
    p.x += sin(0.4 * t + 0.6 * p.y + 0.15 * p.x) * amp + sin(0.25 * t + 0.3 * p.x) * amp * 0.5;
    p.y += cos(0.35 * t + 0.4 * p.x) * amp * 0.4;
    p.z += sin(0.3 * t + 0.2 * p.y + 0.1 * p.x) * amp * 0.3;

    // Each grain circles its own spot, so the dust shimmers instead of moving as one sheet.
    float r = hash(position);
    float r2 = hash(position.yzx + 7.0);
    float speed = 0.5 + r2 * 1.2;
    float wob = 0.018 * uMotion;
    p.x += sin(t * speed + r * 6.2831) * wob;
    p.y += cos(t * speed * 0.8 + r * 6.2831) * wob;
    p.z += sin(t * speed * 0.6 + r2 * 6.2831) * wob * 2.0;

    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = uSize * (uScale / -mv.z);
    vColor = color;
  }
`;

const FRAG = `
  uniform float uBrightness;
  varying vec3 vColor;
  void main() {
    gl_FragColor = vec4(vColor * uBrightness, 0.92);
  }
`;

// Value noise and fbm for the terrain.
const hash2 = (x: number, y: number) => {
  let i = (0x165667b1 * x + 0x27d4eb2f * y) | 0;
  i = Math.imul(i ^ (i >>> 13), 0x4bf19f61);
  return ((i ^ (i >>> 16)) >>> 0) / 0xffffffff;
};
const noise = (x: number, y: number) => {
  const xi = Math.floor(x), yi = Math.floor(y);
  const fx = x - xi, fy = y - yi;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const a = hash2(xi, yi), b = hash2(xi + 1, yi), c = hash2(xi, yi + 1), d = hash2(xi + 1, yi + 1);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
};
const fbm = (x: number, y: number) => {
  let v = 0, amp = 0.5, f = 1;
  for (let o = 0; o < 4; o++) {
    v += noise(x * f, y * f) * amp;
    f *= 2;
    amp *= 0.5;
  }
  return v / 0.9375;
};
const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const LIGHT = (() => {
  const v = [-0.55, 0.45, -0.7];
  const n = Math.hypot(v[0], v[1], v[2]);
  return v.map((c) => c / n);
})();

type View = { camY: number; camZ: number; tanHalf: number; aspect: number; baseY: number };

function buildGround({ camY, camZ, tanHalf, aspect, baseY }: View, count: number) {
  const pos = new Float32Array(count * 3);
  const col = new Float32Array(count * 3);
  const height = (x: number, z: number) =>
    baseY +
    (fbm(0.07 * x + 3.1, 0.07 * z + 8.4) - 0.5) * 1.6 * smoothstep(2, 6, Math.hypot(x, 1.5 * z)) +
    0.035 * Math.sin(0.35 * x + 2.4 * z + 3 * fbm(0.25 * x, 0.25 * z));
  const near = Math.max(1, (camY - (baseY - 0.8)) / tanHalf);
  const far = camZ + 45;
  let n = 0;
  for (let tries = 0; tries < count * 3 && n < count; tries++) {
    const dist = Math.sqrt(near * near + Math.random() * (far * far - near * near));
    const x = dist * tanHalf * aspect * 1.05 * (2 * Math.random() - 1);
    const z = camZ - dist;
    const y = height(x, z);
    const dx = (height(x + 0.05, z) - height(x - 0.05, z)) / 0.1;
    const dz = (height(x, z + 0.05) - height(x, z - 0.05)) / 0.1;
    const m = Math.hypot(dx, 1, dz);
    const lit = 0.12 + 0.88 * Math.pow(Math.max(0, (-dx * LIGHT[0] + LIGHT[1] - dz * LIGHT[2]) / m), 1.6);
    if (Math.random() > 0.25 + 0.75 * lit) continue;
    const b = lit * (1 - smoothstep(0.35 * far, far, dist)) * (0.55 + 0.45 * Math.random());
    pos[3 * n] = x;
    pos[3 * n + 1] = y;
    pos[3 * n + 2] = z;
    col[3 * n] = col[3 * n + 1] = col[3 * n + 2] = b;
    n++;
  }
  return { positions: pos.subarray(0, 3 * n), colors: col.subarray(0, 3 * n) };
}

export function DustField({ dim = false, stir = false }: { dim?: boolean; stir?: boolean }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const target = useRef({ dim, stir });
  target.current = { dim, stir };

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    } catch {
      return; // No WebGL: the page stays plain black.
    }
    renderer.setClearColor("#000000");
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.domElement.style.display = "block";
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";
    host.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
    const material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: {
        uTime: { value: 0 },
        uSize: { value: 0.014 },
        uScale: { value: 1 },
        uBrightness: { value: 0 },
        uMotion: { value: 2.5 },
      },
      transparent: true,
      depthWrite: false,
    });

    let points: THREE.Points | null = null;
    let built: View | null = null;
    let rebuild = 0;

    const build = (view: View) => {
      if (built && Math.abs(built.aspect - view.aspect) < 0.05 && Math.abs(built.camZ - view.camZ) < 0.5) return;
      built = view;
      const w = host.clientWidth, h = host.clientHeight;
      const count = Math.round(Math.min(300_000, Math.max(60_000, w * h * 0.18)));
      const { positions, colors } = buildGround(view, count);
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
      geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
      if (points) {
        scene.remove(points);
        points.geometry.dispose();
      }
      points = new THREE.Points(geo, material);
      scene.add(points);
    };

    const resize = () => {
      const w = Math.max(1, host.clientWidth), h = Math.max(1, host.clientHeight);
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      const span = 10 / Math.min(0.5, 0.95 * camera.aspect);
      const tanHalf = Math.tan((25 * Math.PI) / 180);
      const camZ = span / 2 / tanHalf;
      const camY = (0.42 - 0.5) * span;
      camera.position.set(0, camY, camZ);
      camera.lookAt(0, camY, 0);
      camera.updateProjectionMatrix();
      material.uniforms.uScale.value = (h * renderer.getPixelRatio()) / 2;
      const view = { camY, camZ, tanHalf, aspect: camera.aspect, baseY: (0.5 - 0.94) * 10 };
      clearTimeout(rebuild);
      if (!built) build(view);
      else rebuild = window.setTimeout(() => build(view), 250);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(host);

    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const clock = new THREE.Clock();
    let shown = 0;
    renderer.setAnimationLoop(() => {
      const dt = Math.min(clock.getDelta(), 0.1);
      const u = material.uniforms;
      const { dim, stir } = target.current;
      // Ease toward the wanted state so dimming and stirring never jump.
      const k = 1 - Math.exp(-dt * 2.2);
      shown = Math.min(1, shown + dt / 1.6);
      const bright = (dim ? 0.16 : 0.55) * smoothstep(0, 1, shown);
      u.uBrightness.value += (bright - u.uBrightness.value) * (shown < 1 ? 1 : k);
      u.uMotion.value += ((stir ? 5 : 2.5) - u.uMotion.value) * k;
      // Advance the sway by its own clock so speeding up never jumps the phase.
      if (!still) u.uTime.value += dt * (0.6 + 0.4 * u.uMotion.value);
      renderer.render(scene, camera);
    });

    return () => {
      clearTimeout(rebuild);
      ro.disconnect();
      renderer.setAnimationLoop(null);
      points?.geometry.dispose();
      material.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, []);

  return <div ref={hostRef} aria-hidden="true" className="site-dust pointer-events-none fixed inset-0 -z-10 bg-black" />;
}
