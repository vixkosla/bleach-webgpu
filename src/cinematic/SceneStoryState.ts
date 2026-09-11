import { pulse, smootherstep } from '../utils/math';

export const SCENE_STORY_INTRO = 4;
export const SCENE_STORY_DURATION = 72 + SCENE_STORY_INTRO;
export const SCENE_STORY_BEATS = [
  { time: 0, name: 'Общий план города' },
  { time: 4, name: 'Проход по улице' },
  { time: 9.8, name: 'Поворот к цитадели' },
  { time: 12, name: 'Туман и дальние полосы' },
  { time: 16.5, name: 'Свет Гетсуги' },
  { time: 24, name: 'Боковой фасад' },
  { time: 30, name: 'Террасы с обратной стороны' },
  { time: 38, name: 'Луна в белом небе' },
  { time: 48, name: 'Раскрытие слоёв' },
  { time: 62, name: 'Цитадель и Гетсуга' },
  { time: 76, name: 'Парящий город' },
] as const;

/** Absolute time owns every cue, including advection. Seeking backwards
 * restores the sky without accumulated velocity or random frame state. */
export class SceneStoryState {
  time = 0;
  presence = 0;
  illumination = 0;
  pressure = 0;
  opening = 0;
  whiteSky = 0;
  weather = 0;
  precursor = 0;
  atmosphereLight = 0;
  lightReach = 0;
  cloudOpacity = 0;
  motionTime = 0;
  distantTime = 0;

  update(input: number): this {
    this.time = Math.max(0, Math.min(SCENE_STORY_DURATION, Number.isFinite(input) ? input : 0));
    const t = this.time - SCENE_STORY_INTRO;
    this.presence = smootherstep(10.2, 12.2, t);
    this.illumination = smootherstep(10.6, 14, t)
      * (1 + pulse(12.9, 1.05, t) * .16);
    // The opening streets have clear night sky. A dim local precursor is
    // already gathering at the castle when the camera turns; full weather
    // develops as the source emerges, and then stays illuminated.
    this.precursor = smootherstep(4.6, 8, t);
    this.weather = smootherstep(10.4, 17, t);
    this.atmosphereLight = this.illumination + this.precursor * .12 * (1 - this.illumination);
    this.pressure = smootherstep(6, 11, t) * (1 - smootherstep(13, 18, t));
    this.opening = smootherstep(11, 20, t);
    this.whiteSky = smootherstep(30, 34, t) * (1 - smootherstep(37, 41, t));
    // The crown catches light before the wave reaches the streets.
    this.lightReach = smootherstep(10.4, 17, t) * 1250;
    this.cloudOpacity = this.precursor * .10 * (1 - this.weather) + this.weather * (.9 + this.pressure * .08);
    this.motionTime = this.time * .72 + 16 * smootherstep(4.5, 13, t) + 11 * smootherstep(16, 25, t);
    this.distantTime = this.time * .32 + 3 * smootherstep(8, 20, t);
    return this;
  }
}
