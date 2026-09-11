import { chapterInk } from './quincyGlyphs';

export type SceneViewMode = 'cinema' | 'frames';
type Frame = { readonly time: number; readonly name: string };

export const createSceneNavigation = (
  frames: readonly Frame[],
  actions: { mode: (mode: SceneViewMode) => void; frame: (index: number) => void; step: (direction: number) => void; motion: () => void },
) => {
  const modes = document.querySelector<HTMLElement>('#viewer-modes')!;
  const cinema = document.querySelector<HTMLButtonElement>('#mode-cinema')!;
  const stills = document.querySelector<HTMLButtonElement>('#mode-frames')!;
  const frameControls = document.querySelector<HTMLElement>('#frame-controls')!;
  const strip = document.querySelector<HTMLElement>('#frame-strip')!;
  const filmControls = document.querySelector<HTMLElement>('#film-controls')!;
  const play = document.querySelector<HTMLButtonElement>('#play')!;
  stills.hidden = true;
  const label = document.querySelector<HTMLOutputElement>('#frame-label')!;
  const previous = document.querySelector<HTMLButtonElement>('#frame-previous')!;
  const next = document.querySelector<HTMLButtonElement>('#frame-next')!;
  const status = document.querySelector<HTMLElement>('#viewer-status')!;
  const motion = document.querySelector<HTMLButtonElement>('#frame-motion')!;
  motion.addEventListener('click', actions.motion);
  const buttons = frames.map((frame, index) => {
    const button = document.createElement('button');
    button.type = 'button'; button.dataset.frame = String(index);
    button.setAttribute('aria-label', `${index + 1}. ${frame.name}`);
    button.setAttribute('aria-keyshortcuts', String(index + 1));
    button.title = `${frame.name} · ${index + 1}`;
    button.innerHTML = chapterInk(index);
    button.addEventListener('click', () => actions.frame(index));
    strip.append(button); return button;
  });
  cinema.addEventListener('click', () => actions.mode(document.body.dataset.view === 'cinema' ? 'frames' : 'cinema'));
  stills.addEventListener('click', () => actions.mode('frames'));
  previous.addEventListener('click', () => actions.step(-1));
  next.addEventListener('click', () => actions.step(1));
  modes.hidden = false;
  let prior = '';
  return {
    update(mode: SceneViewMode, time: number, selected: number, moving: boolean, live: boolean): void {
      const active = selected >= 0 ? selected : mode === 'cinema'
        ? frames.findLastIndex(frame => frame.time <= time + .05)
        : frames.findIndex(frame => Math.abs(frame.time - time) < .05);
      const key = `${mode}:${active}:${moving}:${live}`;
      if (key === prior) return; prior = key;
      document.body.dataset.view = mode;
      cinema.setAttribute('aria-pressed', String(mode === 'cinema'));
      cinema.setAttribute('aria-label', mode === 'cinema' ? 'Кино: перейти к кадрам' : 'Кадры: смотреть кино');
      cinema.title = mode === 'cinema' ? 'Перейти к кадрам' : 'Смотреть кино';
      stills.setAttribute('aria-pressed', String(mode === 'frames'));
      filmControls.hidden = false; frameControls.hidden = false;
      play.hidden = mode !== 'cinema';
      label.value = active >= 0 ? frames[active]!.name : 'Текущий момент';
      status.textContent = mode === 'cinema' ? 'НЕПРЕРЫВНЫЙ ПРОЛЁТ' : moving ? 'ПЕРЕЛЁТ' : live ? 'ЖИВОЙ КАДР' : 'ДВИЖЕНИЕ НА ПАУЗЕ';
      motion.hidden = mode !== 'frames';
      motion.setAttribute('aria-pressed', String(live));
      motion.setAttribute('aria-label', live ? 'Остановить движение в кадре' : 'Оживить кадр');
      motion.title = motion.getAttribute('aria-label')!;
      previous.disabled = active === 0; next.disabled = active === frames.length - 1;
      buttons.forEach((button, index) => button.setAttribute('aria-pressed', String(index === active)));
    },
  };
};
