import { clamp01 } from '../utils/math';

// Film seconds -> authored story seconds. Similar facade/orbit views pass
// quickly; the light's arrival, lunar edge and saved right view have room.
const EDIT = [
  [0,0], [3,4], [4.5,7], [5.3,9.8], [7,12.8], [10,16.5],
  [12.8,22], [14,26], [16.5,30], [18,34], [20,38], [21.6,44],
  [24.5,48], [29,54], [31.5,58], [34,62], [36,66],
] as const;

/** Monotone cubic time map. Camera and weather keep the same authored path;
 * only Cinema's pace changes. Frames/URLs retain their existing story times. */
export class ScenePacing {
  readonly duration = 36;
  private readonly slopes: number[];

  constructor() {
    const h = EDIT.slice(1).map((p,i) => p[0] - EDIT[i]![0]);
    const d = EDIT.slice(1).map((p,i) => (p[1] - EDIT[i]![1]) / h[i]!);
    this.slopes = EDIT.map((_,i) => {
      if (!i) return d[0]!;
      if (i === EDIT.length - 1) return d[i - 1]!;
      const a = 2 * h[i]! + h[i - 1]!, b = h[i]! + 2 * h[i - 1]!;
      return (a + b) / (a / d[i - 1]! + b / d[i]!);
    });
  }

  private sample(input: number, derivative: boolean): number {
    const time = Math.max(0, Math.min(this.duration, Number.isFinite(input) ? input : 0));
    let i = 0;
    while (i < EDIT.length - 2 && time > EDIT[i + 1]![0]) i++;
    const a = EDIT[i]!, b = EDIT[i + 1]!, h = b[0] - a[0], t = (time - a[0]) / h;
    const m = this.slopes[i]!, n = this.slopes[i + 1]!;
    if (derivative) return ((6*t*t-6*t)*a[1] + (-6*t*t+6*t)*b[1]) / h
      + (3*t*t-4*t+1)*m + (3*t*t-2*t)*n;
    return (2*t*t*t-3*t*t+1)*a[1] + (t*t*t-2*t*t+t)*h*m
      + (-2*t*t*t+3*t*t)*b[1] + (t*t*t-t*t)*h*n;
  }

  storyAt(filmTime: number): number { return this.sample(filmTime, false); }

  filmAt(storyTime: number): number {
    if (!(storyTime > 0)) return 0;
    if (storyTime >= 66) return this.duration;
    let lo = 0, hi = this.duration;
    for (let i = 0; i < 26; i++) {
      const mid = (lo + hi) * .5;
      if (this.storyAt(mid) < storyTime) lo = mid; else hi = mid;
    }
    return (lo + hi) * .5;
  }

  rateAt(filmTime: number): number { return this.sample(filmTime, true); }
  rushAt(storyTime: number): number {
    return clamp01((this.rateAt(this.filmAt(storyTime)) - 1.8) / 2.3);
  }
}
