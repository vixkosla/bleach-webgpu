import { inkIcon, playbackInk, wahrWeltInk } from './quincyGlyphs';
import './quincyInterface.css';

type MenuActions = {
  pause: () => boolean;
  resume: (wasPlaying: boolean) => void;
};

/** Dress the existing native controls; their camera/audio handlers stay authoritative. */
export const createQuincyInterface = (actions: MenuActions) => {
  document.body.classList.add('quincy-interface');
  const panel = document.querySelector<HTMLElement>('#controls')!;
  const decorate = (id: string, markup: string) => {
    const button = document.getElementById(id);
    if (button) button.innerHTML = markup;
  };
  decorate('mode-cinema', inkIcon('cinema') + '<span class="q-button-label">Кино</span>');
  decorate('mode-frames', inkIcon('frames') + '<span class="q-button-label">Кадры</span>');
  decorate('play', playbackInk() + '<span class="q-button-label">Пуск / пауза</span>');
  decorate('frame-motion', playbackInk() + '<span class="q-button-label">Движение</span>');
  decorate('frame-previous', inkIcon('arrow'));
  decorate('frame-next', inkIcon('arrow', 'q-reverse'));
  decorate('hide-panel', inkIcon('hide') + '<span class="q-button-label">Скрыть · H</span>');
  decorate('restore-controls', inkIcon('cross'));
  decorate('flight-sound', inkIcon('sound') + '<span class="q-button-label">Звук</span>');
  const pad = document.createElement('div'); pad.id = 'quincy-pad';
  pad.innerHTML = `<svg class="q-pad-outline" viewBox="0 0 180 180" fill="none" stroke="currentColor" stroke-width="1" aria-hidden="true"><path d="M63 7Q90 0 117 7v56h56q7 27 0 54h-56v56q-27 7-54 0v-56H7q-7-27 0-54h56Z"/><circle cx="90" cy="90" r="18"/></svg><span class="q-pad-center">${inkIcon('cross')}</span><span class="q-pad-caption">Ракурс <small>← →</small></span>`;
  panel.prepend(pad);
  for (const [id, label, index] of [['first', 'Первый кадр', 0], ['last', 'Последний кадр', 6]] as const) {
    const button = document.createElement('button'); button.id = `frame-${id}`;
    button.type = 'button'; button.setAttribute('aria-label', label); button.title = label;
    button.innerHTML = inkIcon('arrow');
    button.addEventListener('click', () => document.querySelector<HTMLButtonElement>(`[data-frame="${index}"]`)!.click());
    pad.append(button);
  }

  const menuButton = document.createElement('button');
  menuButton.id = 'quincy-menu'; menuButton.type = 'button';
  menuButton.setAttribute('aria-label', 'Открыть меню');
  menuButton.setAttribute('aria-haspopup', 'dialog');
  menuButton.innerHTML = `${inkIcon('cross')}<span class="q-button-label">Меню</span>`;
  panel.prepend(menuButton);

  const dialog = document.createElement('dialog');
  dialog.id = 'quincy-dialog'; dialog.setAttribute('aria-labelledby', 'quincy-title');
  dialog.innerHTML = `
    <button id="quincy-close" class="q-dialog-close" aria-label="Закрыть меню">${inkIcon('close')}</button>
    <div class="q-menu-content">
      <p class="q-eyebrow">BLEACH</p>
      <h1 id="quincy-title"><span class="q-sr-only">Wahr Welt</span>${wahrWeltInk()}</h1>
      <p class="q-menu-subtitle">ТЫСЯЧЕЛЕТНЯЯ КРОВАВАЯ ВОЙНА</p>
      <div class="q-menu-choices">
        <button data-menu-action="continue" autofocus>${inkIcon('arrow', 'q-menu-pointer q-reverse')}<span>Продолжить</span>${inkIcon('arrow', 'q-menu-pointer')}</button>
        <button data-menu-action="cinema">${inkIcon('arrow', 'q-menu-pointer q-reverse')}<span>Смотреть кино</span>${inkIcon('arrow', 'q-menu-pointer')}</button>
        <button data-menu-action="frames">${inkIcon('arrow', 'q-menu-pointer q-reverse')}<span>Выбрать кадр</span>${inkIcon('arrow', 'q-menu-pointer')}</button>
      </div>
      <div class="q-menu-settings">
        <button id="quincy-menu-sound" aria-pressed="false">${inkIcon('sound')}<span>Свист пролёта</span><span class="q-setting-value">Выкл.</span></button>
        <button id="quincy-menu-motion" aria-pressed="true">${inkIcon('moon')}<span>Движение в кадрах</span><span class="q-setting-value">Вкл.</span></button>
      </div>
      <div class="q-menu-footer"><p><kbd>←</kbd><kbd>→</kbd> кадры <i>·</i> <kbd>H</kbd> панель <i>·</i> <kbd>Esc</kbd> меню</p></div>
    </div>`;
  document.querySelector('#app')!.append(dialog);
  const sound = document.querySelector<HTMLButtonElement>('#flight-sound')!;
  const motion = document.querySelector<HTMLButtonElement>('#frame-motion')!;
  const menuSound = dialog.querySelector<HTMLButtonElement>('#quincy-menu-sound')!;
  const menuMotion = dialog.querySelector<HTMLButtonElement>('#quincy-menu-motion')!;
  let wasPlaying = false;
  const syncSettings = () => {
    for (const [source, target] of [[sound, menuSound], [motion, menuMotion]]) {
      if (!source || !target) continue;
      const enabled = source.getAttribute('aria-pressed') === 'true';
      target.setAttribute('aria-pressed', String(enabled)); target.disabled = source.disabled;
      target.querySelector('.q-setting-value')!.textContent = source.disabled ? 'Недоступно' : enabled ? 'Вкл.' : 'Выкл.';
    }
  };
  // Only two control attributes are observed; no per-frame DOM traversal.
  const observer = new MutationObserver(syncSettings);
  for (const button of [sound, motion]) if (button) observer.observe(button, { attributes: true, attributeFilter: ['aria-pressed', 'disabled'] });
  menuSound.addEventListener('click', () => sound.click());
  menuMotion.addEventListener('click', () => motion.click());
  const open = () => {
    if (dialog.open) return;
    wasPlaying = actions.pause(); syncSettings();
    document.body.classList.add('quincy-menu-open'); dialog.showModal();
  };
  const close = (resume = true) => {
    if (!dialog.open) return;
    dialog.close(); document.body.classList.remove('quincy-menu-open');
    if (resume) actions.resume(wasPlaying);
  };
  menuButton.addEventListener('click', open);
  dialog.querySelector('#quincy-close')!.addEventListener('click', () => close());
  dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
  dialog.addEventListener('keydown', event => {
    if (event.key !== 'Tab') return;
    const items = [...dialog.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
    const first = items[0]!, last = items[items.length - 1]!;
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  });
  dialog.addEventListener('click', event => { if (event.target === dialog) close(); });
  dialog.querySelector('[data-menu-action="continue"]')!.addEventListener('click', () => close());
  for (const mode of ['cinema', 'frames']) dialog.querySelector(`[data-menu-action="${mode}"]`)!.addEventListener('click', () => {
    close(false); document.querySelector<HTMLButtonElement>(`#mode-${mode}`)!.click();
    if (mode === 'frames') document.querySelector<HTMLButtonElement>('[data-frame][aria-pressed=true]')?.focus({ preventScroll: true });
  });
  window.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || dialog.open || document.body.classList.contains('inspection-mode')) return;
    event.preventDefault(); open();
  });
  return { get open() { return dialog.open; } };
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
