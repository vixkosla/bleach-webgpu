import type { UpperEventLayout } from '../scene/upperEvent';

export interface UpperShotSettings {
  fov: number;
  distance: number;
  height: number;
  frameY: number;
  azimuth: number;
}

// Saved user orbit: closer, lower and slightly to the side of the citadel.
// Lens/dolly comparisons of the FINAL shot. Earlier travelling shots keep
// their own lenses and altitude; this is the endpoint for their later handoff.
export const UPPER_SHOT_PRESETS = {
  depth: { fov: 90, distance: 325, height: -246, frameY: 0.28, azimuth: 16 },
  final: { fov: 80, distance: 415, height: -246, frameY: 0.28, azimuth: 16 },
  compressed: { fov: 68, distance: 610, height: -246, frameY: 0.28, azimuth: 16 },
} satisfies Record<string, UpperShotSettings>;

/** User-selected low oblique view, anchored to the real citadel and moon. */
export const createUpperInspectionPreset = (
  layout: UpperEventLayout, aspect: number, settings: UpperShotSettings = UPPER_SHOT_PRESETS.final,
) => {
  const safeAspect = Number.isFinite(aspect) && aspect > 0 ? aspect : 1;
  const lens = Math.max(30, Math.min(95, settings.fov));
  const tangent = Math.tan(lens * Math.PI / 360);
  const fov = Math.min(safeAspect >= 1 ? 95 : 78, Math.atan(tangent / Math.min(1, safeAspect)) * 360 / Math.PI);
  // Portrait keeps the full lunar width even after reaching the lens limit.
  const fitDistance = Math.max(1, tangent / (Math.tan(fov * Math.PI / 360) * safeAspect));
  const distance = Math.max(220, Math.min(2200, settings.distance)) * fitDistance * Math.min(1, safeAspect / 0.98);
  const height = Math.max(-400, Math.min(40, settings.height));
  const frameY = Math.max(0.20, Math.min(0.46, settings.frameY));
  const azimuth = Math.max(-60, Math.min(60, settings.azimuth)) * Math.PI / 180;
  const position: [number, number, number] = [
    layout.center.x + distance * Math.tan(azimuth), layout.crown.y + height, layout.center.z + distance,
  ];
  const horizontalDistance = Math.hypot(layout.center.x - position[0], layout.center.z - position[2]);
  const eventElevation = Math.atan2(layout.center.y - position[1], horizontalDistance);
  const pitch = eventElevation - Math.atan((1 - frameY * 2) * Math.tan(fov * Math.PI / 360));
  const target: [number, number, number] = [
    layout.center.x, position[1] + horizontalDistance * Math.tan(pitch), layout.center.z,
  ];
  return { position, target, fov, time: 21.8 };
};
