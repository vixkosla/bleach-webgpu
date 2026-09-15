import { clamp01 } from '../utils/math';

/** Integral of a smooth velocity ramp, not a switch at the final camera stop.
 * Before story60 it is exactly zero. At66 the camera settles while this
 * absolute material clock can continue under the same Play/Pause control. */
export const finaleFlowTime = (storyTime: number, heldTime = 0): number => {
  const t = Number.isFinite(storyTime) ? storyTime : 0;
  const u = clamp01((t - 60) / 6);
  const held = Number.isFinite(heldTime) ? Math.max(0, heldTime) : 0;
  return 6 * (u ** 3 - .5 * u ** 4) + Math.max(0, t - 66) + (t >= 66 ? held : 0);
};
