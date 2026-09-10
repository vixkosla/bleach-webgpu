export const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

export const smoothstep = (edge0: number, edge1: number, value: number): number => {
  const t = clamp01((value - edge0) / Math.max(0.00001, edge1 - edge0));
  return t * t * (3 - 2 * t);
};

export const smootherstep = (edge0: number, edge1: number, value: number): number => {
  const t = clamp01((value - edge0) / Math.max(0.00001, edge1 - edge0));
  return t * t * t * (t * (t * 6 - 15) + 10);
};

export const pulse = (center: number, halfWidth: number, value: number): number => {
  const distance = Math.abs(value - center);
  return 1 - smoothstep(0, halfWidth, distance);
};

export const createRandom = (seed = 0x5e1f37): (() => number) => {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
};

export const hash2 = (x: number, y: number): number => {
  const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return n - Math.floor(n);
};
