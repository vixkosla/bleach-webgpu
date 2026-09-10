import * as THREE from 'three/webgpu';
import { BEATS, CITY_DECK_Y, FILM_DURATION, MOON_Y, TOWER_Z } from '../scene/constants';
import { pulse, smoothstep } from '../utils/math';

const CITY_TIMES = new Float32Array([0, 2.8, 4.8, 6.4, 7.8, 9.4, 12.2]);
const ACTION_TIMES = new Float32Array([12.2, 15.15, 17.8, 21.8, 26]);
const STORY_TIMES = new Float32Array([0, 2.8, 4.8, 6.4, 7.8, 9.4, 12.2, 15.15, 17.8, 21.8, 26]);

// The processional avenue is the only generator-independent negative space:
// local z 76..620 becomes world z -44..500 after the city group offset. The
// camera uses it for the eye-level approach, but never runs all the way into
// the citadel plinth. It then cranes up and arcs east, keeping the entire
// stepped castle readable against the roofs instead of turning masonry into a
// full-frame wall.
const CITY_POSITIONS = new Float32Array([
  0, CITY_DECK_Y + 4.0, TOWER_Z + 470,
  0, CITY_DECK_Y + 4.8, TOWER_Z + 420,
  0, CITY_DECK_Y + 5.5, TOWER_Z + 375,
  0, CITY_DECK_Y + 7.0, TOWER_Z + 330,
  120, CITY_DECK_Y + 88, TOWER_Z + 275,
  260, CITY_DECK_Y + 148, TOWER_Z + 220,
  380, CITY_DECK_Y + 208, TOWER_Z + 160,
]);

const ACTION_POSITIONS = new Float32Array([
  380, CITY_DECK_Y + 208, TOWER_Z + 160,
  330, CITY_DECK_Y + 218, TOWER_Z + 148,
  18, CITY_DECK_Y + 88, 42,
  54, CITY_DECK_Y + 105, 92,
  2, CITY_DECK_Y + 105, 166,
]);

const TARGETS = new Float32Array([
  0, CITY_DECK_Y + 5.4, TOWER_Z + 420,
  0, CITY_DECK_Y + 6.6, TOWER_Z + 370,
  0, CITY_DECK_Y + 8.0, TOWER_Z + 325,
  0, CITY_DECK_Y + 16, TOWER_Z + 240,
  0, CITY_DECK_Y + 52, TOWER_Z + 38,
  0, CITY_DECK_Y + 98, TOWER_Z,
  0, CITY_DECK_Y + 112, TOWER_Z,
  0, CITY_DECK_Y + 70, TOWER_Z,
  0, MOON_Y, TOWER_Z,
  0, CITY_DECK_Y + 148, TOWER_Z,
  0, CITY_DECK_Y + 158, TOWER_Z,
]);

const FOV = new Float32Array([68, 64, 60, 56, 52, 48, 46, 48, 44, 49, 52]);
// Focus follows the perceived hero of each beat: title -> street contact ->
// tower -> crown charge -> moon -> deep architectural reveal. Range controls
// how much space remains acceptably sharp around that plane.
const FOCUS_DISTANCE = new Float32Array([65, 60, 45, 48, 40, 70, 150, 145, 185, 224, 291]);
const FOCUS_RANGE = new Float32Array([18, 24, 28, 34, 42, 52, 72, 45, 55, 88, 120]);
const BOKEH_SCALE = new Float32Array([0.55, 0.46, 0.36, 0.32, 0.28, 0.24, 0.3, 0.65, 0.5, 0.25, 0.16]);

export class CinematicDirector {
  readonly duration = FILM_DURATION;
  focusDistance = FOCUS_DISTANCE[0] ?? 82;
  focusRange = FOCUS_RANGE[0] ?? 16;
  bokehScale = BOKEH_SCALE[0] ?? 0.6;

  private readonly cityPositionTrack = new THREE.LinearInterpolant(CITY_TIMES, CITY_POSITIONS, 3);
  private readonly actionPositionTrack = new THREE.CubicInterpolant(ACTION_TIMES, ACTION_POSITIONS, 3);
  private readonly targetTrack = new THREE.CubicInterpolant(STORY_TIMES, TARGETS, 3);
  private readonly fovTrack = new THREE.CubicInterpolant(STORY_TIMES, FOV, 1);
  private readonly focusDistanceTrack = new THREE.CubicInterpolant(STORY_TIMES, FOCUS_DISTANCE, 1);
  private readonly focusRangeTrack = new THREE.CubicInterpolant(STORY_TIMES, FOCUS_RANGE, 1);
  private readonly bokehScaleTrack = new THREE.CubicInterpolant(STORY_TIMES, BOKEH_SCALE, 1);
  private readonly lookTarget = new THREE.Vector3();

  constructor(private readonly camera: THREE.PerspectiveCamera) {}

  update(time: number): void {
    const clamped = Math.max(0, Math.min(FILM_DURATION, time));
    const positionResult = clamped <= (CITY_TIMES[CITY_TIMES.length - 1] ?? 12.2)
      ? this.cityPositionTrack.evaluate(clamped)
      : this.actionPositionTrack.evaluate(clamped);
    const targetResult = this.targetTrack.evaluate(clamped);
    const fovResult = this.fovTrack.evaluate(clamped);
    const focusDistanceResult = this.focusDistanceTrack.evaluate(clamped);
    const focusRangeResult = this.focusRangeTrack.evaluate(clamped);
    const bokehScaleResult = this.bokehScaleTrack.evaluate(clamped);

    const recoil = pulse(BEATS.impact + 0.16, 0.52, clamped);
    const decay = 1 - smoothstep(BEATS.impact, BEATS.impact + 1.8, clamped);
    const shake = recoil * decay;
    this.camera.position.set(
      (positionResult[0] ?? 0) + Math.sin(clamped * 92) * 0.34 * shake,
      (positionResult[1] ?? 0) + Math.sin(clamped * 77 + 1.2) * 0.24 * shake,
      (positionResult[2] ?? 0) + Math.sin(clamped * 61 + 2.7) * 0.18 * shake,
    );

    this.lookTarget.set(
      targetResult[0] ?? 0,
      targetResult[1] ?? 0,
      targetResult[2] ?? 0,
    );
    this.camera.lookAt(this.lookTarget);

    const fov = (fovResult[0] ?? 50) + recoil * 2.8;
    if (Math.abs(this.camera.fov - fov) > 0.001) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }

    this.focusDistance = Math.max(1, focusDistanceResult[0] ?? 82);
    this.focusRange = Math.max(8, focusRangeResult[0] ?? 24);
    this.bokehScale = Math.max(0, Math.min(0.85, bokehScaleResult[0] ?? 0.4));
  }
}
