# Mobile layout and nonvisual performance — 2026-09-15

Baseline: published `51a80a2`. Scope: mobile controls/entry layout and redundant
runtime work. No changes to geometry, materials, shaders, lighting, camera routes,
36-second pacing, post-processing quality, or render-budget policy.

## Mobile layout

- Transparent ink/circle styling is retained; desktop above 1040px is unchanged.
- Portrait controls have separate chapter, action, and timeline rows. At widths
  below 360px, seven chapter buttons wrap 4+3. Touch targets are at least 44px.
- Tablet and short landscape layouts keep the timeline between or below controls.
- Safe-area insets and viewport-fit=cover protect controls on inset displays.
- The entry wordmark and two links fit narrow screens.

Eight browser-emulated viewports passed button bounds/overlap checks:
320x568, 360x800, 390x844, 430x932, 568x320, 768x1024, 844x390, 1280x800.
Before: all tested widths below 1280px had clipped or overlapping buttons.
After: zero clipped or overlapping buttons in all eight layouts.
Native CDP touch events verified chapters, hide/restore, mode/play, and seeking.

## Nonvisual optimizations

1. Compose static architecture matrices once; preserve world-matrix propagation,
   LOD visibility and all dynamic atmosphere/camera updates. Automatic local
   matrix updates drop from 1321 scene nodes to 104 (1217 static nodes removed).
2. Cache unchanged timeline, labels, progress, flash, and diagnostic attributes.
   A stationary 3-second debug sample changed from 1102 DOM mutation records to 0.
3. Skip repeated GPU submission for fully stopped public tours. Playback, live
   weather, transitions, seek, camera-pose changes, resize and tab restoration
   invalidate the cache. Debug/inspection retain continuous rendering for edits.
   A 3-second stopped public sample changed from 6300 queue submissions to 0;
   live weather resumed GPU work successfully in both versions.
4. Skip scene work while document.hidden; reset the wall clock on return.
5. Skip hidden performance-monitor updates and redundant renderer resizes.
   One initial resize also catches rotation during asynchronous scene setup.

These are workload counts, not FPS improvement percentages. The original
before/after timing samples had different scheduling and an emulated-DPR setup
race, so raw matrix-call or frame counts are not a controlled speed benchmark.
The 1.1M-pixel render budget and mobile/desktop DPR limits are unchanged.

## Visual and interaction evidence

Evidence directory in the main checkout:
`artifacts/review/mobile-performance-2026-09-14/`.

- `review.mjs`, `baseline/report.json`, `after/report.json`: layouts, touch,
  runtime counters, scene draw/triangle counts and camera/buffer state.
- `parity.mjs`, `compare.mjs`, `comparison.json`: six held-frame comparisons
  at story times 7, 38 and 66, in 1440x900 and 390x844 viewports.
  All six captures match pixel-for-pixel (zero changed pixels). Camera and render
  metadata are identical. Controlled setup fixes startup RNG,
  AO denoise noise, CSS grain phase, DPR-resize ordering and endpoint lens.
  This setup affects tests only, not the production scene.
- `acceptance.mjs`, `after/acceptance.json`: complete 35.974-second playback,
  1212 samples, native touch seek, rotation, pause/resume, reduced-motion
  navigation and entry links at 320/390/844 widths; no page/console/GPU errors.
- Hidden-tab branch was exercised with a synthetic visibility event/property,
  not a claim about every mobile OS background policy.
- `smoke.mjs`: clean non-debug controls, paused GPU, live resume, seeking,
  and rotation during startup, usable against local and public builds.
  Final local run passed with zero errors, zero paused submissions over 2s,
  live submissions resumed, and startup rotation resolved to 844x390 with the
  unchanged 1012x468 drawing buffer at mobile DPR policy.

## Verification boundary

Main production build and release `pnpm check && pnpm build` passed. The checks
cover TypeScript, citadel geometry/facades, upper atmosphere/cloud detail, tour,
floating island, transitions and all 84 frame links. All 66 source files match
across main, stage and release; only main.ts and quincyInterface.css changed
from baseline, plus the viewport meta tag. The other 64 sources are untouched.

Reviewed on the single shared GTX1060 WebGPU browser using mobile emulation.
No physical iPhone/Android device or Safari run was available. This verifies
layout, actual WebGPU output and browser interactions, not phone-specific FPS,
battery measurements or hardware-notch behavior. Existing unsupported-WebGPU
fallback remains unchanged.

References for matrix and safe-inset semantics:
[Three Object3D](https://threejs.org/docs/pages/Object3D.html),
[CSS env](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Values/env).
