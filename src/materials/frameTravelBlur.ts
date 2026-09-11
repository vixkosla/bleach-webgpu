import * as THREE from 'three/webgpu';
import { Fn, If, float, rtt, screenSize, screenUV, uniform, vec4 } from 'three/tsl';

/** An authored shutter smear for compressed frame travel. The image remains
 * energy-normalized; neither a white flash nor a dissolve hides camera cuts. */
export const createFrameTravelBlur = (input: THREE.Node<'vec4'>) => {
  const amount = uniform(0);
  const focus = uniform(new THREE.Vector2(.5, .5));
  const direction = uniform(new THREE.Vector2());
  const resolved = rtt(input, null, null, { type: THREE.HalfFloatType, depthBuffer: false, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter });
  resolved.name = 'Frame travel / complete scene';
  const output = Fn(() => {
    const base = resolved.sample(screenUV).level(float(0)).toVar();
    If(amount.greaterThan(.0001), () => {
      const span = screenUV.sub(focus).mul(.48).add(direction).mul(amount);
      // Filter to the distance between taps, avoiding repeated sharp lunar
      // edges along a long shutter. Still frames always sample full detail.
      const lod = span.mul(screenSize).length().div(20).max(1).log2();
      const sum = vec4(0).toVar();
      let total = 0;
      // Sample behind an expanding image: colours trail outward from the
      // travel focus instead of contracting toward the screen centre.
      for (let i = 0; i <= 20; i++) {
        const shutter = i / 20, weight = Math.exp(-shutter * shutter * 3);
        total += weight;
        sum.addAssign(resolved.sample(screenUV.sub(span.mul(shutter)).clamp(.001, .999)).level(lod).mul(weight));
      }
      base.assign(sum.div(total));
    });
    return base;
  })();
  return { output, amount, focus, direction, resolved };
};
