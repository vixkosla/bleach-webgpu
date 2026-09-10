import { FILM_DURATION } from '../scene/constants';
import { smootherstep } from '../utils/math';

type CaptionPlacement = 'lower-left' | 'upper-right' | 'lower-right';

interface CaptionCue {
  start: number;
  // Explicit fade windows (Codex deterministic-titles spec): the cue is at
  // full opacity between fadeInEnd and fadeOutStart, and fully gone outside
  // [start, end]. Reverse scrubbing stays deterministic because the envelope
  // is a pure function of time.
  fadeInEnd: number;
  fadeOutStart: number;
  end: number;
  kicker: string;
  line: string;
  placement: CaptionPlacement;
}

interface TitleDirectorElements {
  intro: HTMLElement;
  captions: HTMLElement;
  kicker: HTMLElement;
  line: HTMLElement;
}

const CAPTION_CUES: readonly CaptionCue[] = [
  {
    start: 4.8,
    fadeInEnd: 5.12,
    fadeOutStart: 5.72,
    end: 6.05,
    kicker: 'ARCHITECTURE STUDY',
    line: 'MONUMENTAL CITY FORMS',
    placement: 'lower-left',
  },
  {
    start: 7.2,
    fadeInEnd: 7.55,
    fadeOutStart: 8.58,
    end: 8.95,
    kicker: 'TYPEGPU NODE MATERIALS',
    line: 'STONE / LIGHT / SHADOW',
    placement: 'upper-right',
  },
  {
    start: 18.25,
    fadeInEnd: 18.6,
    fadeOutStart: 19.38,
    end: 19.75,
    kicker: 'CINEMATIC FOCUS PASS',
    line: 'DEPTH / SCALE / REVEAL',
    placement: 'lower-left',
  },
  {
    // Final credit holds at full opacity through exactly t=26 (FILM_DURATION).
    // The fade-out window sits just past the end of the film so the envelope
    // never dips before the final frame.
    start: 22.55,
    fadeInEnd: 23.15,
    fadeOutStart: FILM_DURATION + 0.001,
    end: FILM_DURATION + 0.001,
    kicker: 'A WEBGPU STUDY BY',
    line: 'sonicxboy.dev',
    placement: 'lower-right',
  },
] as const;

const cueEnvelope = (cue: CaptionCue, time: number): number => {
  const fadeIn = smootherstep(cue.start, cue.fadeInEnd, time);
  const fadeOut = 1 - smootherstep(cue.fadeOutStart, cue.end, time);
  return fadeIn * fadeOut;
};

export interface TitleDirector {
  update: (time: number) => void;
}

export const createTitleDirector = (elements: TitleDirectorElements): TitleDirector => ({
  update(time: number) {
    const introOpacity = 1 - smootherstep(3.55, 4.7, time);
    elements.intro.style.opacity = introOpacity.toFixed(3);

    const cue = CAPTION_CUES.find((candidate) => time >= candidate.start && time <= candidate.end);
    const opacity = cue ? cueEnvelope(cue, time) : 0;
    elements.captions.style.opacity = opacity.toFixed(3);
    elements.captions.style.setProperty('--caption-shift', `${((1 - opacity) * 18).toFixed(2)}px`);
    elements.captions.dataset.placement = cue?.placement ?? 'lower-left';
    elements.kicker.textContent = cue?.kicker ?? '';
    elements.line.textContent = cue?.line ?? '';
  },
});
