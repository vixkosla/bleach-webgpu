import type { UpperEventController, UpperAtmosphereCue } from '../scene/upperEvent';
import type { createArchitectureGrade } from '../materials/architectureGrade';
import type { createCityHaze } from '../materials/cityHaze';
import type { SceneStoryState } from './SceneStoryState';
import { smootherstep } from '../utils/math';

type Scalar = { value: number };
type Binding = { control: Scalar; initial: number; sample: (state: SceneStoryState) => number };

/** Direct existing weather, without rebuilding meshes or turning the sky into
 * camera-attached effects. Restore every owned control on return to inspection. */
export class SceneAtmosphereDirector {
  private active = false;
  private readonly bindings: Binding[] = [];
  private readonly layerOrigins;
  private readonly motionCue: UpperAtmosphereCue = {
    presence: 0, illumination: 0, atmosphereLight: 0, cloudOpacity: 0, distantTime: 0,
  };

  constructor(
    private readonly upper: UpperEventController,
    grade: ReturnType<typeof createArchitectureGrade>,
    haze: ReturnType<typeof createCityHaze> | null,
  ) {
    const set = (control: Scalar, sample: Binding['sample']) => {
      this.bindings.push({ control, initial: control.value, sample });
    };
    const scale = (control: Scalar, sample: Binding['sample']) => {
      const initial = control.value;
      set(control, s => initial * sample(s));
    };
    const c = upper.clouds.controls, v = upper.clouds.volume.controls;
    set(grade.controls.story, () => 1);
    set(grade.controls.eventLight, s => s.illumination);
    set(grade.controls.lightReach, s => s.lightReach);
    // Keep the passing street surfaces readable before the event lights them.
    scale(grade.controls.exposure, s => 1 + .8 * (1 - Math.min(1, s.illumination)));
    scale(c.canopy, s => s.precursor * .18 + s.weather * .82);
    scale(c.density, s => 1 + s.pressure * .2);
    scale(c.clearingWidth, s => .85 + s.illumination * .15 + s.whiteSky * .12);
    scale(c.clearingLight, s => .5 + s.illumination * .5 + s.whiteSky * .55);
    scale(c.distantLight, s => .2 + s.precursor * .4 + s.illumination * 1.4);
    set(c.distantMist, s => s.precursor * .6 + s.weather * .4);
    // Fixed world banks evolve smoothly through the known path. The high
    // passage lifts their shoulders; the coast descent reveals lower depths.
    set(c.skyDepth, s => s.weather * (.78 + .22 * smootherstep(44, 56, s.time)));
    set(c.skyLift, s => 180 * smootherstep(24, 34, s.time) * (1 - smootherstep(44, 52, s.time)));
    set(c.skyLower, s => .2 + .8 * smootherstep(46, 54, s.time));
    const cloudBase = c.cloudBase.value;
    set(c.cloudBase, s => cloudBase - 40 * s.pressure);
    scale(c.cloudRelief, s => 1 + s.pressure * .4);
    scale(c.royalGlow, s => .08 + s.illumination * .92);
    scale(v.density, s => 1 + s.pressure * .18);
    set(v.bankSpread, s => .1 * s.opening - .025 * s.pressure);
    set(v.centralLift, s => s.opening * .02 - s.pressure * .015);
    set(v.centralFold, s => s.pressure * .7 + s.opening * .85);
    scale(v.centralClouds, s => .82 + s.pressure * .35 + s.opening * .18);
    scale(v.centralLight, s => .25 + s.illumination * .75 + s.whiteSky * .16);
    scale(v.centralRays, s => .05 + s.illumination * .9);
    scale(v.rays, s => .03 + s.illumination * .92);
    scale(v.rayClouds, s => .2 + s.illumination * .8);
    if (haze) {
      scale(haze.controls.glow, s => .7 + s.illumination * .6);
      scale(haze.controls.density, s => (1.9 - Math.min(1, s.illumination) * .55) * (1 - .24 * smootherstep(52, 62, s.time)));
      set(haze.controls.opacityLimit, s => .48 - Math.min(1, s.illumination) * .15 - .09 * smootherstep(52, 62, s.time));
      scale(haze.controls.height, s => 1.3 + s.pressure * .35 - .22 * smootherstep(52, 62, s.time));
      scale(haze.controls.strength, s => 1 + s.weather * .3);
    }
    this.layerOrigins = upper.clouds.layers.map(layer => ({
      offset: layer.offset.value.clone(), density: layer.density.value,
    }));
  }

  update(state: SceneStoryState, lifeTime = 0): void {
    this.active = true;
    for (const binding of this.bindings) binding.control.value = binding.sample(state);
    for (let i = 0; i < this.upper.clouds.layers.length; i++) {
      const layer = this.upper.clouds.layers[i]!, origin = this.layerOrigins[i]!;
      const direction = i % 2 ? -1 : 1;
      // Near strata part faster in opposing directions. The far banks lag,
      // retaining scale; camera parallax and this authored change coexist.
      layer.offset.value.copy(origin.offset);
      layer.offset.value.x += direction * state.opening * (.012 + i * .008);
      layer.offset.value.y += state.pressure * .012 - state.opening * (.006 + i * .004);
      layer.offset.value.z += direction * state.pressure * .006;
      layer.density.value = origin.density * (1 + state.pressure * .1);
    }
    // The page keeps its narrative cue while its existing procedural objects
    // continue evolving. Never advance presence or lighting with the life clock.
    const cue = this.motionCue;
    cue.presence = state.presence; cue.illumination = state.illumination;
    cue.atmosphereLight = state.atmosphereLight; cue.cloudOpacity = state.cloudOpacity;
    cue.distantTime = state.distantTime + lifeTime * .32;
    this.upper.update(21.8, state.motionTime + lifeTime * .72, cue);
  }

  restore(): void {
    if (!this.active) return;
    for (const binding of this.bindings) binding.control.value = binding.initial;
    this.upper.clouds.layers.forEach((layer, i) => {
      layer.offset.value.copy(this.layerOrigins[i]!.offset);
      layer.density.value = this.layerOrigins[i]!.density;
    });
    this.upper.matter.material.opacity = 1;
    this.active = false;
  }
}
