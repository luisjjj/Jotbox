import { useEffect, useRef } from "react";
import * as THREE from "three";
import { useCurrentFrame, useVideoConfig } from "remotion";

type State = {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  points: THREE.Points;
  pointGeometry: THREE.BufferGeometry;
  pointMaterial: THREE.PointsMaterial;
  texture: THREE.CanvasTexture;
  grid: THREE.LineSegments;
  gridGeometry: THREE.BufferGeometry;
  gridMaterial: THREE.LineBasicMaterial;
  width: number;
  height: number;
};

function seeded(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function dotTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 64;
  const texture = new THREE.CanvasTexture(canvas);
  const context = canvas.getContext("2d");
  if (context) {
    const gradient = context.createRadialGradient(32, 32, 0, 32, 32, 32);
    gradient.addColorStop(0, "rgba(255,255,255,1)");
    gradient.addColorStop(0.35, "rgba(255,255,255,0.85)");
    gradient.addColorStop(1, "rgba(255,255,255,0)");
    context.fillStyle = gradient;
    context.fillRect(0, 0, 64, 64);
  }
  texture.needsUpdate = true;
  return texture;
}

export function ParticleField({
  tone = "dark",
  density = 1,
  showGrid = true,
  speed = 1,
}: {
  tone?: "dark" | "light";
  density?: number;
  showGrid?: boolean;
  speed?: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef<State | null>(null);
  const frame = useCurrentFrame();
  const { width, height, fps } = useVideoConfig();

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
    renderer.setPixelRatio(1);
    renderer.setSize(width, height, false);
    renderer.setClearColor(0x000000, 0);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(58, width / height, 0.1, 120);
    camera.position.set(0, 0, 10);

    const random = seeded(tone === "dark" ? 20261117 : 7117);
    const count = Math.round((tone === "dark" ? 1150 : 780) * density);
    const positions = new Float32Array(count * 3);
    for (let index = 0; index < count; index += 1) {
      positions[index * 3] = (random() * 2 - 1) * 12;
      positions[index * 3 + 1] = (random() * 2 - 1) * 7;
      positions[index * 3 + 2] = (random() * 2 - 1) * 6 - 2;
    }
    const pointGeometry = new THREE.BufferGeometry();
    pointGeometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const texture = dotTexture();
    const pointMaterial = new THREE.PointsMaterial({
      color: tone === "dark" ? 0xdcead9 : 0x1f5c46,
      size: tone === "dark" ? 0.055 : 0.04,
      map: texture,
      transparent: true,
      opacity: tone === "dark" ? 0.75 : 0.4,
      depthWrite: false,
      sizeAttenuation: true,
      blending: tone === "dark" ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    const points = new THREE.Points(pointGeometry, pointMaterial);
    scene.add(points);

    const lineCount = 24;
    const segments = 52;
    const gridPositions = new Float32Array(lineCount * segments * 2 * 3);
    let cursor = 0;
    for (let line = 0; line < lineCount; line += 1) {
      const z = -5 + (line / (lineCount - 1)) * 10;
      for (let segment = 0; segment < segments; segment += 1) {
        const x1 = -13 + (segment / segments) * 26;
        const x2 = -13 + ((segment + 1) / segments) * 26;
        gridPositions[cursor++] = x1;
        gridPositions[cursor++] = 0;
        gridPositions[cursor++] = z;
        gridPositions[cursor++] = x2;
        gridPositions[cursor++] = 0;
        gridPositions[cursor++] = z;
      }
    }
    const gridGeometry = new THREE.BufferGeometry();
    gridGeometry.setAttribute("position", new THREE.BufferAttribute(gridPositions, 3));
    const gridMaterial = new THREE.LineBasicMaterial({
      color: tone === "dark" ? 0x9dcab4 : 0x1f5c46,
      transparent: true,
      opacity: tone === "dark" ? 0.16 : 0.1,
    });
    const grid = new THREE.LineSegments(gridGeometry, gridMaterial);
    grid.position.set(0, -1.2, -3);
    grid.rotation.x = -0.05;
    scene.add(grid);

    stateRef.current = {
      renderer,
      scene,
      camera,
      points,
      pointGeometry,
      pointMaterial,
      texture,
      grid,
      gridGeometry,
      gridMaterial,
      width,
      height,
    };

    return () => {
      pointGeometry.dispose();
      pointMaterial.dispose();
      texture.dispose();
      gridGeometry.dispose();
      gridMaterial.dispose();
      renderer.dispose();
      stateRef.current = null;
    };
  }, [width, height, tone, density, showGrid]);

  useEffect(() => {
    const state = stateRef.current;
    if (!state) return;
    const time = (frame / fps) * speed;

    state.points.rotation.y = time * 0.035;
    state.points.rotation.z = Math.sin(time * 0.08) * 0.025;
    state.points.position.y = Math.sin(time * 0.14) * 0.18;

    if (showGrid) {
      const attribute = state.gridGeometry.getAttribute("position") as THREE.BufferAttribute;
      const array = attribute.array as Float32Array;
      for (let index = 0; index < array.length; index += 3) {
        const x = array[index];
        const z = array[index + 2];
        array[index + 1] =
          Math.sin(x * 0.42 + time * 0.55) * 0.22 +
          Math.cos(z * 0.38 + time * 0.4) * 0.14;
      }
      attribute.needsUpdate = true;
      state.grid.rotation.z = Math.sin(time * 0.05) * 0.015;
    }

    state.renderer.render(state.scene, state.camera);
  }, [frame, fps, showGrid, speed]);

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        pointerEvents: "none",
      }}
    />
  );
}
