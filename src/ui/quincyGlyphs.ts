/** Original vector ink: blade cuts, Quincy crosses and circular chapter numerals.
 * Every mark is geometry; the text beside it remains selectable and readable. */
const svg = (body: string, viewBox = '0 0 48 48', className = '') => `<svg class="q-ink ${className}" viewBox="${viewBox}" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${body}</svg>`;
const paths: Record<string, string> = {
  cross: '<path fill="currentColor" stroke="none" d="M24 2 28 13 26 19 32 17 43 24 32 29 26 27 28 34 24 46 20 34 22 27 16 29 5 24 16 17 22 19 20 13Z"/><path stroke="#08090b" d="M24 10V38M13 24H35"/><path d="m24 0 9 16 15 8-15 8-9 16-9-16L0 24l15-8Z" opacity=".4"/>',
  cinema: '<path d="M13 9C4 16 6 35 20 39M35 9c9 7 7 26-7 30M14 4c-8 7-9 21-5 28M34 4c8 7 9 21 5 28"/><path fill="currentColor" stroke="none" d="m20 13 14 11-14 12 2-12Z"/><path d="m24 2 3 4-3 4-3-4Zm0 36 3 4-3 4-3-4Z"/>',
  frames: '<path d="m24 3 17 21-17 21L7 24Zm0 8 10 13-10 13-10-13ZM3 14l7-7m28 0 7 7M3 34l7 7m28 0 7-7"/><path fill="currentColor" d="m24 17 4 7-4 7-4-7Z"/>',
  play: '<path d="M13 7C3 18 6 36 21 41M35 7c10 11 7 29-8 34"/><path fill="currentColor" stroke="none" d="m18 11 19 13-19 14 3-14Z"/><path d="m24 2 2 3-2 3-2-3Z"/>',
  pause: '<path d="M13 7C3 18 6 36 21 41M35 7c10 11 7 29-8 34"/><path fill="currentColor" stroke="none" d="m17 10 4 5-1 18-3 5-2-6V16Zm14 0 2 6v16l-2 6-3-5-1-18Z"/><path d="m24 2 2 3-2 3-2-3Z"/>',
  arrow: '<path fill="currentColor" stroke="none" d="M3 24c9-2 14-7 19-16l-1 12h18l6 4-6 4H21l1 12C17 31 12 26 3 24Zm11 0 4 3v-6Z"/><path d="M27 15c2-7 8-8 7-3-1 3-5 3-7 2m0 19c2 7 8 8 7 3-1-3-5-3-7-2"/>',
  hide: '<path d="M5 13c7 1 10 6 12 13l7 9 7-9c2-7 5-12 12-13M12 12c0 7 6 5 5 1M36 12c0 7-6 5-5 1"/><path fill="currentColor" stroke="none" d="m24 15 5 6-5 10-5-10Z"/>',
  sound: '<path d="m8 19 8-1 10-9-2 15 2 15-10-9-8-1ZM31 17c5 3 5 11 0 14M35 11c10 6 10 20 0 26"/><path class="q-mute" d="M7 41 40 6"/>',
  close: '<path d="m10 8 14 12L38 8 28 24l10 16-14-12-14 12 10-16Z"/><path fill="currentColor" d="m24 18 6 6-6 6-6-6Z"/>',
  city: '<path d="M7 37h34M11 36V21l5-7 5 7v15m6 0V15l5-10 5 10v21M16 9V5m16 1V2M5 30l6-5m26-5 6 5v12M16 26v5m16-13v5"/><path d="m24 38 3 4-3 4-3-4Z"/>',
  street: '<path d="m5 39 14-15V9l5-5 5 5v15l14 15M5 12l7 5v14M43 12l-7 5v14M17 42l7-15 7 15M3 5l9 6m33-6-9 6M23 13h2"/>',
  awakening: '<path d="M15 37c-9-11 3-16 1-26 9 6 7 11 10 14 4-8-2-13 3-21 1 15 12 19 9 29-2 9-12 12-19 8"/><path fill="currentColor" stroke="none" d="M23 39c-9-7 2-12 0-19 10 10 9 15 0 19Z"/>',
  walls: '<path d="M8 39V17l6-9 6 9v22m8 0V17l6-9 6 9v22M20 22h8M5 39h38M14 3v6M34 3v6M12 21h4m16 0h4M12 29h4m16 0h4"/><path d="m24 24 2 5-2 6-2-6Z"/>',
  moon: '<path d="M30 5C1 8 4 42 30 43 14 32 14 17 30 5Z"/><path d="M36 11c8 8 8 20 0 28M27 16l2 5 5 2-5 2-2 6-2-6-5-2 5-2Z"/><path d="m37 2 1 3 3 1-3 1-1 3-1-3-3-1 3-1Z"/>',
  citadel: '<path d="M7 39V21l7-9 6 9v18m8 0V21l6-9 7 9v18M20 31V12l4-9 4 9v19M4 39h40M14 6v7M34 6v7M24 16v6"/><path d="m20 40 4 6 4-6M8 28h10m12 0h10"/>',
  island: '<path d="M5 24c12-6 26-6 38 0L32 36l-8 10-8-10ZM13 20V12l4-5 4 5v7m6 0V9l4-5 4 5v11M17 27l7 15 7-15M3 31l6 4m36-4-6 4"/>',
};
export const inkIcon = (name: string, className = '') => svg(paths[name] ?? paths.cross!, '0 0 48 48', className);
export const playbackInk = () => inkIcon('play', 'q-play') + inkIcon('pause', 'q-pause');
/** A blade-cut wordmark, deliberately drawn rather than a font substitution. */
export const wahrWeltInk = () => {
  const letters: Record<string, string> = {
    W:'M1 0 9 5 13 39 22 15 31 39 35 5 43 0 37 51 30 57 22 34 14 57 7 51Z',
    A:'M20 0 25 5 43 57 33 51 27 34 14 34 9 51 0 57 17 5Zm0 16-4 12h9Z',
    H:'M1 0 10 5 10 25 31 25 31 5 40 0 38 57 30 52 31 32 10 32 11 52 3 57Z',
    R:'M2 0 29 0 41 12 38 25 27 32 44 57 31 51 15 31 11 31 11 51 3 57Zm9 7v18h13l8-7-7-11Z',
    E:'M3 0 41 0 34 8H11v17h23l-6 7H11v17h23l7 8H3Z',
    L:'M2 0 11 5v44h23l8 8H3Z',
    T:'M0 0h44l-7 8H26v43l-5 6-4-6V8H7Z',
  };
  return svg([... 'WAHRWELT'].map((letter,i)=>`<path transform="translate(${i*52+(i>3?18:0)} 2)" fill="currentColor" fill-rule="evenodd" stroke="none" d="${letters[letter]}"/>`).join(''), '0 0 430 62', 'q-wordmark');
};

/** Large ink numerals for the seven circular chapter buttons. */
export const chapterInk = (index: number) => {
  const numerals = [
    'M11 15 23 5 27 5 27 49 35 54H10l9-5V17l-8 3Z',
    'M7 16C10 0 35 1 37 16c2 12-18 24-22 30h17l7-7-2 16H6v-7C14 33 30 27 29 17c-1-10-12-10-14-3l2 9-9-2Z',
    'M7 12C16 0 37 4 36 17c0 6-4 10-10 12 18 3 16 28-3 28-8 0-14-4-17-10l8-7c0 8 3 12 9 11 10-1 11-17-1-19l-6-1v-5l6-1c12-3 10-17 1-17-5 0-8 4-9 11Z',
    'M24 5h8v31l8-3v8h-8v9l6 5H15l8-5v-9H5v-6Zm-1 11L12 36h11Z',
    'M10 5h26l-6 8H15l-1 13c21-10 33 24 9 31-8 2-16-3-18-11l8-7c-1 9 3 13 9 12 14-3 10-25-9-17l-6-4Z',
    'M31 4 36 11C17 8 12 20 13 33c3-11 23-13 25 2 5 22-27 29-32 8C1 23 11 3 31 4ZM15 36c-4 14 15 22 16 5 1-13-13-15-16-5Z',
    'M5 5h35l-2 8C24 27 23 43 25 50l-11 7c-3-22 10-36 15-43H13L5 22Z',
  ];
  return svg(`<path fill="currentColor" stroke="none" d="${numerals[index]}"/>`, '0 0 44 62', 'q-chapter-number');
};
