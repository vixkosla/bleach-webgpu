import type { CityMassSpec, CityFreestandingTowerSpec } from './worldBlockout';
import { islandContains } from './islandLayout';

const hash = (x: number, z: number, seed = 0): number => {
  const n = Math.sin(x * 127.1 + z * 311.7 + seed * 79.3) * 43758.5453;
  return n - Math.floor(n);
};

/** Fixed towers, revealed by world-space fog instead of visibility toggles. */
export const OUTSKIRT_TOWERS: readonly CityFreestandingTowerSpec[] = [
  [-564, 314, 93, 12], [-647, -74, 71, 16], [-534, -533, 116, 13],
  [-248, -780, 83, 15], [126, -814, 108, 12], [447, -638, 94, 17],
  [646, -282, 129, 13], [624, 221, 79, 15], [472, 586, 105, 12],
  [205, 797, 84, 16], [-122, 810, 112, 12], [-413, 645, 74, 17],
].map(([x, z, height, span], i) => ({
  name: `outer-ward-watchtower-${i + 1}`, x: x!, z: z!, height: height!, span: span!,
  rotationY: i * .7, variant: i % 2 ? 'bulky' : 'tall',
  roofFraction: i % 3 === 0 ? .29 : .19, eaveScale: 1.05, seed: .73,
}));

export const createCityOutskirts = (): CityMassSpec[] => {
  const lots: CityMassSpec[] = [];
  // The original street grid and camera clearance remain inside this ellipse.
  // Wards extend it with lanes and occasional courts, at unchanged house scale.
  for (let row = -35; row <= 35; row++) for (let column = -30; column <= 30; column++) {
    const h = hash(column, row), h2 = hash(column, row, 2), h3 = hash(column, row, 3);
    const x = column * 25 + (h - .5) * 4, z = row * 27 + (h2 - .5) * 4;
    const oldRadius = Math.hypot(x / 500, z / 620);
    if (oldRadius < 1.04 || !islandContains(x, z, .055)) continue;
    // Cross streets link the inner wards and break up the distant roof carpet.
    if (Math.abs(column) % 9 === 4 || Math.abs(row) % 11 === 6 || h3 > .955) continue;
    if (OUTSKIRT_TOWERS.some(t => Math.hypot(t.x - x, t.z - z) < 29)) continue;
    const width = 12 + h * 6, depth = 13 + h2 * 7;
    const height = 16 + h3 * 23 + (h > .9 ? 12 : 0);
    lots.push({
      name: `outer-ward-${row + 35}-${column + 30}`, x, z,
      width: width / .2, depth: depth / .2, height: height / .42,
      upperScale: .78 + h2 * .17, upperShiftX: (h - .5) * 5, upperShiftZ: 0,
      rotationY: Math.sin(Math.floor(column / 9) * 1.3) * .035,
      tierCount: h3 > .8 ? 3 : h3 > .35 ? 2 : 1,
      tone: h2 > .7 ? 'light' : h2 < .2 ? 'dark' : 'mid',
    });
  }
  return lots;
};
