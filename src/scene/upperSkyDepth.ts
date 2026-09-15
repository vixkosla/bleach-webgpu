import * as THREE from 'three/webgpu';
import { Break, Fn, If, Loop, cameraPosition, color, mix, screenCoordinate, texture3D, uniform, vec2, vec3, vec4 } from 'three/tsl';
import type { UpperEventLayout } from './upperEvent';

/** Distant weather occupies a hollow world volume around the city. Translation
 * reveals different depths and overlapping banks; the established near storm
 * and lunar clearing still own the centre. This shares the existing sky draw. */
export const createUpperSkyDepth = (
  layout: UpperEventLayout,
  noise: THREE.Data3DTexture,
  clock: THREE.Node<'float'>,
  exposure: THREE.Node<'float'>,
  finalFlow: THREE.Node<'float'>,
) => {
  const controls = { skyDepth: uniform(0), skyLift: uniform(0), skyLower: uniform(.2) };
  const centre = vec3(layout.center.x, 900, layout.center.z);
  const half = vec3(6200, 2850, 6200);
  const layer = Fn(([direction]: [THREE.Node<'vec3'>]) => {
    const eye = cameraPosition.sub(centre).toVar();
    // Keep axis-aligned rays finite without changing the world-space field.
    const safeRay = direction.sign().mul(direction.abs().max(.00001))
      .add(direction.equal(0).select(vec3(.00001), vec3(0)));
    const lo = half.negate().sub(eye).div(safeRay), hi = half.sub(eye).div(safeRay);
    const near = lo.min(hi), far = lo.max(hi);
    const entry = near.x.max(near.y).max(near.z).max(0).toVar();
    const end = far.x.min(far.y).min(far.z).max(entry).toVar();
    const steps = end.sub(entry).div(145).ceil().clamp(20, 72).toVar();
    const step = end.sub(entry).div(steps).toVar();
    const jitter = screenCoordinate.xy.dot(vec2(12.9898, 78.233)).sin().mul(43758.5453).fract();
    const point = cameraPosition.add(direction.mul(entry.add(step.mul(jitter.mul(.5).add(.25))))).toVar();
    const sum = vec4(0).toVar();
    const wind = vec3(clock.mul(.00012), clock.mul(.00003), clock.mul(-.00009));
    If(controls.skyDepth.greaterThan(.001), () => {
    Loop({ start: 0, end: steps, type: 'float', condition: '<' }, () => {
      const radial = point.xz.sub(vec2(layout.center.x, layout.center.z)).length();
      const coast = radial.smoothstep(1550, 2200).mul(radial.smoothstep(5100, 6100).oneMinus());
      If(coast.greaterThan(.001), () => {
        const rolling = point.x.mul(.0016).add(point.z.mul(.0011)).sin().mul(155)
          .add(point.z.mul(.003).sub(point.x.mul(.0014)).sin().mul(75));
        const height = point.y.sub(rolling).sub(controls.skyLift);
        // Unequal, connected shelves: low far banks, a middle storm body and
        // tall upper folds. Their quiet horizontal gaps preserve depth.
        const low = height.add(220).div(310).pow(2).mul(-1.5).exp().mul(controls.skyLower);
        const middle = height.sub(560).div(440).pow(2).mul(-1.4).exp();
        const upper = height.sub(1580).div(680).pow(2).mul(-1.5).exp().mul(.8);
        const envelope = low.max(middle).max(upper).mul(coast);
        // Rear violet shelves descend; high banks also travel right. The
        // envelopes stay anchored, while folds stream through their depths.
        const high = height.smoothstep(700, 1600);
        const transport = vec3(high.mul(-18).sub(4), 24, 3).mul(finalFlow);
        const rollingFlow = point.z.mul(.002).add(finalFlow.mul(.22)).sin()
          .sub(point.z.mul(.002).sin()).mul(48);
        const q = vec3(point.x, height.add(rollingFlow), point.z).add(transport)
          .mul(vec3(.000043, .000105, .000051)).add(wind);
        const broad = texture3D(noise, q.add(.31), 0).r.toVar();
        const folds = texture3D(noise, q.mul(vec3(2.2, 2.8, 2.1)).sub(wind.mul(.5)).add(.67), 0).r;
        const field = broad.mul(.72).add(folds.mul(.28));
        const density = field.smoothstep(.50, .73).mul(envelope).mul(2.8).toVar();
        If(density.greaterThan(.001), () => {
          const above = texture3D(noise, q.add(vec3(.006, .023, -.005)).add(.31), 0).r;
          const relief = broad.sub(above).mul(3.8).add(.45).clamp(.12, 1);
          const transmission = density.mul(-2.6).exp();
          const light = relief.mul(.78).add(transmission.mul(.16)).add(.06)
            .mul(exposure.mul(.28).add(.14));
          const tint = mix(color(0xafa1c5), color(0xe5d9de), height.smoothstep(200, 1900));
          const sample = color(0x1c1929).mul(.45).add(tint.mul(light));
          const alpha = density.mul(step).mul(-.0017).exp().oneMinus();
          const amount = sum.a.oneMinus().mul(alpha);
          sum.rgb.addAssign(sample.mul(amount));
          sum.a.addAssign(amount);
        });
      });
      If(sum.a.greaterThan(.985), () => { Break(); });
      point.addAssign(direction.mul(step));
    });
    });
    return vec4(sum.rgb, sum.a).mul(controls.skyDepth);
  });
  return { controls, layer };
};
