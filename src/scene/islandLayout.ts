/** One footprint shared by stone, paving, outskirts and the low weather. */
export const ISLAND_RADIUS_X = 780;
export const ISLAND_RADIUS_Z = 960;
export const ISLAND_BOTTOM_Y = -442;

export const islandCoastRadius = (angle: number): number => 1
  + .036 * Math.sin(angle * 3 + .7)
  + .023 * Math.sin(angle * 7 - 1.3)
  + .014 * Math.cos(angle * 17 + .2);

export const islandContains = (x: number, z: number, margin = 0): boolean => {
  const nx = x / ISLAND_RADIUS_X, nz = z / ISLAND_RADIUS_Z;
  return Math.hypot(nx, nz) < islandCoastRadius(Math.atan2(nz, nx)) - margin;
};
