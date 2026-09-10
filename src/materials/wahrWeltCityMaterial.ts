import * as THREE from 'three/webgpu';
import {
  attribute,
  float as tslFloat,
  floor as tslFloor,
  fract as tslFract,
  normalView,
  normalWorldGeometry,
  positionView,
  positionWorld as tslPositionWorld,
  sin as tslSin,
  smoothstep as tslSmoothstep,
} from 'three/tsl';
import * as t3 from '@typegpu/three';
import { d } from 'typegpu';
import { abs, clamp, dot, floor, fract, mix, sin, smoothstep } from 'typegpu/std';

export interface WahrWeltStoneOptions {
  base: THREE.ColorRepresentation;
  top: THREE.ColorRepresentation;
  joint: THREE.ColorRepresentation;
  ageTint?: THREE.ColorRepresentation;
  courseWidth?: number;
  courseHeight?: number;
  originY?: number;
  seed?: number;
  reliefDepth?: number;
  grainStrength?: number;
  ageStrength?: number;
}

export interface WahrWeltFloorOptions {
  base: THREE.ColorRepresentation;
  joint: THREE.ColorRepresentation;
  ageTint?: THREE.ColorRepresentation;
  slabWidth?: number;
  slabDepth?: number;
  seed?: number;
  ageStrength?: number;
}

export interface WahrWeltRoadOptions {
  base: THREE.ColorRepresentation;
  pale: THREE.ColorRepresentation;
  joint: THREE.ColorRepresentation;
  violet: THREE.ColorRepresentation;
  slabWidth?: number;
  slabDepth?: number;
  seed?: number;
}

export interface WahrWeltGrowthOptions {
  base?: THREE.ColorRepresentation;
  facet?: THREE.ColorRepresentation;
  emissive?: THREE.ColorRepresentation;
  emissiveIntensity?: number;
  opacity?: number;
}

const createAnimeGradient = (): THREE.DataTexture => {
  // Three r185 samples gradientMap.r only. Colour belongs to the albedo; this
  // texture controls four deliberately hard anime light levels.
  const bands = new Uint8Array([46, 92, 178, 244]);
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

const animeGradient = createAnimeGradient();

const createFloorGradient = (): THREE.DataTexture => {
  // Streets spend most of the sequence inside cast shadow. A raised first band
  // keeps paving readable there while the remaining steps preserve the hard
  // anime light break.
  const bands = new Uint8Array([72, 108, 172, 240]);
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

const floorGradient = createFloorGradient();

const createBaseToonMaterial = (): THREE.MeshToonNodeMaterial => {
  const material = new THREE.MeshToonNodeMaterial();
  material.gradientMap = animeGradient;
  material.emissive.set(0x000000);
  material.emissiveIntensity = 0;
  return material;
};

// A derivative-based world-space bump. A shared UV normal map would stretch
// one brick pattern across differently sized instanced boxes; this surface-
// gradient form keeps every course at one physical scale and costs no extra
// geometry or per-building texture allocation.
const createStoneReliefNormal = (
  courseWidth: number,
  courseHeight: number,
  originY: number,
  seed: number,
  reliefDepth: number,
  grainStrength: number,
) => {
  const stoneY = tslPositionWorld.y.sub(originY);
  const verticalFace = tslFloat(1).sub(
    tslSmoothstep(0.3, 0.72, normalWorldGeometry.y.abs()),
  );
  const alongFacade = tslPositionWorld.x.mul(normalWorldGeometry.z)
    .sub(tslPositionWorld.z.mul(normalWorldGeometry.x));
  const course = tslFloor(stoneY.div(courseHeight).add(seed * 0.043));
  const stagger = tslFract(course.mul(0.5));
  const blockX = tslFract(
    alongFacade.div(courseWidth).add(stagger).add(seed * 0.071),
  );
  const blockY = tslFract(stoneY.div(courseHeight).add(seed * 0.043));
  const horizontalJoint = tslSmoothstep(0.43, 0.495, blockY.sub(0.5).abs());
  const verticalJoint = tslSmoothstep(0.46, 0.499, blockX.sub(0.5).abs());
  const mortar = horizontalJoint.mul(0.72).add(verticalJoint.mul(0.9)).clamp(0, 1);

  // Three broad waves and one finer pass make the face catch light like worn
  // blocks without turning it into noisy rock or a mottled painted texture.
  const grain = tslSin(alongFacade.mul(1.7).add(stoneY.mul(1.15)).add(seed))
    .add(tslSin(alongFacade.mul(3.1).sub(stoneY.mul(2.2)).add(seed * 1.7)))
    .add(tslSin(alongFacade.add(stoneY).mul(5.3).sub(seed * 0.8)).mul(0.55))
    .mul(grainStrength);
  const height = tslFloat(1).sub(mortar).mul(reliefDepth).add(grain).mul(verticalFace);

  const dpdx = positionView.dFdx();
  const dpdy = positionView.dFdy();
  const r1 = dpdy.cross(normalView);
  const r2 = normalView.cross(dpdx);
  const determinant = dpdx.dot(r1);
  const gradient = determinant.sign().mul(
    height.dFdx().mul(r1).add(height.dFdy().mul(r2)),
  );
  return determinant.abs().mul(normalView).sub(gradient).normalize();
};

const createGrowthReliefNormal = () => {
  const topFacet = tslSmoothstep(0.08, 0.88, normalWorldGeometry.y.abs());
  const facadeHorizontal = tslPositionWorld.x.mul(normalWorldGeometry.z)
    .sub(tslPositionWorld.z.mul(normalWorldGeometry.x));
  const roofHorizontal = tslPositionWorld.x.mul(0.82).add(tslPositionWorld.z.mul(0.36));
  const roofVertical = tslPositionWorld.x.mul(0.31).sub(tslPositionWorld.z.mul(0.74));
  const projectedHorizontal = facadeHorizontal.mul(tslFloat(1).sub(topFacet))
    .add(roofHorizontal.mul(topFacet));
  const projectedVertical = tslPositionWorld.y.mul(tslFloat(1).sub(topFacet))
    .add(roofVertical.mul(topFacet));
  const crystalU = projectedHorizontal.mul(0.26).add(projectedVertical.mul(0.06));
  const crystalV = projectedVertical.mul(0.34).sub(projectedHorizontal.mul(0.04));
  const ridgeA = tslFloat(1).sub(tslSmoothstep(
    0.08,
    0.42,
    tslSin(crystalU.mul(0.92).add(crystalV.mul(0.38))).abs(),
  ));
  const ridgeB = tslFloat(1).sub(tslSmoothstep(
    0.1,
    0.48,
    tslSin(crystalU.mul(0.5).sub(crystalV.mul(1.08)).add(1.7)).abs(),
  ));
  const ridgeC = tslFloat(1).sub(tslSmoothstep(
    0.06,
    0.3,
    tslSin(crystalU.mul(1.42).add(crystalV.mul(0.18)).sub(0.8)).abs(),
  ));
  const height = ridgeA.mul(0.22).add(ridgeB.mul(0.16)).add(ridgeC.mul(0.1));
  const dpdx = positionView.dFdx();
  const dpdy = positionView.dFdy();
  const r1 = dpdy.cross(normalView);
  const r2 = normalView.cross(dpdx);
  const determinant = dpdx.dot(r1);
  const gradient = determinant.sign().mul(
    height.dFdx().mul(r1).add(height.dFdy().mul(r2)),
  );
  return determinant.abs().mul(normalView).sub(gradient).normalize();
};

/**
 * Matte Wahr Welt masonry. Its only procedural components are staggered stone
 * courses, a restrained per-block value shift and a lighter upward albedo.
 * All value modelling comes from Three's real lights and shadow maps.
 */
export const createWahrWeltStoneMaterial = (
  options: WahrWeltStoneOptions,
): THREE.MeshToonNodeMaterial => {
  const base = t3.uniform(new THREE.Color(options.base), d.vec3f);
  const top = t3.uniform(new THREE.Color(options.top), d.vec3f);
  const joint = t3.uniform(new THREE.Color(options.joint), d.vec3f);
  const ageTint = t3.uniform(new THREE.Color(options.ageTint ?? 0xa79572), d.vec3f);
  const courseWidth = options.courseWidth ?? 14;
  const courseHeight = options.courseHeight ?? 5.5;
  const originY = options.originY ?? 72;
  const seed = options.seed ?? 0;
  const reliefDepth = options.reliefDepth ?? 0.055;
  const grainStrength = options.grainStrength ?? 0.006;
  const ageStrength = options.ageStrength ?? 0.035;
  const material = createBaseToonMaterial();

  material.colorNode = t3.toTSL(() => {
    'use gpu';
    const position = t3.positionWorld.$;
    const normal = t3.normalWorldGeometry.$;
    const stoneY = position.y - originY;
    const verticalFace = 1 - smoothstep(0.35, 0.72, abs(normal.y));
    // Tangent coordinate stays continuous on either X- or Z-facing facades.
    const alongFacade = position.x * normal.z - position.z * normal.x;

    const course = floor(stoneY / courseHeight + seed * 0.043);
    const stagger = fract(course * 0.5);
    const block = fract(d.vec2f(
      alongFacade / courseWidth + stagger + seed * 0.071,
      stoneY / courseHeight + seed * 0.043,
    ));
    const horizontalJoint = smoothstep(0.455, 0.495, abs(block.y - 0.5));
    const verticalJoint = smoothstep(0.487, 0.499, abs(block.x - 0.5));
    const mortar = clamp(
      horizontalJoint * 0.66 + verticalJoint * 0.9,
      0,
      1,
    ) * verticalFace;

    // A stable cell hash changes each large stone by only plus/minus 1.5%.
    const column = floor(alongFacade / courseWidth + stagger + seed * 0.071);
    const cellHash = fract(
      sin(dot(d.vec2f(column, course), d.vec2f(127.1, 311.7)) + seed * 19.19)
      * 43758.5453,
    );
    const cellValue = 0.985 + cellHash * 0.03;

    const topMask = smoothstep(0.58, 0.9, normal.y);
    const stone = mix(base.$, top.$, topMask).mul(cellValue);

    // A restrained ochre patina warms exposed and lower stones without
    // repainting whole facades. Reuse the cell hash already required by the
    // block variation; extra per-pixel noise waves previously exceeded the
    // dense city's fragment budget.
    const exposedPatch = smoothstep(0.68, 0.96, cellHash) * verticalFace;
    const lowerAge = (1 - smoothstep(0, courseHeight * 5.5, stoneY)) * verticalFace;
    const age = clamp(exposedPatch * 0.52 + lowerAge * 0.72, 0, 1) * ageStrength;
    const weatheredStone = mix(stone, ageTint.$, age).mul(1 - age * 0.18);

    // Joints must read as engraved seams, not as a black brick cage.
    const structured = mix(weatheredStone, joint.$, mortar * 0.54);
    return d.vec4f(structured, 1);
  }) as unknown as NonNullable<typeof material.colorNode>;
  material.normalNode = createStoneReliefNormal(
    courseWidth,
    courseHeight,
    originY,
    seed,
    reliefDepth,
    grainStrength,
  );

  return material;
};

export const createWahrWeltFlatMaterial = (
  color: THREE.ColorRepresentation,
): THREE.MeshToonNodeMaterial => {
  const material = createBaseToonMaterial();
  material.color.set(color);
  return material;
};

/**
 * Large staggered paving slabs for roads, walks and the city deck. The former
 * flat near-black material erased the ground plane under toon lighting; this
 * keeps the surface matte while making scale and perspective legible.
 */
export const createWahrWeltFloorMaterial = (
  options: WahrWeltFloorOptions,
): THREE.MeshToonNodeMaterial => {
  const base = t3.uniform(new THREE.Color(options.base), d.vec3f);
  const joint = t3.uniform(new THREE.Color(options.joint), d.vec3f);
  const ageTint = t3.uniform(new THREE.Color(options.ageTint ?? 0xb5a77f), d.vec3f);
  const slabWidth = options.slabWidth ?? 16;
  const slabDepth = options.slabDepth ?? 22;
  const seed = options.seed ?? 0;
  const ageStrength = options.ageStrength ?? 0.1;
  const material = createBaseToonMaterial();
  material.gradientMap = floorGradient;

  material.colorNode = t3.toTSL(() => {
    'use gpu';
    const position = t3.positionWorld.$;
    const row = floor(position.z / slabDepth + seed * 0.071);
    const stagger = fract(row * 0.5);
    const slab = fract(d.vec2f(
      position.x / slabWidth + stagger + seed * 0.113,
      position.z / slabDepth + seed * 0.071,
    ));
    const crossJoint = smoothstep(0.472, 0.497, abs(slab.x - 0.5));
    const longJoint = smoothstep(0.477, 0.498, abs(slab.y - 0.5));
    const jointMask = clamp(crossJoint + longJoint, 0, 1);

    const column = floor(position.x / slabWidth + stagger + seed * 0.113);
    const cellHash = fract(
      sin(dot(d.vec2f(column, row), d.vec2f(91.7, 173.3)) + seed * 31.1)
      * 43758.5453,
    );
    const slabValue = 0.97 + cellHash * 0.06;
    const warmWear = smoothstep(0.58, 0.96, cellHash) * ageStrength;
    const agedSlab = mix(base.$.mul(slabValue), ageTint.$, warmWear);
    const paving = mix(agedSlab, joint.$, jointMask * 0.72);
    return d.vec4f(paving, 1);
  }) as unknown as NonNullable<typeof material.colorNode>;

  return material;
};

/**
 * Wahr Welt street paving from the episode reference: broad cold stone slabs,
 * softened joints and irregular lavender mineral staining. The pattern stays
 * matte and non-emissive; real scene lights provide the hard anime value split.
 */
export const createWahrWeltRoadMaterial = (
  options: WahrWeltRoadOptions,
): THREE.MeshToonNodeMaterial => {
  const base = t3.uniform(new THREE.Color(options.base), d.vec3f);
  const pale = t3.uniform(new THREE.Color(options.pale), d.vec3f);
  const joint = t3.uniform(new THREE.Color(options.joint), d.vec3f);
  const violet = t3.uniform(new THREE.Color(options.violet), d.vec3f);
  const slabWidth = options.slabWidth ?? 14;
  const slabDepth = options.slabDepth ?? 22;
  const seed = options.seed ?? 0;
  const material = createBaseToonMaterial();
  material.gradientMap = floorGradient;

  material.colorNode = t3.toTSL(() => {
    'use gpu';
    const position = t3.positionWorld.$;

    // Large staggered courses: the reference road reads as monumental stone,
    // never as small brickwork or a modern asphalt strip.
    const row = floor(position.z / slabDepth + seed * 0.071);
    const stagger = fract(row * 0.5);
    const slab = fract(d.vec2f(
      position.x / slabWidth + stagger + seed * 0.113,
      position.z / slabDepth + seed * 0.071,
    ));
    const crossJoint = smoothstep(0.478, 0.498, abs(slab.x - 0.5));
    const longJoint = smoothstep(0.482, 0.499, abs(slab.y - 0.5));
    const jointMask = clamp(crossJoint * 0.72 + longJoint, 0, 1);

    const column = floor(position.x / slabWidth + stagger + seed * 0.113);
    const slabHash = fract(
      sin(dot(d.vec2f(column, row), d.vec2f(91.7, 173.3)) + seed * 31.1)
      * 43758.5453,
    );
    const slabValue = 0.955 + slabHash * 0.09;

    // Broad overlapping waves create the hand-painted cloudy mineral crust
    // visible across the pale road. A sparse cell hash breaks the waves into
    // irregular lavender flecks instead of obvious procedural stripes.
    const mineralWave = sin(position.x * 0.12 + position.z * 0.035 + seed)
      + sin(position.x * 0.047 - position.z * 0.11 + seed * 1.7)
      + sin((position.x + position.z) * 0.063 - seed * 0.63);
    const frost = smoothstep(-0.05, 1.48, mineralWave);
    const fleckCell = floor(d.vec2f(position.x * 0.18, position.z * 0.18));
    const fleckHash = fract(
      sin(dot(fleckCell, d.vec2f(127.1, 311.7)) + seed * 19.19)
      * 43758.5453,
    );
    const fleck = smoothstep(0.52, 0.9, fleckHash) * (0.38 + frost * 0.62);

    const stone = mix(base.$.mul(slabValue), pale.$, 0.1 + frost * 0.42);
    const mineralStone = mix(stone, violet.$, frost * 0.16 + fleck * 0.34);
    // The seams are worn violet-grey engravings, not a black checkerboard.
    const seamWear = 0.38 + slabHash * 0.62;
    const paving = mix(mineralStone, joint.$, jointMask * seamWear * 0.34);
    return d.vec4f(paving, 1);
  }) as unknown as NonNullable<typeof material.colorNode>;

  return material;
};

export const createWahrWeltGrowthMaterial = (
  options: WahrWeltGrowthOptions = {},
): THREE.MeshStandardNodeMaterial => {
  // Keep the infection outside ToonOutlinePass. When it shared the city's
  // toon material type, the inverted-hull outline was opaque and turned every
  // translucent wall colony into a black/purple sheet. A low-roughness node
  // material preserves the authored procedural colour while adding the wet,
  // mineral glint the surface needs.
  const material = new THREE.MeshStandardNodeMaterial();
  material.roughness = 0.18;
  material.metalness = 0.02;
  material.flatShading = true;
  const violet = t3.uniform(new THREE.Color(options.base ?? 0x9c88b5), d.vec3f);
  const paleFacet = t3.uniform(new THREE.Color(options.facet ?? 0xdccfea), d.vec3f);
  const frostWhite = t3.uniform(new THREE.Color(0xf1edf4), d.vec3f);
  const seamWhite = t3.uniform(new THREE.Color(0xfffbff), d.vec3f);
  material.colorNode = t3.toTSL(() => {
    'use gpu';
    const normal = t3.normalWorld.$;
    const position = t3.positionWorld.$;
    const topFacet = smoothstep(0.08, 0.88, normal.y);
    // A second hard band follows the low-poly face direction. It supplies a
    // pale mineral glint without a photographic specular lobe, so the crust
    // stays graphic and faceted under the existing anime light ramp.
    const sideFacet = smoothstep(
      0.56,
      0.94,
      abs(normal.x * 0.72 + normal.z * 0.36),
    );
    const highlight = clamp(topFacet * 0.58 + sideFacet * 0.34, 0, 0.88);
    const mineralWave = sin(position.x * 0.17 + position.y * 0.11 - position.z * 0.08)
      + sin(position.x * 0.07 - position.y * 0.19 + position.z * 0.13);
    const frostVein = smoothstep(0.56, 1.46, mineralWave);

    // Project the frost along each architectural face. The buildings retain
    // their rectangular massing while one continuous mineral skin can travel
    // from roof to cornice and down the facade without UV seams.
    const facadeHorizontal = position.x * normal.z - position.z * normal.x;
    const roofHorizontal = position.x * 0.82 + position.z * 0.36;
    const roofVertical = position.x * 0.31 - position.z * 0.74;
    const projectedHorizontal = mix(facadeHorizontal, roofHorizontal, topFacet);
    const projectedVertical = mix(position.y, roofVertical, topFacet);
    const crystalU = projectedHorizontal * 0.26 + projectedVertical * 0.06;
    const crystalV = projectedVertical * 0.34 - projectedHorizontal * 0.04;
    const bendA = sin(crystalV * 0.16 + sin(crystalU * 0.11) * 0.8);
    const bendB = sin(crystalU * 0.14 - sin(crystalV * 0.09) * 0.74);
    const ridgeA = 1 - smoothstep(
      0.06,
      0.32,
      abs(sin(crystalU * 0.92 + crystalV * 0.38 + bendA)),
    );
    const ridgeB = 1 - smoothstep(
      0.08,
      0.38,
      abs(sin(crystalU * 0.5 - crystalV * 1.08 + bendB)),
    );
    const ridgeC = 1 - smoothstep(
      0.045,
      0.24,
      abs(sin(crystalU * 1.42 + crystalV * 0.18 - bendA * 0.62)),
    );
    const colonyWave = sin(projectedHorizontal * 0.065 + projectedVertical * 0.045)
      + sin(projectedHorizontal * 0.038 - projectedVertical * 0.08 + 1.7);
    const colony = smoothstep(-0.74, 1.18, colonyWave);
    const crystalRidges = clamp(
      ridgeA * 0.52 + ridgeB * 0.42 + ridgeC * 0.28 + frostVein * 0.2,
      0,
      0.92,
    ) * (0.56 + colony * 0.44);
    // Colour belongs to the crystalline shell, not to the masonry underneath.
    // Keep a rose-violet body on every fragment, then vary it by height,
    // geometric orientation and slope. The previous version started from a
    // white body and mixed back to white a second time, erasing the supplied
    // base colour in both the raw scene and the AO transfer.
    const facetMix = clamp(
      0.1 + highlight * 0.32 + colony * 0.08 + crystalRidges * 0.14,
      0.1,
      0.52,
    );
    const colouredBody = mix(violet.$, paleFacet.$, facetMix);
    // White is now a narrow frost highlight, never the body of the material.
    const frostTrace = clamp(
      frostVein * 0.07 + ridgeC * 0.03,
      0,
      0.1,
    );
    return d.vec4f(mix(colouredBody, frostWhite.$, frostTrace), 1);
  }) as unknown as NonNullable<typeof material.colorNode>;
  material.normalNode = createGrowthReliefNormal();
  material.side = THREE.DoubleSide;
  // Growth alone may feed a restrained bloom; masonry never does.
  material.emissive.set(options.emissive ?? 0x3f1f72);
  material.emissiveIntensity = options.emissiveIntensity ?? 0.38;
  material.opacity = options.opacity ?? 1;
  material.transparent = material.opacity < 0.999;
  material.depthWrite = !material.transparent;
  return material;
};

/** The coating's broad facets carry their own linear vertex colours. Using
 * opaque geometry also gives the AO MRT a stable depth/normal/emissive sample;
 * the former transparent sheets let unrelated windows leak into its mask. */
export const createWahrWeltCrystalCoatingMaterial = (): THREE.MeshStandardNodeMaterial => {
  const material = new THREE.MeshStandardNodeMaterial();
  material.color.setRGB(1.0, 0.94, 1.0);
  material.vertexColors = true;
  // Glassy crystal highlight instead of the earlier matte mineral crust.
  material.roughness = 0.22;
  material.metalness = 0;
  material.flatShading = true;
  material.emissive.set(0x9a48c4);
  material.emissiveIntensity = 0.03;
  // The growth is self-luminous violet-pink: a steady inner light carries the
  // vertex palette, grazing facets flare like lit crystal rims. One hue family
  // only — the earlier 0.62 emission was rejected for its rainbow, not glow.
  const crystalColour = attribute<'vec3'>('color', 'vec3');
  const grazing = tslFloat(1).sub(normalView.z.abs()).clamp(0, 1);
  material.emissiveNode = crystalColour.mul(tslFloat(0.22).add(grazing.pow(3).mul(0.18)));
  material.side = THREE.DoubleSide;
  return material;
};
