import { inkIcon, playbackInk, wahrWeltInk } from './quincyGlyphs';
import './quincyInterface.css';

const strikes = new Map<HTMLButtonElement, ReturnType<typeof setTimeout>>();

/** Feedback starts with input, independently of the camera's travel time. */
export const strikeQuincyControl = (button: HTMLButtonElement | null): void => {
  if (!button || button.disabled || !document.body.classList.contains('quincy-interface')) return;
  clearTimeout(strikes.get(button));
  button.classList.add('q-struck');
  strikes.set(button, setTimeout(() => { button.classList.remove('q-struck'); strikes.delete(button); }, 280));
};

/** Five main actions around the chapter dials; all camera handlers stay native. */
export const createQuincyInterface = () => {
  document.body.classList.add('quincy-interface');
  const decorate = (id: string, markup: string, key: string, shortcuts = key) => {
    const button = document.getElementById(id);
    if (button) {
      button.innerHTML = markup + `<kbd class="q-key" aria-hidden="true">${key}</kbd>`;
      button.setAttribute('aria-keyshortcuts', shortcuts);
    }
  };
  decorate('mode-cinema', inkIcon('cinema', 'q-mode-cinema') + inkIcon('frames', 'q-mode-frames')
    + '<span class="q-button-label q-mode-cinema">Кино</span><span class="q-button-label q-mode-frames">Кадры</span>', 'V');
  decorate('play', playbackInk() + '<span class="q-button-label">Пуск / пауза</span>', 'P', 'P Space');
  decorate('frame-motion', playbackInk() + '<span class="q-button-label">Движение</span>', 'M');
  decorate('frame-previous', inkIcon('arrow') + '<span class="q-button-label">Назад</span>', '←', 'ArrowLeft');
  decorate('frame-next', inkIcon('arrow', 'q-reverse') + '<span class="q-button-label">Вперёд</span>', '→', 'ArrowRight');
  decorate('hide-panel', inkIcon('hide') + '<span class="q-button-label">Скрыть</span>', 'H');
  decorate('restore-controls', inkIcon('cross'), 'H');

  const held = new Set<HTMLButtonElement>();
  const release = (cancel = false) => {
    for (const button of held) {
      button.classList.remove('q-held');
      if (!cancel) strikeQuincyControl(button);
    }
    held.clear();
    if (cancel) {
      for (const [button, timer] of strikes) { clearTimeout(timer); button.classList.remove('q-struck'); }
      strikes.clear();
    }
  };
  for (const button of document.querySelectorAll<HTMLButtonElement>('#controls button, #restore-controls')) {
    const press = () => {
      if (button.disabled) return;
      held.add(button); button.classList.add('q-held'); strikeQuincyControl(button);
    };
    button.addEventListener('pointerdown', event => { if (event.button === 0) press(); });
    button.addEventListener('keydown', event => {
      if (!event.repeat && !event.altKey && !event.ctrlKey && !event.metaKey && (event.code === 'Space' || event.key === 'Enter')) press();
    });
    button.addEventListener('click', () => strikeQuincyControl(button));
  }
  window.addEventListener('pointerup', () => release());
  window.addEventListener('keyup', event => { if (event.code === 'Space' || event.key === 'Enter') release(); });
  window.addEventListener('pointercancel', () => release(true));
  window.addEventListener('blur', () => release(true));
  document.addEventListener('visibilitychange', () => { if (document.hidden) release(true); });
};

/** The entry links use the same ink vocabulary before the viewer is entered. */
export const createQuincyEntry = () => {
  const entry = document.querySelector<HTMLElement>('#scene-entry');
  if (!entry) return;
  entry.classList.add('q-entry');
  const title = document.createElement('div'); title.className = 'q-entry-title';
  title.setAttribute('aria-label', 'BLEACH · Wahr Welt');
  title.innerHTML = '<span>BLEACH</span>' + wahrWeltInk();
  entry.prepend(title);
  for (const [index, link] of [...entry.querySelectorAll('a')].entries()) {
    link.innerHTML = inkIcon(index === 0 ? 'cinema' : 'frames') + `<span>${index === 0 ? 'Смотреть кино' : 'Выбрать кадр'}</span>`;
  }
};
