import type * as THREE from 'three/webgpu';
import { Fn, atan, float, vec2, vec3 } from 'three/tsl';

// Unequal source pairs slowly trade places. Each has real OFF plateaus, not
// just brightness flutter on four permanently fixed patches.
export const CORONA_OPENINGS = [
  { angle: 2.40, halfWidth: 0.43, strength: 1.0, phase: 0.7, rate: 0.085,
    next: { angle: 1.46, halfWidth: 0.24, strength: 0.82 } },
  { angle: -0.16, halfWidth: 0.30, strength: 0.86, phase: 2.1, rate: 0.072,
    next: { angle: -1.08, halfWidth: 0.24, strength: 0.90 } },
  { angle: 0.78, halfWidth: 0.19, strength: 0.64, phase: 4.3, rate: 0.097,
    next: { angle: 0.36, halfWidth: 0.14, strength: 0.70 } },
  { angle: -1.94, halfWidth: 0.24, strength: 0.76, phase: 1.4, rate: 0.081,
    next: { angle: -2.70, halfWidth: 0.20, strength: 0.80 } },
] as const;

// One diagonal for the entire light field, aligned with the upper-left cloud
// current. Both sides of the source share parallel lines, never separate fans.
export const CRESCENT_SHAFT_ANGLE = -0.63;

// CPU optical bake uses the same circle/parallel-line intersection as the
// shader, in the moon frame aligned to the citadel.
export const crescentShaftSource = (x: number, y: number) => {
  const angle = CRESCENT_SHAFT_ANGLE;
  const ax = Math.cos(angle), ay = Math.sin(angle);
  const across = -x * ay + y * ax;
  const along = x * ax + y * ay;
  const edge = Math.sqrt(Math.max(0, 1 - across * across));
  const travel = Math.max(0, Math.abs(along) - edge);
  return { x: x - ax * Math.sign(along) * travel,
    y: y - ay * Math.sign(along) * travel, travel, valid: Math.abs(across) < 1 };
};

const openingRadiance = (
  angle: THREE.Node<'float'>, clock: THREE.Node<'float'>,
  opening: { angle: number; halfWidth: number; strength: number }, phase: number,
) => {
  const drift = clock.mul(0.065).add(phase).sin().mul(0.035);
  const delta = angle.sub(opening.angle).sub(drift).abs();
  const offset = delta.min(float(Math.PI * 2).sub(delta));
  const patch = offset.smoothstep(opening.halfWidth * 0.30, opening.halfWidth).oneMinus();
  const flutter = angle.mul(13).add(clock.mul(0.13)).add(phase).sin().mul(0.09).add(0.91);
  return patch.mul(flutter).mul(opening.strength);
};

// Both the shell and cloud shafts use the SAME openings in the moon frame.
export const crescentRadiance = Fn(([angle, clock]: [THREE.Node<'float'>, THREE.Node<'float'>]) => {
  let energy: THREE.Node<'float'> = float(0);
  for (const opening of CORONA_OPENINGS) {
    const exchange = clock.mul(opening.rate).add(opening.phase).sin().smoothstep(-0.55, 0.55);
    energy = energy.max(openingRadiance(angle, clock, opening, opening.phase).mul(exchange.oneMinus()))
      .max(openingRadiance(angle, clock, opening.next, opening.phase + 1.3).mul(exchange));
  }
  return energy;
});

/** Local source pockets recessed through lunar depth, occluded by the same
 * front-to-back integration as the black folds. No luminous surface shell. */
export const crescentDepthRadiance = Fn(([point, clock]: [THREE.Node<'vec3'>, THREE.Node<'float'>]) => {
  let energy: THREE.Node<'float'> = float(0);
  for (const opening of CORONA_OPENINGS) {
    const exchange = clock.mul(opening.rate).add(opening.phase).sin().smoothstep(-0.55, 0.55);
    for (const [source, weight] of [[opening, exchange.oneMinus()], [opening.next, exchange]] as const) {
      const radial = vec2(Math.cos(source.angle), Math.sin(source.angle));
      const tangent = vec2(-Math.sin(source.angle), Math.cos(source.angle));
      const radius = 1.055 + Math.sin(source.angle * 3) * 0.035;
      const depth = -0.14 + Math.sin(source.angle * 2) * 0.07;
      const delta = point.sub(vec3(radial.mul(radius), depth));
      const drift = clock.mul(0.065).add(opening.phase).sin().mul(0.035);
      // Cartesian pockets have rounded ends in all three dimensions. Unlike
      // angular wedges, they cannot become luminous fans across the cavity.
      const distance = delta.xy.dot(radial).div(0.075).pow(2)
        .add(delta.xy.dot(tangent).sub(drift).div(source.halfWidth * 0.52).pow(2))
        .add(delta.z.div(0.065).pow(2));
      energy = energy.add(distance.mul(-0.5).exp().mul(weight).mul(source.strength));
    }
  }
  return energy;
});

/** Selective light follows the entire rounded lunar surface, through depth.
 * The sectors stay in the moon frame; the real 3D ray only selects tangency.
 * This is evaluated inside the absorbing density integral, never a shell
 * composited over the black body or a fixed-Z row of point lights. */
export const crescentContourRadiance = Fn(([point, distance, normal, ray, clock]: [
  THREE.Node<'vec3'>, THREE.Node<'float'>, THREE.Node<'vec3'>,
  THREE.Node<'vec3'>, THREE.Node<'float'>,
]) => {
  const angle = atan(point.y, point.x);
  const arc = angle.abs().smoothstep(Math.PI - 0.20, Math.PI - 0.13).oneMinus();
  // The same source pairs now have long Gaussian shoulders, rather than
  // clipped angular ends. Keep the distant gold shafts on their old field.
  let openings: THREE.Node<'float'> = float(0);
  for (const opening of CORONA_OPENINGS) {
    const exchange = clock.mul(opening.rate).add(opening.phase).sin().smoothstep(-0.55, 0.55);
    const drift = clock.mul(0.065).add(opening.phase).sin().mul(0.035);
    for (const [source, weight] of [[opening, exchange.oneMinus()], [opening.next, exchange]] as const) {
      const delta = angle.sub(source.angle).sub(drift).abs();
      const offset = delta.min(float(Math.PI * 2).sub(delta));
      const shoulder = offset.div(source.halfWidth * 0.95 + 0.07).pow(2).mul(-0.5).exp();
      openings = openings.add(shoulder.mul(weight).mul(source.strength));
    }
  }
  const band = distance.sub(0.05).div(0.10).pow(2).mul(-0.5).exp()
    .mul(distance.smoothstep(0.002, 0.025));
  const tangent = normal.dot(ray).abs().smoothstep(0.10, 0.84).oneMinus();
  return openings.mul(0.80).mul(arc).mul(band).mul(tangent);
});

// Trace one coherent parallel field through the actual luminous contour.
// Cloud transmission and local gas interrupt it; contour position no longer
// chooses a new radial direction for each patch.
export const crescentParallelShafts = Fn(([point, clock, scale]: [
  THREE.Node<'vec3'>, THREE.Node<'float'>, THREE.Node<'float'>,
]) => {
  const axis = vec2(Math.cos(CRESCENT_SHAFT_ANGLE), Math.sin(CRESCENT_SHAFT_ANGLE));
  const tangent = vec2(-Math.sin(CRESCENT_SHAFT_ANGLE), Math.cos(CRESCENT_SHAFT_ANGLE));
  const across = point.xy.dot(tangent), along = point.xy.dot(axis);
  const sourceAlong = scale.mul(scale).sub(across.mul(across)).max(0.0001).sqrt();
  const source = axis.mul(sourceAlong.mul(along.sign())).add(tangent.mul(across));
  const sourceAngle = atan(source.y, source.x);
  const travel = along.abs().sub(sourceAlong);
  const aperture = across.abs().smoothstep(scale.mul(0.96), scale).oneMinus();
  const stripes = across.mul(49).add(across.mul(11).sin().mul(2.1))
    .add(0.7).sub(clock.mul(0.006)).sin().smoothstep(-0.45, 0.94);
  const variation = across.mul(15).add(0.7).sin().mul(0.25).add(0.75);
  // Short, unequal openings in the weather, with a shared direction. Long
  // constant-width ribbons across clear sky looked like a graphic logo.
  const reach = across.mul(8.7).add(along.sign().mul(1.9)).sin().mul(0.3).add(1.05);
  const lengthFade = travel.smoothstep(0.03, 0.15)
    .mul(travel.div(reach).smoothstep(0.18, 1).oneMinus());
  const depth = point.z.div(0.44).pow(2).mul(-0.5).exp();
  return crescentRadiance(sourceAngle, clock).mul(aperture)
    .mul(stripes).mul(variation).mul(lengthFade).mul(depth);
});
