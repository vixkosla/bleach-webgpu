import { smootherstep } from '../utils/math';

export interface MatterStoryPose {
  assembly: number;
  cohesion: number;
  compression: number;
  release: number;
  wake: number;
}

/** First object episode, around Frames 3→4. Absolute story time, not the
 * camera or accumulated HOLD clock, owns these overlapping material states.
 * Later shots return exactly to the existing mature material at t=26. */
export class MatterStoryState implements MatterStoryPose {
  assembly = 0;
  cohesion = 0;
  compression = 0;
  release = 0;
  wake = 0;

  update(input: number): this {
    const t = Number.isFinite(input) ? Math.max(0, input) : 0;
    // Gathering travels around the source; optical thickness catches up.
    this.assembly = smootherstep(12.5, 17.5, t);
    this.cohesion = smootherstep(13.5, 18, t);
    this.compression = smootherstep(12, 14.8, t) * (1 - smootherstep(15, 18.5, t));
    // The release stretches rooted folds. Dilute matter responds later and
    // settles more slowly; no restart when the source leaves the camera.
    this.release = smootherstep(16, 19, t) * (1 - smootherstep(20, 23.5, t));
    this.wake = smootherstep(18.5, 21.5, t) * (1 - smootherstep(22, 26, t));
    return this;
  }
}
