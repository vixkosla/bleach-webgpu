import { chapterInk } from './quincyGlyphs';

type Frame = { readonly time: number; readonly name: string };

export const createSceneNavigation = (
  frames: readonly Frame[],
  actions: { frame: (index: number) => void; step: (direction: number) => void },
) => {
  const controls = document.querySelector<HTMLElement>('#player-controls')!;
  const frameControls = document.querySelector<HTMLElement>('#frame-controls')!;
  const strip = document.querySelector<HTMLElement>('#frame-strip')!;
  const filmControls = document.querySelector<HTMLElement>('#film-controls')!;
  const play = document.querySelector<HTMLButtonElement>('#play')!;
  const label = document.querySelector<HTMLOutputElement>('#frame-label')!;
  const previous = document.querySelector<HTMLButtonElement>('#frame-previous')!;
  const next = document.querySelector<HTMLButtonElement>('#frame-next')!;
  const status = document.querySelector<HTMLElement>('#viewer-status')!;
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
  previous.addEventListener('click', () => actions.step(-1));
  next.addEventListener('click', () => actions.step(1));
  controls.hidden = false;
  let prior = '';
  return {
    update(playing: boolean, time: number, selected: number, moving: boolean): void {
      const active = selected >= 0 ? selected : frames.findLastIndex(frame => frame.time <= time + .05);
      const key = `${playing}:${active}:${moving}`;
      if (key === prior) return; prior = key;
      document.body.dataset.player = playing ? 'playing' : moving ? 'seeking' : 'paused';
      filmControls.hidden = false; frameControls.hidden = false;
      play.hidden = false;
      label.value = active >= 0 ? frames[active]!.name : 'Текущий момент';
      status.textContent = moving ? 'ПЕРЕХОД К КАДРУ' : playing ? 'ВОСПРОИЗВЕДЕНИЕ' : 'ПАУЗА';
      previous.disabled = active === 0; next.disabled = active === frames.length - 1;
      buttons.forEach((button, index) => button.setAttribute('aria-pressed', String(index === active)));
    },
  };
};
