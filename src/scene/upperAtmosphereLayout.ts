/** Distances in moon radii, in the citadel-aligned lunar frame.
 * Each medium has its own XY footprint and depth. Sparse torn ink and
 * local rim scattering sit near the source; the outer storm stays separate. */
export const UPPER_ATMOSPHERE = {
  clearing: { offset: [0, 0.04, -0.55], axes: [1.12, 0.96, 1], white: 0.82, edge: 1.82 },
  matter: { offset: [-0.04, 0.06, 0.12], axes: [1.02, 1], fade: 1.22, edge: 1.48, depth: 0.22 },
  // Torn cloud-like ink around the dense source, still inside the outer storm.
  // Unequal XY reach and changing Z break up the field without a circular belt.
  wisps: { axes: [1.08, 1], fade: 1.18, edge: 1.58, depth: 0.28 },
  weather: { axes: [1.12, 1], start: 2.08, full: 2.7, depth: -0.65 },
  fog: { start: 1.30, full: 2.28 },
  castle: { offset: [0, -1.68, -0.45], radius: 0.88, strength: 0.38 },
  rays: { startOffset: 0.65, start: 1.4, full: 1.65, edge: 2.8, depth: -0.28 },
} as const;
