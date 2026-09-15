import { smootherstep } from '../utils/math';

// Keep the same corridor and easing, but complete frame travel twice as fast.
const TRANSITION_SPEED = 2;

/** Transition clock and shutter envelope. Story time drives weather only;
 * FrameFlight owns the independent spatial camera corridor. */
export class FrameTransition {
  active = false;
  time = 0;
  amount = 0;
  push = 0;
  progress = 1;
  duration = 0;
  private from = 0;
  private to = 0;
  private elapsed = 0;
  private launchAmount = 0;
  private launchPush = 0;

  /** Sample the immediate travel direction, bounded by the requested stop. */
  get lookAheadTime(): number {
    const remaining = this.to - this.time;
    const lead = .35 + Math.min(1.25, Math.abs(this.to - this.from) * .06);
    return this.time + Math.sign(remaining) * Math.min(Math.abs(remaining), lead);
  }

  start(from: number, to: number, reducedMotion = false, initialAmount = 0, initialPush = initialAmount, travelDistance?: number): void {
    this.launchAmount = Math.max(0, Math.min(1, initialAmount));
    this.launchPush = Math.max(0, Math.min(1, initialPush));
    this.from = this.time = from; this.to = to; this.elapsed = 0;
    this.duration = reducedMotion ? 0 : (travelDistance === undefined
      ? 2 + Math.min(1.2, Math.abs(to - from) * .075)
      : 1.65 + Math.min(1.35, travelDistance / 1100)) / TRANSITION_SPEED;
    this.active = (Math.abs(to - from) > .001 || (travelDistance ?? 0) > .01) && !reducedMotion;
    this.progress = this.active ? 0 : 1; this.amount = this.active ? this.launchAmount : 0;
    this.push = this.active ? this.launchPush : 0;
    if (!this.active) this.time = to;
  }

  update(delta: number): number {
    if (!this.active) return this.time;
    this.elapsed += Math.max(0, Math.min(.1, Number.isFinite(delta) ? delta : 0));
    const p = this.progress = Math.min(1, this.elapsed / this.duration);
    const eased = Math.max(0, Math.min(1, smootherstep(0, 1, p)));
    this.time = this.from + (this.to - this.from) * eased;
    // Hold the forward push and colour trails through the long middle.
    // Recover the final lens while the shutter still smears, then resolve.
    this.amount = (this.launchAmount + (1 - this.launchAmount) * smootherstep(0, .20, p)) * (1 - smootherstep(.80, 1, p));
    this.push = (this.launchPush + (1 - this.launchPush) * smootherstep(0, .24, p)) * (1 - smootherstep(.66, .93, p));
    if (p >= 1) { this.time = this.to; this.active = false; this.amount = this.push = 0; }
    return this.time;
  }

  cancel(): void { this.active = false; this.amount = this.push = 0; this.progress = 1; }
}
