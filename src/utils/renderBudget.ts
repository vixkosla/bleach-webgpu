// Bound full-screen AO/MRT allocations independently of window/monitor size.
// On the review GTX 1060 3GB, native 2560x1268 plus multiple post passes can
// exhaust VRAM even at DPR 1. DOM/UI remain at native resolution.
export const MAX_RENDER_PIXELS = 1_100_000;

export const chooseRenderPixelRatio = (
  width: number,
  height: number,
  devicePixelRatio: number,
  mobile: boolean,
): number => {
  const safe = (value: number) => Number.isFinite(value) && value > 0 ? value : 1;
  return Math.min(
    safe(devicePixelRatio),
    mobile ? 1.2 : 1.6,
    Math.sqrt(MAX_RENDER_PIXELS / (safe(width) * safe(height))),
  );
};
