import * as THREE from 'three/webgpu';
import * as t3 from '@typegpu/three';
import { d } from 'typegpu';
import { abs, clamp, dot, floor, fract, mix, sin, smoothstep } from 'typegpu/std';

const createCitadelToonGradient = (): THREE.DataTexture => {
  // MeshToonNodeMaterial samples only the red channel of gradientMap. Keep the
  // ramp scalar and let the albedo carry the indigo/lavender colour.
  const bands = new Uint8Array([0, 58, 142, 232]);
  const texture = new THREE.DataTexture(
    bands,
    4,
    1,
    THREE.RedFormat,
    THREE.UnsignedByteType,
  );
  texture.colorSpace = THREE.NoColorSpace;
  texture.minFilter = THREE.NearestFilter;
  texture.magFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.needsUpdate = true;
  return texture;
};

const citadelToonGradient = createCitadelToonGradient();

const createCitadelToonMaterial = (): THREE.MeshToonNodeMaterial => {
  const material = new THREE.MeshToonNodeMaterial();
  material.gradientMap = citadelToonGradient;
  return material;
};

export const createArchitecturalToonMaterial = (
  color: THREE.ColorRepresentation,
  emissive: THREE.ColorRepresentation = 0x000000,
  emissiveIntensity = 0,
): THREE.MeshToonNodeMaterial => {
  const material = createCitadelToonMaterial();
  material.color.set(color);
  material.emissive.set(emissive);
  material.emissiveIntensity = emissiveIntensity;
  return material;
};

export interface TypeGpuGlowMaterial {
  material: THREE.MeshBasicNodeMaterial;
  setAlpha: (value: number) => void;
  setColor: (value: THREE.ColorRepresentation) => void;
}

export interface TypeGpuCitadelMaterialOptions {
  base: THREE.ColorRepresentation;
  face: THREE.ColorRepresentation;
  line: THREE.ColorRepresentation;
  ridge: THREE.ColorRepresentation;
  crystal: THREE.ColorRepresentation;
  panelFrequency?: number;
  courseFrequency?: number;
  bayFrequency?: number;
  ridgeStrength?: number;
  crystalStrength?: number;
  ambientStrength?: number;
}

export const createTypeGpuRoofMaterial = (): THREE.MeshToonNodeMaterial => {
  const base = t3.uniform(new THREE.Color(0x4c4f78), d.vec3f);
  const ridge = t3.uniform(new THREE.Color(0xaeb4d6), d.vec3f);
  const material = createCitadelToonMaterial();
  material.colorNode = t3.toTSL(() => {
    'use gpu';
    const position = t3.positionWorld.$;
    const tile = fract(d.vec2f(position.x * 0.035, position.z * 0.035));
    const seamX = 1 - smoothstep(0.02, 0.06, abs(tile.x - 0.5));
    const seamY = 1 - smoothstep(0.02, 0.06, abs(tile.y - 0.5));
    const seam = clamp(seamX + seamY, 0, 1);
    return d.vec4f(mix(base.$, ridge.$, seam * 0.24), 1);
  }) as unknown as NonNullable<typeof material.colorNode>;
  return material;
};

export const createTypeGpuPlazaMaterial = (): THREE.MeshToonNodeMaterial => {
  const stone = t3.uniform(new THREE.Color(0x72769e), d.vec3f);
  const jointColor = t3.uniform(new THREE.Color(0x1c1b30), d.vec3f);
  const material = createCitadelToonMaterial();
  material.colorNode = t3.toTSL(() => {
    'use gpu';
    const position = t3.positionWorld.$;
    const course = floor(position.z * 0.052);
    const stagger = fract(course * 0.5) * 0.5;
    const tile = fract(d.vec2f(position.x * 0.038 + stagger, position.z * 0.052));
    const tileJointX = 1 - smoothstep(0.006, 0.02, abs(tile.x - 0.5));
    const tileJointY = 1 - smoothstep(0.006, 0.022, abs(tile.y - 0.5));
    const tileJoint = clamp(tileJointX + tileJointY, 0, 1);
    return d.vec4f(mix(stone.$, jointColor.$, tileJoint), 1);
  }) as unknown as NonNullable<typeof material.colorNode>;
  return material;
};

export const createTypeGpuVoidMistMaterial = (
  color: THREE.ColorRepresentation,
  opacity: number,
): THREE.MeshBasicNodeMaterial => {
  const tint = t3.uniform(new THREE.Color(color), d.vec3f);
  const alpha = t3.uniform(opacity, d.f32);
  const material = new THREE.MeshBasicNodeMaterial();
  material.transparent = true;
  material.depthWrite = false;
  material.side = THREE.DoubleSide;
  material.blending = THREE.AdditiveBlending;
  material.colorNode = t3.toTSL(() => {
    'use gpu';
    const position = t3.positionWorld.$;
    const time = t3.time.$;
    const broadWave = sin(position.x * 0.012 + time * 0.035)
      + sin(position.z * 0.016 - time * 0.027)
      + sin((position.x + position.z) * 0.0065 + time * 0.018);
    const fineWave = sin(position.x * 0.037 - position.z * 0.029 + time * 0.052);
    const density = smoothstep(0.12, 1.74, broadWave + fineWave * 0.34);
    const breath = 0.82 + sin(time * 0.17 + position.z * 0.004) * 0.18;
    return d.vec4f(tint.$.mul(0.34 + density * 0.66), density * breath * alpha.$);
  }) as unknown as NonNullable<typeof material.colorNode>;
  return material;
};

export const createTypeGpuHullMaterial = (): THREE.MeshToonNodeMaterial => {
  const base = t3.uniform(new THREE.Color(0x28243c), d.vec3f);
  const facet = t3.uniform(new THREE.Color(0x6a6f9e), d.vec3f);
  const seamColor = t3.uniform(new THREE.Color(0x8a6fd8), d.vec3f);
  const material = createCitadelToonMaterial();
  material.colorNode = t3.toTSL(() => {
    'use gpu';
    const position = t3.positionWorld.$;
    const normal = t3.normalWorld.$;
    const panel = fract(d.vec2f(
      (position.x + position.z) * 0.026,
      position.y * 0.061,
    ));
    const verticalSeam = 1 - smoothstep(0.025, 0.085, abs(panel.x - 0.5));
    const floorSeam = 1 - smoothstep(0.025, 0.075, abs(panel.y - 0.5));
    const seam = clamp(verticalSeam * 0.7 + floorSeam * 0.36, 0, 1);
    const topFace = smoothstep(0.5, 0.88, normal.y);
    const body = mix(base.$, facet.$, 0.12 + topFace * 0.16);
    return d.vec4f(mix(body, seamColor.$, seam * 0.12), 1);
  }) as unknown as NonNullable<typeof material.colorNode>;
  return material;
};

/**
 * A world-space monumental-stone pattern. Geometry supplies the silhouette;
 * this shader breaks the mass into large courses, long recessed bays,
 * structural ribs and irregular violet growth around ledges. There are
 * deliberately no emissive window cells: Wahr Welt must read as one damaged,
 * overgrown fortress rather than a collection of inhabited office blocks.
 */
export const createTypeGpuCitadelMaterial = (
  options: TypeGpuCitadelMaterialOptions,
): THREE.MeshToonNodeMaterial => {
  const base = t3.uniform(new THREE.Color(options.base), d.vec3f);
  const face = t3.uniform(new THREE.Color(options.face), d.vec3f);
  const line = t3.uniform(new THREE.Color(options.line), d.vec3f);
  const ridge = t3.uniform(new THREE.Color(options.ridge), d.vec3f);
  const crystal = t3.uniform(new THREE.Color(options.crystal), d.vec3f);
  const panelFrequency = options.panelFrequency ?? 0.052;
  const courseFrequency = options.courseFrequency ?? 0.074;
  const bayFrequency = options.bayFrequency ?? 0.18;
  const ridgeStrength = options.ridgeStrength ?? 0.12;
  const crystalStrength = options.crystalStrength ?? 0.48;
  const ambientStrength = options.ambientStrength ?? 0.16;

  const material = createCitadelToonMaterial();
  // The stone itself never emits light. Bloom is reserved for the separate
  // growth/energy meshes; an emissive wall is what made the city glow like
  // lacquer under the dark toon bands.
  material.emissive.set(0x000000);
  material.emissiveIntensity = 0;

  material.colorNode = t3.toTSL(() => {
    'use gpu';
    const position = t3.positionWorld.$;
    const normal = t3.normalWorld.$;
    const sideCoordinate = position.x * abs(normal.z) + position.z * abs(normal.x);
    const verticalFace = 1 - smoothstep(0.42, 0.76, abs(normal.y));

    // Large offset stone courses. The two axes are never multiplied into a
    // filled rectangle, so the result cannot resolve into rows of windows.
    const panel = fract(d.vec2f(
      sideCoordinate * panelFrequency + position.y * 0.004,
      position.y * courseFrequency + sideCoordinate * 0.0025,
    ));
    const verticalJoint = 1 - smoothstep(0.01, 0.036, abs(panel.x - 0.5));
    const courseJoint = 1 - smoothstep(0.009, 0.032, abs(panel.y - 0.5));
    const joint = clamp(verticalJoint * 0.22 + courseJoint * 0.52, 0, 1) * verticalFace;

    // Tall recessed bays match Wahr Welt's fortress colonnades. They run
    // continuously through a facade and therefore cannot read as window rows.
    const bayCell = fract(sideCoordinate * bayFrequency);
    const bay = (1 - smoothstep(0.12, 0.2, abs(bayCell - 0.5))) * verticalFace;

    // Widely spaced full-height ribs establish fortress scale. They stay
    // continuous through every storey instead of blinking on and off per cell.
    const ribCell = fract(sideCoordinate * panelFrequency * 0.56);
    const rib = (1 - smoothstep(0.035, 0.105, abs(ribCell - 0.5))) * verticalFace;

    // Pure albedo split: horizontal slabs read as pale worn stone, walls keep
    // the base tone. Shading now comes from the real scene lights and the
    // shadow map — an analytic key here double-lit every facade and fought
    // the toon gradient into lacquered stripes.
    const topFace = smoothstep(0.42, 0.86, abs(normal.y));
    const baseShade = mix(base.$, face.$, topFace * 0.55);
    const recessed = mix(baseShade, line.$, clamp(joint * 0.55 + bay * 0.32, 0, 1));
    const structured = mix(recessed, ridge.$, rib * ridgeStrength);

    // Hand-painted cel variation, deliberately subtle: anime backgrounds never
    // repeat the exact same fill on neighbouring masses, but a strong tint
    // reads as noise once real lighting is doing the value work.
    // Pure arithmetic — no nested select() — so the WebGL fallback compiles.
    const blockCell = floor(d.vec2f(position.x * 0.031, position.z * 0.031));
    const blockHash = fract(sin(dot(blockCell, d.vec2f(127.1, 311.7))) * 43758.5453);
    const blockTint = 1 + (blockHash - 0.5) * 0.04;
    const heightTint = mix(0.97, 1.03, smoothstep(58, 168, position.y));
    const albedo = structured.mul(blockTint * heightTint);
    return d.vec4f(albedo, 1);
  }) as unknown as NonNullable<typeof material.colorNode>;

  return material;
};

export const createTypeGpuGlowMaterial = (
  color: THREE.ColorRepresentation,
  initialAlpha = 1,
): TypeGpuGlowMaterial => {
  const tint = t3.uniform(new THREE.Color(color), d.vec3f);
  const alpha = t3.uniform(initialAlpha, d.f32);
  const material = new THREE.MeshBasicNodeMaterial();

  material.transparent = initialAlpha < 1;
  material.depthWrite = false;
  material.side = THREE.DoubleSide;
  material.blending = THREE.AdditiveBlending;
  material.colorNode = t3.toTSL(() => {
    'use gpu';
    return d.vec4f(tint.$, alpha.$);
  }) as unknown as NonNullable<typeof material.colorNode>;

  return {
    material,
    setAlpha(value: number) {
      alpha.node.value = value;
      material.transparent = value < 0.999;
    },
    setColor(value: THREE.ColorRepresentation) {
      tint.node.value.set(value);
    },
  };
};
