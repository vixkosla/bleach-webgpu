import * as THREE from 'three/webgpu';
import {
  Fn, color, float, getViewPosition, screenUV, uniform, vec3, vec4,
} from 'three/tsl';
import type { UpperEventLayout } from './upperEvent';

// Gaussian integral, including partial occlusion by the first opaque surface.
// An analytic ray integral resolves a very narrow beam without undersampled
// raymarch slices, extra textures, or a camera-facing cross sprite.
const erf = Fn(([x]: [THREE.Node<'float'>]) => {
  const a = x.abs(), t = float(1).div(a.mul(0.3275911).add(1));
  const polynomial = t.mul(1.061405429).sub(1.453152027).mul(t)
    .add(1.421413741).mul(t).sub(0.284496736).mul(t).add(0.254829592).mul(t);
  return polynomial.mul(a.mul(a).negate().exp()).oneMinus().mul(x.sign());
});

export const createCitadelCrossLight = (layout: UpperEventLayout, clock: THREE.Node<'float'>) => {
  const controls = { strength: uniform(1), birth: uniform(0), width: uniform(1.35),
    crossbar: uniform(0.90), crossHeight: uniform(22), crossSpan: uniform(65), depthOffset: uniform(0) };
  const frame = uniform(new THREE.Matrix3().setFromMatrix4(new THREE.Matrix4()
    .makeRotationFromQuaternion(layout.orientation.clone().invert())));
  const layer = (depth: THREE.Node<'float'>, camera: THREE.PerspectiveCamera) => Fn(() => {
    // Explicit scene camera: this node runs in the fullscreen resolve whose
    // implicit camera is an orthographic quad, not the inspection camera.
    const cameraWorld = uniform(camera.matrixWorld);
    const view = getViewPosition(screenUV, depth, uniform(camera.projectionMatrixInverse));
    const viewRay = view.normalize();
    const direction = frame.mul(cameraWorld.mul(vec4(viewRay, 0)).xyz).normalize();
    const origin = frame.mul(cameraWorld.mul(vec4(0, 0, 0, 1)).xyz.sub(vec3(...layout.crown.toArray())))
      .sub(vec3(0, 0, controls.depthOffset));
    const end = view.length().min(8000);
    const integrate = (centre: THREE.Node<'vec3'>, radii: THREE.Node<'vec3'>) => {
      const eye = origin.sub(centre).div(radii), ray = direction.div(radii);
      const a = ray.dot(ray).max(0.0000001), root = a.sqrt();
      const closestT = eye.dot(ray).negate().div(a);
      // Computing the closest point directly avoids subtracting two large
      // squared distances when the thin shaft is viewed from far away.
      const closest = eye.add(ray.mul(closestT));
      const coverage = closest.dot(closest).mul(-0.5).exp();
      const upper = end.sub(closestT).mul(root).mul(Math.SQRT1_2);
      const lower = closestT.negate().mul(root).mul(Math.SQRT1_2);
      return coverage.mul(erf(upper).sub(erf(lower)).max(0))
        .mul(1.253314137).div(root);
    };
    const width = controls.width.max(0.35);
    const stem = integrate(vec3(0, 85, 0), vec3(width, 180, width)).div(width.mul(2.506628));
    const shoulder = integrate(vec3(0, 80, 0), vec3(width.mul(4.2), 190, width.mul(4.2)))
      .div(width.mul(2.506628 * 4.2));
    const cross = integrate(vec3(0, controls.crossHeight, 0),
      vec3(controls.crossSpan, width.mul(0.8), width))
      .div(width.mul(2.506628)).mul(controls.crossbar);
    const crossGlow = integrate(vec3(0, controls.crossHeight, 0),
      vec3(controls.crossSpan.mul(0.8), width.mul(3), width.mul(3)))
      .div(width.mul(2.506628 * 3)).mul(controls.crossbar);
    const breath = clock.mul(0.52).sin().mul(0.035).add(0.965);
    return color(0xfffcf4).mul(stem.mul(1.45).add(cross).min(3))
      .add(color(0xffe1b5).mul(shoulder.mul(0.20).add(crossGlow.mul(0.12)).min(0.6)))
      .mul(controls.strength).mul(controls.birth).mul(breath);
  })();
  return { controls, layer,
    update: (visible: boolean, birth: number) => { controls.birth.value = visible ? birth : 0; },
  };
};
