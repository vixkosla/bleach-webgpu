import * as THREE from 'three/webgpu';
import { Fn, float, mix, mrt, normalView, normalWorldGeometry, positionWorld, texture, uniform, vec2, vec3, vec4 } from 'three/tsl';

/** A cached architectural shadow drawing over the soft AO treatment. Only
 * opaque citadel stone casts/receives it; city, crystals and sky keep their
 * current treatment. Geometry is shared with the visible keep, including its
 * instanced cornices and battlements, so the drawing follows every orbit. */
export const createCitadelShadows = async (
  renderer: THREE.WebGPURenderer,
  citadel: THREE.Group,
  key: THREE.DirectionalLight,
) => {
  const controls = { strength: uniform(0.72), bias: uniform(0.28), form: uniform(0.38) };
  const shadowScene = new THREE.Scene();
  const shadowMaterial = new THREE.MeshBasicNodeMaterial({ color: 0xffffff, side: THREE.DoubleSide });
  const stoneMaterials = new Map<THREE.NodeMaterial, THREE.NodeMaterial['mrtNode']>();
  citadel.updateWorldMatrix(true, true);
  citadel.traverse(object => {
    if (!(object instanceof THREE.Mesh)) return;
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    if (!materials.every(m => m instanceof THREE.MeshToonNodeMaterial && !m.transparent)) return;
    for (const material of materials as THREE.MeshToonNodeMaterial[]) {
      if (!stoneMaterials.has(material)) {
        stoneMaterials.set(material, material.mrtNode);
      }
    }
    const caster = object.clone(false);
    caster.material = shadowMaterial;
    caster.matrixAutoUpdate = false;
    caster.matrix.copy(object.matrixWorld);
    caster.castShadow = caster.receiveShadow = false;
    shadowScene.add(caster);
  });
  shadowScene.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(shadowScene);
  const center = bounds.getCenter(new THREE.Vector3());
  key.updateWorldMatrix(true, false); key.target.updateWorldMatrix(true, false);
  const lightDirection = key.getWorldPosition(new THREE.Vector3())
    .sub(key.target.getWorldPosition(new THREE.Vector3())).normalize();
  const lightCamera = new THREE.OrthographicCamera();
  lightCamera.coordinateSystem = THREE.WebGPUCoordinateSystem;
  lightCamera.position.copy(center).addScaledVector(lightDirection, 700);
  lightCamera.lookAt(center); lightCamera.updateMatrixWorld(true);
  const lightBounds = new THREE.Box3();
  for (const x of [bounds.min.x, bounds.max.x]) for (const y of [bounds.min.y, bounds.max.y]) {
    for (const z of [bounds.min.z, bounds.max.z]) {
      lightBounds.expandByPoint(new THREE.Vector3(x, y, z).applyMatrix4(lightCamera.matrixWorldInverse));
    }
  }
  lightCamera.left = lightBounds.min.x - 4; lightCamera.right = lightBounds.max.x + 4;
  lightCamera.bottom = lightBounds.min.y - 4; lightCamera.top = lightBounds.max.y + 4;
  lightCamera.near = -lightBounds.max.z - 4; lightCamera.far = -lightBounds.min.z + 4;
  lightCamera.updateProjectionMatrix();

  const size = 2048;
  const target = new THREE.RenderTarget(size, size, {
    format: THREE.RedFormat, type: THREE.UnsignedByteType,
    minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter,
    depthTexture: new THREE.DepthTexture(size, size, THREE.UnsignedIntType),
  });
  target.texture.name = 'citadel-static-shadow';
  target.depthTexture!.name = 'citadel-static-shadow-depth';
  const previousTarget = renderer.getRenderTarget();
  const previousClear = renderer.getClearColor(new THREE.Color()), previousAlpha = renderer.getClearAlpha();
  try {
    renderer.setRenderTarget(target); renderer.setClearColor(0xffffff, 1);
    await renderer.renderAsync(shadowScene, lightCamera);
  } finally {
    renderer.setRenderTarget(previousTarget); renderer.setClearColor(previousClear, previousAlpha);
    shadowMaterial.dispose(); shadowScene.clear();
  }
  const lightMatrix = uniform(new THREE.Matrix4().multiplyMatrices(lightCamera.projectionMatrix, lightCamera.matrixWorldInverse));
  const map = texture(target.depthTexture!);
  const direction = uniform(lightDirection);
  const depthRange = lightCamera.far - lightCamera.near;

  const shadowAt = Fn(([world, surface]: [THREE.Node<'vec3'>, THREE.Node<'vec3'>]) => {
    // Evaluate on the real surface. Reconstructing it from an MSAA depth
    // pixel perturbs the receiving plane and causes diagonal self-shadow acne.
    // Geometry normals avoid the procedural mortar's per-brick bias shifts.
    const clip = lightMatrix.mul(vec4(world.add(surface.mul(controls.bias)), 1));
    const shadowUv = clip.xy.mul(vec2(0.5, -0.5)).add(0.5);
    const receiver = clip.z.sub(0.04 / depthRange);
    // Four nearest comparisons give a one-texel antialiased edge. This mask
    // is applied AFTER the beauty/contact filters, retaining crisp ledges.
    let blocked: THREE.Node<'float'> = float(0);
    for (const x of [-0.5, 0.5]) for (const y of [-0.5, 0.5]) {
      blocked = blocked.add(map.sample(shadowUv.add(vec2(x / size, y / size)))
        .r.lessThan(receiver).select(0.25, 0));
    }
    const inside = shadowUv.x.greaterThanEqual(0).and(shadowUv.x.lessThanEqual(1))
      .and(shadowUv.y.greaterThanEqual(0)).and(shadowUv.y.lessThanEqual(1))
      .and(clip.z.greaterThanEqual(0)).and(clip.z.lessThanEqual(1));
    const cast = inside.select(blocked, 0);
    const form = surface.dot(direction).smoothstep(-0.06, 0.10).oneMinus().mul(controls.form);
    return cast.max(form);
  });
  for (const material of stoneMaterials.keys()) {
    // Normal XYZ remains unchanged for AO. Its unused alpha carries the
    // unsmoothed shadow drawing: 0=other materials, 1=lit stone, 2=shadow.
    // Reusing this buffer also keeps the sky composite within WebGPU's
    // portable 16-texture limit, without an extra screen/scene pass.
    material.mrtNode = mrt({ normal: vec4(normalView,
      shadowAt(positionWorld, normalWorldGeometry).add(1)) });
  }
  const apply = (beauty: THREE.Node<'vec3'>, depth: THREE.TextureNode, normal: THREE.TextureNode) => {
    const shade = normal.a.sub(1).clamp(0, 1).mul(controls.strength)
      .mul(depth.r.lessThan(1).select(1, 0));
    return beauty.mul(mix(vec3(1), vec3(0.32, 0.18, 0.43), shade));
  };
  return {
    controls, apply, lightCamera, target,
    dispose() {
      target.dispose();
      for (const [material, original] of stoneMaterials) material.mrtNode = original;
    },
  };
};
