import * as THREE from 'three/webgpu';
import type { UpperEventLayout } from '../scene/upperEvent';
import { CITY_DECK_Y, TOWER_Z } from '../scene/constants';
import { CitadelOverview } from './CitadelOverview';
import { createUpperInspectionPreset } from './upperInspection';
import { pulse, smoothstep, smootherstep } from '../utils/math';
import { SceneStoryState, SCENE_STORY_DURATION, SCENE_STORY_BEATS, SCENE_STORY_INTRO } from './SceneStoryState';
import { MatterStoryState, writeMatterGrowth } from './MatterStoryState';

export const SCENE_TOUR_DURATION = SCENE_STORY_DURATION;
export const SCENE_TOUR_BEATS = SCENE_STORY_BEATS;
// Held Frames are distinct story moments. Transit poses (the second castle
// approach, fog-covered terraces and the first overview) stay in the flight.
export const SCENE_TOUR_FRAMES = [
  { time: 0, name: 'Ночной город' },
  { time: 7, name: 'В улице' },
  { time: 16.5, name: 'Пробуждение Гетсуги' },
  { time: 22, name: 'Вдоль стен' },
  { time: 38, name: 'Над бурей' },
  { time: 54, name: 'Цитадель и луна' },
  { time: 66, name: 'Парящий город' },
] as const;
// Kept for existing review consumers. There are no edits or camera cuts.
export const SCENE_STORY_CUTS: readonly number[] = [];
const track = (times: Float32Array, values: number[], size: number) =>
  new THREE.CubicInterpolant(times, new Float32Array(values), size);

/** One continuous take. Establish the city, turn down into its street, race
 * east through the cross street, then turn left back toward the citadel into
 * the processional avenue. Climb the keep's eastern buttresses and rear terraces,
 * cross the lunar flank, crest through white sky, then dive outside the city's
 * right side to regain the saved citadel-and-moon view before the island reveal.
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
  private readonly matterStory = new MatterStoryState();
  private readonly matterGrowth = new THREE.Vector3();
  private readonly birthSubject = new THREE.Vector3();
  private readonly fitPoint = new THREE.Vector3();
  private readonly fitForward = new THREE.Vector3();
  private readonly fitRight = new THREE.Vector3();
  private readonly fitUp = new THREE.Vector3();
  private readonly streetForward = new THREE.Vector3(1, .035, 0).normalize();
  private readonly moonCenter: THREE.Vector3;
  private readonly moonRadius: number;
  private readonly overview: CitadelOverview;
  private readonly homeReference;
  private homeView;
  private homeAspect = 1;

  constructor(private readonly camera: THREE.PerspectiveCamera, private readonly layout: UpperEventLayout) {
    this.overview = new CitadelOverview(layout);
    const home = this.homeReference = this.homeView = createUpperInspectionPreset(layout, 1);
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
      // Return along the right facade to the original main-page composition,
      // then draw back to reveal the island. The saved pose lands at54s.
      130,c-185,z+610, 128,c-226,z+480, ...home.position,
      110,c-240,z+490, 80,c-255,z+820, 0,c-280,z+1200,
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
      -7,c+30,z, -7,c-10,z, ...home.target,
      -7,c-40,z, -7,c-140,z, -7,y+100,z,
    ], 3);
    this.lensTrack = track(times, [68,70,70,70,70,76,78,78,76,74,72,74,68,
      63,62,65,69,66,73,79,82,76,69,66,72,75,74,72,76,79,80,80,78,76], 1);
    this.rollTrack = track(times, [0,-1.5,-.6,0,-1,-3,-4,7,3,0,-1,-2,1,
      -7,-11,-8,-3,4,9,11,7,-4,-9,-5,4,9,5,0,-3,-1,0,1,2,0], 1);
  }

  /** Held compositions can breathe independently of the continuous Cinema track. */
  updateFrame(time: number): void {
    this.update(time);
    if (Math.abs(time - 22) < .001) {
      this.camera.position.sub(this.target).multiplyScalar(1.16).add(this.target);
      this.camera.updateMatrixWorld(true);
    }
    if (Math.abs(time - 38) < .001) {
      // Descend beneath the old high perch: the moon meets the upper edge
      // while more of the city opens below. Keep a small contour allowance.
      this.camera.position.y -= 130;
      this.target.y -= 130;
      // Swing east (+X) and descend around the existing look pivot.
      // A fixed-radius arc gives the lower, slightly upward-facing cradle.
      this.direction.subVectors(this.camera.position, this.target);
      const radius = this.direction.length();
      const azimuth = Math.atan2(this.direction.x, this.direction.z) + THREE.MathUtils.degToRad(14);
      const elevation = Math.asin(this.direction.y / radius) - THREE.MathUtils.degToRad(7);
      this.direction.set(Math.sin(azimuth) * Math.cos(elevation), Math.sin(elevation), Math.cos(azimuth) * Math.cos(elevation));
      this.camera.position.copy(this.target).addScaledVector(this.direction, radius);
      this.target.y += 7;
      this.camera.lookAt(this.target);
      this.camera.rotateZ(THREE.MathUtils.degToRad(-5));
      // Portrait has a taller lens. Match the same upper-edge composition
      // by pitching down, without moving the moon or changing the storm.
      const pitch = Math.atan(.89 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov * .5)))
        - Math.atan(.89 * Math.tan(THREE.MathUtils.degToRad(33)));
      if (pitch > 0) {
        const distance = this.camera.position.distanceTo(this.target);
        this.camera.rotateX(-pitch);
        this.camera.getWorldDirection(this.direction);
        this.target.copy(this.camera.position).addScaledVector(this.direction, distance);
      }
      this.camera.updateMatrixWorld(true);
    }
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
    // Hand attention from the spire to the ACTUAL growing plate before it
    // emerges. Keep the castle's orbit as foreground, not the sole actor.
    // Aim follows the same rooted growth as the volume, not the final moon
    // center floating far above a small newly born body.
    writeMatterGrowth(this.matterStory.update(storyTime), this.matterGrowth);
    this.birthSubject.set(.25 * this.matterGrowth.x, this.matterGrowth.y - 1, 0)
      .multiplyScalar(this.moonRadius).applyQuaternion(this.layout.orientation).add(this.moonCenter);
    const attention = smootherstep(11.5, 14, storyTime)
      * (.96 - .20 * smootherstep(18, 23, storyTime))
      * (1 - smootherstep(27, 31, storyTime));
    this.target.lerp(this.birthSubject, attention);
    const lens = this.lensTrack.evaluate(t)[0]!;
    const tangent = Math.tan(THREE.MathUtils.degToRad(lens) * .5);
    const aspect = Math.max(.25, this.camera.aspect);
    let fov = Math.min(96, THREE.MathUtils.radToDeg(2 * Math.atan(tangent / Math.min(1, aspect))));
    // Include a 4:3 tablet in landscape: it also loses the wide shot's
    // side allowance, despite not being a portrait viewport.
    const portrait = 1 - smoothstep(1.35, 1.5, aspect);
    const framing = portrait * smootherstep(11.5, 14.5, storyTime)
      * (1 - smootherstep(28, 37, storyTime));
    // Phone: a calmer 72° vertical lens; portrait tablet: up to 80°.
    // Fit the subject with camera distance, not a very wide vertical lens
    // that leaves the newborn plate tiny in a tall empty sky.
    fov += (Math.min(fov, 72 + 8 * smoothstep(.5, 1, aspect)) - fov) * framing;
    const roll = THREE.MathUtils.degToRad(this.rollTrack.evaluate(t)[0]! * (1 - smootherstep(56, 60, storyTime)));
    this.displacement.copy(this.camera.position).sub(this.target);
    const reveal = smootherstep(27, 33, t) * (1 - smootherstep(44, 48, t));
    if (reveal > 0) {
      const halfAngle = Math.atan(Math.tan(THREE.MathUtils.degToRad(fov) * .5) * Math.min(1, aspect));
      const required = (this.moonRadius + this.target.distanceTo(this.moonCenter)) * 1.07 / Math.sin(halfAngle);
      this.displacement.multiplyScalar(1 + Math.max(0, required / this.displacement.length() - 1) * reveal);
    }
    this.camera.position.copy(this.target).add(this.displacement);
    if (framing > 0) {
      this.fitForward.subVectors(this.target, this.camera.position).normalize();
      this.fitUp.set(0, 1, 0);
      this.fitRight.crossVectors(this.fitForward, this.fitUp).normalize();
      this.fitUp.crossVectors(this.fitRight, this.fitForward);
      const half = Math.tan(THREE.MathUtils.degToRad(fov) * .5) * .90;
      const cos = Math.cos(roll), sin = Math.sin(roll);
      let retreat = 0;
      // Eight corners protect the evolving plate's width AND thickness,
      // including the side view. Also keep the crown and upper keep visible.
      for (let i = 0; i < 10; i++) {
        if (i < 8) this.fitPoint.set((i & 1 ? 1 : -1) * this.matterGrowth.x,
          (i & 2 ? 1 : -1) * this.matterGrowth.y + this.matterGrowth.y - 1,
          (i & 4 ? .3 : -.3) * this.matterGrowth.z)
          .multiplyScalar(this.moonRadius).applyQuaternion(this.layout.orientation).add(this.moonCenter);
        else this.fitPoint.copy(this.layout.crown).addScaledVector(this.camera.up, i === 8 ? 0 : -90);
        this.fitPoint.sub(this.camera.position);
        const x = this.fitPoint.dot(this.fitRight), y = this.fitPoint.dot(this.fitUp);
        const depth = this.fitPoint.dot(this.fitForward);
        retreat = Math.max(retreat, Math.abs(x * cos + y * sin) / (half * aspect) - depth,
          Math.abs(y * cos - x * sin) / half - depth);
      }
      this.camera.position.addScaledVector(this.fitForward,
        -retreat * smootherstep(0, 60, retreat) * framing);
    }
    // Preserve the exact saved right-side pose, including its narrower
    // portrait lens. Cache the aspect adaptation instead of allocating per frame.
    if (aspect !== this.homeAspect) {
      this.homeAspect = aspect;
      this.homeView = createUpperInspectionPreset(this.layout, aspect);
    }
    const homeWeight = smootherstep(48, 54, storyTime) * (1 - smootherstep(54, 62, storyTime));
    this.camera.position.x += (this.homeView.position[0] - this.homeReference.position[0]) * homeWeight;
    this.camera.position.z += (this.homeView.position[2] - this.homeReference.position[2]) * homeWeight;
    this.target.y += (this.homeView.target[1] - this.homeReference.target[1]) * homeWeight;
    fov += (this.homeView.fov - fov) * homeWeight;
    if (storyTime > 54) {
      const orbit = smootherstep(55.5, 66, storyTime) * .62;
      this.overview.sample(orbit * (aspect < .8 ? .55 : 1), aspect, Math.sin(Math.PI * orbit / .62) ** 2 * .05);
      const revealAll = aspect < .8 ? smoothstep(54, 63, storyTime) : smootherstep(54.5, 62, storyTime);
      this.camera.position.lerp(this.overview.position, revealAll);
      this.target.lerp(this.overview.target, revealAll);
      fov += (this.overview.fov - fov) * revealAll;
    }
    this.camera.up.set(0, 1, 0); this.camera.lookAt(this.target);
    this.camera.rotateZ(roll);
    if (Math.abs(this.camera.fov - fov) > .001) {
      this.camera.fov = fov; this.camera.updateProjectionMatrix();
    }
    this.camera.updateMatrixWorld(true);
  }
}
