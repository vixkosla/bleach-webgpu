import type * as THREE from 'three/webgpu';
import { Fn, atan, color, float, mix, texture3D, vec2, vec3, vec4 } from 'three/tsl';

// One main accent and three restrained breaths, each rooted on the outer
// crescent. These are density lobes of the cloud, never detached flame cards.
export const MATTER_TIPS = [
  { angle: 0.86, reach: 0.55, width: 0.13, strength: 1.2, phase: 0.4, depth: 0.02 },
  { angle: -0.45, reach: 0.25, width: 0.066, strength: 0.42, phase: 2.1, depth: -0.02 },
  { angle: -1.53, reach: 0.20, width: 0.058, strength: 0.34, phase: 4.7, depth: 0.035 },
  { angle: 2.02, reach: 0.18, width: 0.05, strength: 0.28, phase: 1.3, depth: 0.005 },
] as const;

/** One lunar-space flow for the solid skin, dense roots and eroding folds. */
export const createUpperMatterField = (
  noise: THREE.Data3DTexture, detail: THREE.Data3DTexture, time: THREE.Node<'float'>,
  compression: THREE.Node<'float'> = float(0), release: THREE.Node<'float'> = float(0),
  wake: THREE.Node<'float'> = float(0),
) => {
  const flow = Fn(([point]: [THREE.Node<'vec3'>]) => {
    // Strain belongs to the escaping folds, not the analytic lunar radius.
    // A delayed tangential wake follows the initial outward displacement.
    const outside = point.xy.length().smoothstep(0.78, 1.45);
    const strain = release.mul(0.14).sub(compression.mul(0.07)).mul(outside);
    const drift = vec3(point.y.negate(), point.x, point.z.mul(0.35))
      .mul(wake.mul(0.09).mul(outside));
    const flowing = point.mul(strain.oneMinus()).sub(drift);
    const q = flowing.mul(vec3(0.17, 0.23, 0.17))
      .add(vec3(time.mul(0.0028), time.mul(-0.004), time.mul(0.0017)));
    const warp = texture3D(noise, q.mul(0.63).add(0.37), 0).r;
    const curl = vec3(point.y.negate(), point.x, point.z.mul(0.3))
      .mul(warp.sub(0.5).mul(0.11));
    const ink = texture3D(noise, q.add(curl).add(vec3(0.31, 0.73, 0.17)), 0).r;
    const creases = texture3D(detail, flowing.mul(vec3(1.05, 0.46, 0.78))
      .add(vec3(time.mul(-0.019), time.mul(-0.027), time.mul(0.009)))
      .add(warp.mul(0.13)), 0);
    return vec4(ink.mul(0.66).add(creases.r.mul(0.28)).add(creases.g.mul(0.06)),
      ink.smoothstep(0.43, 0.68), creases.r, ink);
  });
  const tint = Fn(([fold]: [THREE.Node<'float'>]) =>
    mix(color(0x020205), color(0x292832), fold.smoothstep(0.42, 0.72).mul(0.72)));

  const tips = Fn(([point]: [THREE.Node<'vec3'>]) => {
    let density: THREE.Node<'float'> = float(0);
    for (const tip of MATTER_TIPS) {
      const axis = vec2(Math.cos(tip.angle), Math.sin(tip.angle));
      const tangent = vec2(-Math.sin(tip.angle), Math.cos(tip.angle));
      const along = point.xy.dot(axis).sub(0.94);
      const breathing = time.mul(0.92).add(tip.phase).sin().mul(0.14).add(0.86);
      const reach = breathing.mul(tip.reach)
        .mul(release.mul(0.55).sub(compression.mul(0.28)).add(wake.mul(0.12)).add(1));
      const u = along.div(reach).clamp(0, 1);
      // Broad roots stay slow. The travelling bend accelerates into a thin,
      // pointed tip; neighbouring accents have unequal phase and reach.
      const wave = u.mul(7.5).sub(time.mul(2.35)).add(tip.phase).sin();
      const bend = u.pow(1.35).mul(wave.mul(0.026).add(u.mul(wake.mul(0.08).add(0.045))));
      const width = u.oneMinus().pow(0.8).mul(tip.width).add(0.009);
      const across = point.xy.dot(tangent).sub(bend).div(width);
      const depth = point.z.sub(tip.depth).sub(u.mul(0.055).mul(wave))
        .div(width.mul(0.8).add(0.014));
      const cross = across.pow(2).add(depth.pow(2));
      const pointed = cross.smoothstep(0.12, 1.25).oneMinus();
      const length = along.smoothstep(-0.05, 0.025)
        .mul(along.div(reach).smoothstep(0.80, 1.03).oneMinus());
      density = density.max(pointed.mul(length).mul(tip.strength)
        .mul(u.mul(-0.6).add(1)));
    }
    return density;
  });

  // The dense core keeps a smooth analytic crescent sweep. Flow belongs to
  // its shading and escaping density, not the radius of the inner arc.
  const surface = Fn(([point]: [THREE.Node<'vec3'>]) => {
    const angle = atan(point.y, point.x);
    const phase = angle.add(Math.PI - 0.13).div(Math.PI * 2 - 0.26).clamp(0, 1);
    const taper = phase.mul(Math.PI).sin().max(0).pow(0.55);
    const halfWidth = angle.cos().add(1).mul(0.5).mul(0.43).add(0.025).mul(taper).mul(0.5);
    const centre = halfWidth.oneMinus();
    const cross = vec2(point.xy.length().sub(centre), point.z.div(1.18));
    const length = cross.length();
    const unit = cross.div(length.max(0.0001));
    const anchorRadius = centre.add(unit.x.mul(halfWidth));
    const anchor = vec3(angle.cos().mul(anchorRadius), angle.sin().mul(anchorRadius),
      unit.y.mul(halfWidth).mul(1.18));
    return vec4(anchor, length.sub(halfWidth));
  });
  // Gradient of the same elliptical swept field, including its varying
  // width along the arc. A radial/XY normal would be wrong on the front,
  // back and tapered ends when the camera orbits through lunar depth.
  const surfaceNormal = Fn(([point]: [THREE.Node<'vec3'>]) => {
    const angle = atan(point.y, point.x);
    const phase = angle.add(Math.PI - 0.13).div(Math.PI * 2 - 0.26).clamp(0, 1);
    const sine = phase.mul(Math.PI).sin().max(0.0001);
    const taper = sine.pow(0.55);
    const base = angle.cos().mul(0.1075).add(0.12);
    const halfWidth = base.mul(taper);
    const widthSlope = angle.sin().mul(-0.1075).mul(taper)
      .add(base.mul(0.55 * Math.PI / (Math.PI * 2 - 0.26))
        .mul(phase.mul(Math.PI).cos()).mul(sine.pow(-0.45)));
    const radius = point.xy.length().max(0.0001);
    const cross = vec2(radius.sub(1).add(halfWidth), point.z.div(1.18));
    const unit = cross.div(cross.length().max(0.0001));
    const alongArc = unit.x.sub(1).mul(widthSlope).div(radius);
    return vec3(angle.cos().mul(unit.x).sub(angle.sin().mul(alongArc)),
      angle.sin().mul(unit.x).add(angle.cos().mul(alongArc)), unit.y.div(1.18)).normalize();
  });
  return { flow, tint, surface, surfaceNormal, tips };
};
