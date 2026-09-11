import { inkIcon, playbackInk, wahrWeltInk } from './quincyGlyphs';
import './quincyInterface.css';

/** Five main actions around the chapter dials; all camera handlers stay native. */
export const createQuincyInterface = () => {
  document.body.classList.add('quincy-interface');
  const decorate = (id: string, markup: string) => {
    const button = document.getElementById(id);
    if (button) button.innerHTML = markup;
  };
  decorate('mode-cinema', inkIcon('cinema', 'q-mode-cinema') + inkIcon('frames', 'q-mode-frames')
    + '<span class="q-button-label q-mode-cinema">Кино</span><span class="q-button-label q-mode-frames">Кадры</span>');
  decorate('play', playbackInk() + '<span class="q-button-label">Пуск / пауза</span>');
  decorate('frame-motion', playbackInk() + '<span class="q-button-label">Движение</span>');
  decorate('frame-previous', inkIcon('arrow') + '<span class="q-button-label">Назад · ←</span>');
  decorate('frame-next', inkIcon('arrow', 'q-reverse') + '<span class="q-button-label">Вперёд · →</span>');
  decorate('hide-panel', inkIcon('hide') + '<span class="q-button-label">Скрыть · H</span>');
  decorate('restore-controls', inkIcon('cross'));
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
