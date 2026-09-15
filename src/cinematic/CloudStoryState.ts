import { clamp01, smootherstep } from '../utils/math';

// Broad, unequal shoulders outside the open face; deliberately no particle ring.
export const CLOUD_STORY_CELLS = [
  { center: [-1.9, -.45, -.55], extent: [1.05, .55, .43], drift: [-.42, .30, -.06], start: 12.3, period: 15.5 },
  { center: [-1.25, 1.05, -.65], extent: [.92, .62, .45], drift: [-.22, .48, .03], start: 13.2, period: 18.3 },
  { center: [.70, 1.28, -.65], extent: [1.12, .46, .46], drift: [.42, .26, -.08], start: 14.3, period: 17.4 },
  { center: [1.65, -.20, -.52], extent: [.73, .84, .43], drift: [.45, .32, .02], start: 12.8, period: 19.7 },
  { center: [-2.45, .48, -.85], extent: [1.32, .62, .53], drift: [-.42, .22, -.05], start: 15.8, period: 21.2 },
  { center: [.40, -1.42, -.65], extent: [1.35, .39, .40], drift: [.32, -.16, .03], start: 16.7, period: 22.8 },
] as const;

/** Spatial condensation/erosion, not a repeating opacity pulse. Empty at both
 * ends of each cycle, so rewinding or wrapping cannot teleport visible matter. */
export class CloudStoryState {
  readonly cells = CLOUD_STORY_CELLS.map(() => ({ age: 0, growth: 0, erosion: 1, drift: 0 }));
  update(input: number): this {
    const time = Number.isFinite(input) ? Math.max(0, input) : 0;
    CLOUD_STORY_CELLS.forEach((spec, i) => {
      const cell = this.cells[i]!;
      const age = time < spec.start ? 0 : ((time - spec.start) % spec.period) / spec.period;
      cell.age = age;
      cell.growth = smootherstep(.02, .43, age);
      cell.erosion = 1 - smootherstep(.02, .28, age) + smootherstep(.55, .98, age);
      cell.drift = clamp01(smootherstep(0, 1, age));
    });
    return this;
  }
}
