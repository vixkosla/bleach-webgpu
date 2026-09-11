import * as THREE from 'three/webgpu';
import type { UpperEventLayout } from '../scene/upperEvent';
import { CITY_DECK_Y, TOWER_Z } from '../scene/constants';
import { CitadelOverview } from './CitadelOverview';
import { smootherstep } from '../utils/math';
import { SceneStoryState, SCENE_STORY_DURATION, SCENE_STORY_BEATS, SCENE_STORY_INTRO } from './SceneStoryState';

export const SCENE_TOUR_DURATION = SCENE_STORY_DURATION;
export const SCENE_TOUR_BEATS = SCENE_STORY_BEATS;
export const SCENE_TOUR_FRAMES = [
  { time: 0, name: 'Ночной город' },
  { time: 7, name: 'В улице' },
  { time: 12.8, name: 'Взгляд на замок' },
  { time: 16.5, name: 'Цитадель снизу' },
  { time: 22, name: 'Боковой фасад' },
  { time: 26, name: 'Террасы' },
  { time: 38, name: 'Белое небо' },
  { time: 48, name: 'Гетсуга' },
  { time: 62, name: 'Цитадель и Гетсуга' },
  { time: 76, name: 'Парящий город' },
] as const;
// Kept for existing review consumers. There are no edits or camera cuts.
export const SCENE_STORY_CUTS: readonly number[] = [];
const track = (times: Float32Array, values: number[], size: number) =>
  new THREE.CubicInterpolant(times, new Float32Array(values), size);

/** One continuous take. Establish the city, turn down into its street, race
 * east through the cross street, then turn left back toward the citadel into
 * the processional avenue, follow the changing citadel and rise with its light.
 * Acceleration and a fast look turn provide the edit; no pose is teleported. */
export class SceneTourDirector {
  readonly duration = SCENE_TOUR_DURATION;
  readonly target = new THREE.Vector3();
  readonly state = new SceneStoryState();
  readonly shot = 0;
  private readonly positionTrack;
  private readonly targetTrack;
  private readonly lensTrack;
  private readonly rollTrack;
  private readonly displacement = new THREE.Vector3();
  private readonly direction = new THREE.Vector3();
  private readonly streetForward = new THREE.Vector3(1, .035, 0).normalize();
  private readonly moonCenter: THREE.Vector3;
  private readonly moonRadius: number;
  private readonly overview: CitadelOverview;

  constructor(private readonly camera: THREE.PerspectiveCamera, layout: UpperEventLayout) {
    this.overview = new CitadelOverview(layout);
    this.moonCenter = layout.center.clone(); this.moonRadius = layout.radius;
    const y = CITY_DECK_Y, z = TOWER_Z, c = layout.crown.y, m = layout.center.y;
    const times = new Float32Array([-4,-2.5,-1.3,0,2,4,5.2,5.65,6.2,7.5,8.8,10.2,12.5,15,18,22,26,30,34,39,44]);
    // The existing middle-transverse is z=385 local; its junction with the
    // 16m-wide processional leaves physical room for the left-hand turn.
    this.positionTrack = track(times, [
      -440,y+280,z+600, -400,y+100,z+430, -345,y+30,z+385,
      -280,y+12,z+385, -220,y+12,z+385, -100,y+14,z+385,
      -28,y+14,z+385, -7,y+14,z+383, 0,y+16,z+370,
      0,y+24,z+335, 0,y+48,z+320, 28,y+106,z+335,
      12,y+135,z+365, 230,c-130,z+225, 370,c+20,z-20,
      260,c+225,z-270, 420,m+125,z-130, 360,m+260,z+170,
      155,m+440,z+435, 120,m+90,z+630, 100,c-150,z+710,
    ], 3);
    this.targetTrack = track(times, [
      -7,c*.60,z, 0,y+110,z, 0,y+90,z,
      0,y+80,z, 0,y+80,z, 0,y+90,z,
      0,y+100,z, 0,y+105,z, 0,y+110,z,
      0,y+170,z, -7,c-140,z, -7,c-45,z,
      -7,c-170,z, -7,c-140,z, -7,c-105,z,
      -7,c-100,z, -7,m-90,z, -7,m-55,z,
      -7,m+6,z, -7,m+35,z, -7,c+120,z,
    ], 3);
    this.lensTrack = track(times, [68,70,70,70,70,76,78,78,76,74,72,74,68,64,64,70,78,74,66,72,72], 1);
    this.rollTrack = track(times, [0,-1.5,-.6,0,0,-.3,-.7,2.5,1.3,0,-.5,-1.3,1,0,-1.8,-1,1.2,.4,0,0,0], 1);
  }

  update(input: number): void {
    const storyTime = this.state.update(input).time;
    const elapsed = Math.min(48, storyTime) - SCENE_STORY_INTRO;
    const tail = Math.max(0, (elapsed - 40) / 4);
    const t = elapsed <= 40 ? elapsed : 40 + 4 * (tail + tail * tail - tail * tail * tail);
    this.camera.position.fromArray(this.positionTrack.evaluate(t));
    this.target.fromArray(this.targetTrack.evaluate(t));
    // First turn from the overall castle view into the street. Hold its
    // forward direction until the junction, then look left back to the castle.
    // Both turns blend direction continuously on the same position track.
    if (t < 6.4) {
      const street = smootherstep(-3, -.7, t) * (1 - smootherstep(5.15, 6.4, t));
      const distance = this.camera.position.distanceTo(this.target);
      this.direction.copy(this.target).sub(this.camera.position).normalize()
        .lerp(this.streetForward, street).normalize();
      this.target.copy(this.camera.position).addScaledVector(this.direction, distance + (200 - distance) * street);
    }
    const lens = this.lensTrack.evaluate(t)[0]!;
    const tangent = Math.tan(THREE.MathUtils.degToRad(lens) * .5);
    const aspect = Math.max(.25, this.camera.aspect);
    let fov = Math.min(96, THREE.MathUtils.radToDeg(2 * Math.atan(tangent / Math.min(1, aspect))));
    this.displacement.copy(this.camera.position).sub(this.target);
    const reveal = smootherstep(27, 33, t);
    if (reveal > 0) {
      const halfAngle = Math.atan(Math.tan(THREE.MathUtils.degToRad(fov) * .5) * Math.min(1, aspect));
      const required = (this.moonRadius + this.target.distanceTo(this.moonCenter)) * 1.07 / Math.sin(halfAngle);
      this.displacement.multiplyScalar(1 + Math.max(0, required / this.displacement.length() - 1) * reveal);
    }
    this.camera.position.copy(this.target).add(this.displacement);
    if (storyTime > 48) {
      this.overview.sample(smootherstep(62, 76, storyTime), aspect);
      const revealAll = smootherstep(48, 62, storyTime);
      this.camera.position.lerp(this.overview.position, revealAll);
      this.target.lerp(this.overview.target, revealAll);
      fov += (this.overview.fov - fov) * revealAll;
    }
    this.camera.up.set(0, 1, 0); this.camera.lookAt(this.target);
    this.camera.rotateZ(THREE.MathUtils.degToRad(this.rollTrack.evaluate(t)[0]!));
    if (Math.abs(this.camera.fov - fov) > .001) {
      this.camera.fov = fov; this.camera.updateProjectionMatrix();
    }
    this.camera.updateMatrixWorld(true);
  }
}
