type FallbackReason = 'browser' | 'https' | 'adapter' | 'memory' | 'lost' | 'render';

const messages: Record<FallbackReason, { title: string; message: string; hint: string }> = {
  browser: {
    title: 'Для этой сцены нужен WebGPU',
    message: 'Откройте сайт в браузере с поддержкой WebGPU — например, в актуальной версии Google Chrome.',
    hint: 'Включите аппаратное ускорение в настройках браузера. Если ссылка открылась внутри мессенджера, перенесите её в обычный браузер.',
  },
  https: {
    title: 'Откройте сцену по HTTPS',
    message: 'Для WebGPU нужны браузер с его поддержкой и защищённое соединение.',
    hint: 'Перейдите на HTTPS-версию сайта и откройте её в актуальном браузере с WebGPU.',
  },
  adapter: {
    title: 'WebGPU сейчас недоступен',
    message: 'Браузер не смог получить доступ к видеокарте. Для просмотра нужен браузер с работающей поддержкой WebGPU.',
    hint: 'Обновите браузер, включите аппаратное ускорение и перезапустите его. Если не помогло, попробуйте другое устройство с WebGPU.',
  },
  memory: {
    title: 'Сцене не хватило видеопамяти',
    message: 'Закройте другие вкладки с 3D-графикой и попробуйте запустить сцену снова.',
    hint: 'Для просмотра нужен браузер с WebGPU и доступной видеопамятью.',
  },
  lost: {
    title: 'Соединение с видеокартой прервалось',
    message: 'Сцена остановлена. Попробуйте запустить её снова.',
    hint: 'Если это повторяется, перезапустите браузер и закройте другие вкладки с 3D-графикой.',
  },
  render: {
    title: 'Не удалось запустить сцену',
    message: 'Попробуйте ещё раз в актуальном браузере с поддержкой WebGPU.',
    hint: 'Если ошибка повторяется, обновите браузер и проверьте, включено ли аппаратное ускорение.',
  },
};

export const showWebGpuFallback = (reason: FallbackReason): void => {
  const root = document.querySelector<HTMLElement>('#unsupported');
  if (!root) return;
  const content = messages[reason];
  document.body.dataset.ready = 'false';
  document.body.dataset.gpu = reason;
  document.body.classList.add('scene-unavailable');
  const loading = document.querySelector<HTMLElement>('#loading');
  if (loading) loading.hidden = true;
  for (const child of document.querySelectorAll<HTMLElement>('#app > *')) {
    if (child !== root) child.inert = true;
  }
  const card = document.createElement('div');
  card.className = 'fallback-card';
  const brand = document.createElement('p');
  brand.className = 'fallback-brand';
  brand.textContent = 'BLACK MOON · WAHR WELT';
  const title = document.createElement('h1');
  title.id = 'fallback-title';
  title.tabIndex = -1;
  title.textContent = content.title;
  const message = document.createElement('p');
  message.className = 'fallback-message';
  message.textContent = content.message;
  const hint = document.createElement('p');
  hint.className = 'fallback-hint';
  hint.textContent = content.hint;
  const actions = document.createElement('div');
  actions.className = 'fallback-actions';
  const browser = document.createElement('a');
  browser.href = reason === 'https'
    ? `https://bleach-webgpu.vercel.app/${window.location.search}${window.location.hash}`
    : 'https://www.google.com/chrome/';
  browser.textContent = reason === 'https' ? 'Открыть HTTPS-версию' : 'Скачать Google Chrome';
  const retry = document.createElement('button');
  retry.type = 'button';
  retry.textContent = 'Проверить снова';
  retry.addEventListener('click', () => window.location.reload(), { once: true });
  actions.append(browser, retry);
  card.append(brand, title, message, hint, actions);
  root.replaceChildren(card);
  root.hidden = false;
  title.focus({ preventScroll: true });
};
