import * as THREE from 'three/webgpu';
import type { UpperEventLayout } from '../scene/upperEvent';
import { CITY_DECK_Y, TOWER_Z } from '../scene/constants';
import { CitadelOverview } from './CitadelOverview';
import { pulse, smootherstep } from '../utils/math';
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
  { time: 30, name: 'У бока луны' },
  { time: 38, name: 'Белое небо' },
  { time: 48, name: 'Гетсуга' },
  { time: 54, name: 'Скала под городом' },
  { time: 62, name: 'Цитадель и Гетсуга' },
  { time: 76, name: 'Парящий город' },
] as const;
// Kept for existing review consumers. There are no edits or camera cuts.
export const SCENE_STORY_CUTS: readonly number[] = [];
const track = (times: Float32Array, values: number[], size: number) =>
  new THREE.CubicInterpolant(times, new Float32Array(values), size);

/** One continuous take. Establish the city, turn down into its street, race
 * east through the cross street, then turn left back toward the citadel into
 * the processional avenue. Climb the keep's eastern buttresses and rear terraces,
 * cross the lunar flank, crest through white sky, then dive outside the city's
 * coast to show its suspended rock before the rising full-scale reveal.
 * Position, subject aim, bank and lens are sampled together with no cuts. */
export class SceneTourDirector {
  readonly duration = SCENE_TOUR_DURATION;
  readonly target = new THREE.Vector3();
  readonly state = new SceneStoryState();
  readonly shot = 0;
  motionSmear = 0;
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
    const times = new Float32Array([-4,-2.5,-1.3,0,2,4,5.2,5.65,6.2,7.5,8.8,10.2,12.5,14,16,18,20,22,24,26,28,30,32,34,36,39,42,44,46,48,50,52,55,58]);
    // The existing middle-transverse is z=385 local; its junction with the
    // 16m-wide processional leaves physical room for the left-hand turn.
    this.positionTrack = track(times, [
      -440,y+280,z+600, -400,y+100,z+430, -345,y+30,z+385,
      -280,y+12,z+385, -220,y+12,z+385, -100,y+14,z+385,
      -28,y+14,z+385, -7,y+14,z+383, 0,y+16,z+370,
      0,y+24,z+335, 0,y+48,z+320, 28,y+106,z+335,
      12,y+135,z+365,
      // Lean into the eastern buttress, then climb around the rear terraces.
      150,c-205,z+255, 280,c-90,z+70, 315,c-5,z-115,
      200,c+40,z-290, -15,c+100,z-365, -220,c+190,z-300,
      // The crown gives way to the lunar body. Cross its dark flank before
      // cresting into white sky: foreground depth produces the colour change.
      -340,m-25,z-90, -320,m+145,z+135, -230,m+300,z+335,
      -30,m+420,z+410, 155,m+440,z+435, 265,m+290,z+470,
      245,m+65,z+580, 155,c-10,z+655, 100,c-150,z+710,
      // Descend outside the city rim and expose the fractured stone under it.
      -130,y+190,z+960, -510,y+65,z+990, -865,y-30,z+790,
      -1140,y+45,z+900, -1170,y+220,z+1230, -850,y+370,z+1750,
    ], 3);
    this.targetTrack = track(times, [
      -7,c*.60,z, 0,y+110,z, 0,y+90,z,
      0,y+80,z, 0,y+80,z, 0,y+90,z,
      0,y+100,z, 0,y+105,z, 0,y+110,z,
      0,y+170,z, -7,c-140,z, -7,c-45,z,
      -7,c-170,z,
      30,c-150,z+20, 0,c-95,z, -7,c-100,z,
      -25,c-90,z, -35,c-70,z, -20,c-30,z,
      -7,m-115,z, -7,m-65,z, -7,m-40,z,
      -7,m,z, -7,m+6,z, -7,m+25,z,
      -7,m+35,z, -7,c+180,z, -7,c+120,z,
      -70,c-40,z+80, -135,y+40,z+230, -220,y-95,z+340,
      -140,y+70,z+110, -30,c-240,z+30, -7,y,z,
    ], 3);
    this.lensTrack = track(times, [68,70,70,70,70,76,78,78,76,74,72,74,68,
      63,62,65,69,66,73,79,82,76,69,66,72,75,74,72,76,79,78,73,66,58], 1);
    this.rollTrack = track(times, [0,-1.5,-.6,0,-1,-3,-4,7,3,0,-1,-2,1,
      -7,-11,-8,-3,4,9,11,7,-4,-9,-5,4,9,5,0,-8,-12,-7,4,7,0], 1);
  }

  update(input: number): void {
    const storyTime = this.state.update(input).time;
    // Accented only during playing Cinema; held Frames retain full detail.
    this.motionSmear = .10 * pulse(9.65, .72, storyTime)
      + .035 * pulse(19.9, 2.1, storyTime) + .05 * pulse(31, 2.4, storyTime)
      + .065 * pulse(49.5, 2, storyTime) + .05 * pulse(58, 2, storyTime);
    const t = Math.min(62, storyTime) - SCENE_STORY_INTRO;
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
    const reveal = smootherstep(27, 33, t) * (1 - smootherstep(44, 48, t));
    if (reveal > 0) {
      const halfAngle = Math.atan(Math.tan(THREE.MathUtils.degToRad(fov) * .5) * Math.min(1, aspect));
      const required = (this.moonRadius + this.target.distanceTo(this.moonCenter)) * 1.07 / Math.sin(halfAngle);
      this.displacement.multiplyScalar(1 + Math.max(0, required / this.displacement.length() - 1) * reveal);
    }
    this.camera.position.copy(this.target).add(this.displacement);
    if (storyTime > 54.5) {
      const orbit = smootherstep(58, 76, storyTime);
      this.overview.sample(orbit, aspect, Math.sin(Math.PI * orbit) ** 2 * .4);
      const revealAll = smootherstep(54.5, 62, storyTime);
      this.camera.position.lerp(this.overview.position, revealAll);
      this.target.lerp(this.overview.target, revealAll);
      fov += (this.overview.fov - fov) * revealAll;
    }
    this.camera.up.set(0, 1, 0); this.camera.lookAt(this.target);
    this.camera.rotateZ(THREE.MathUtils.degToRad(this.rollTrack.evaluate(t)[0]! * (1 - smootherstep(58, 62, storyTime))));
    if (Math.abs(this.camera.fov - fov) > .001) {
      this.camera.fov = fov; this.camera.updateProjectionMatrix();
    }
    this.camera.updateMatrixWorld(true);
  }
}
