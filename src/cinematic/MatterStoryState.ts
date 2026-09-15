import { smootherstep } from '../utils/math';

export interface MatterStoryPose {
  /** Extent of a single rooted plate, not a reveal mask. */
  assembly: number;
  /** Thickness catches up with the curved plate's expansion. */
  cohesion: number;
  compression: number;
  release: number;
  wake: number;
}

/** Anisotropic growth about the lower attachment. No random fragments or
 * angular wipe: the analytic skin remains closed and dense at every size. */
export const writeMatterGrowth = (pose: Readonly<MatterStoryPose> | undefined,
  target: { set: (x: number, y: number, z: number) => unknown }): void => {
  const extent = pose?.assembly ?? 1, thickness = pose?.cohesion ?? 1;
  target.set(.025 + .975 * extent ** .8, .025 + .975 * extent, .06 + .94 * thickness);
};

/** First object episode, around Frames 3→4. Absolute story time, not the
 * camera or accumulated HOLD clock, owns these overlapping material states.
 * Growth continues through the castle orbit; later shots retain the mature skin. */
export class MatterStoryState implements MatterStoryPose {
  assembly = 0;
  cohesion = 0;
  compression = 0;
  release = 0;
  wake = 0;

  update(input: number): this {
    const t = Number.isFinite(input) ? Math.max(0, input) : 0;
    // The whole plate grows upward from its lower attachment; thickness lags.
    this.assembly = smootherstep(13, 28, t);
    this.cohesion = smootherstep(14, 30, t);
    this.compression = smootherstep(12, 16, t) * (1 - smootherstep(17, 22, t));
    // The release stretches rooted folds. Dilute matter responds later and
    // settles more slowly; no restart when the source leaves the camera.
    this.release = smootherstep(19, 24, t) * (1 - smootherstep(27, 31, t));
    this.wake = smootherstep(23, 28, t) * (1 - smootherstep(31, 36, t));
    return this;
  }
}
