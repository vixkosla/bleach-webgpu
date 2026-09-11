import * as THREE from 'three/webgpu';
import {
  emissive,
  float,
  mrt,
  nodeObject,
  normalView,
  output,
  pass,
  toonOutlinePass,
  uniform,
  uv,
  vec3,
  vec4,
} from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { dof } from 'three/addons/tsl/display/DepthOfFieldNode.js';
import { ao } from 'three/addons/tsl/display/GTAONode.js';
import { denoise } from 'three/addons/tsl/display/DenoiseNode.js';
import { sharpen } from 'three/addons/tsl/display/SharpenNode.js';
import { vignette } from 'three/addons/tsl/display/CRT.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import './style.css';
import { createQuincyInterface, createQuincyEntry, strikeQuincyControl } from './ui/quincyInterface';
import { CinematicDirector } from './cinematic/CinematicDirector';
import { SceneTourDirector, SCENE_TOUR_DURATION, SCENE_TOUR_FRAMES } from './cinematic/SceneTourDirector';
import { FrameTransition } from './cinematic/FrameTransition';
import { FrameFlight } from './cinematic/FrameFlight';
import { ScenePacing } from './cinematic/ScenePacing';
import { createFrameTravelBlur } from './materials/frameTravelBlur';
import { createSceneNavigation, type SceneViewMode } from './ui/sceneNavigation';
import { SceneAtmosphereDirector } from './cinematic/SceneAtmosphereDirector';
import { createInspectionNavigation } from './cinematic/inspectionNavigation';
import { createUpperInspectionPreset, UPPER_SHOT_PRESETS, type UpperShotSettings } from './cinematic/upperInspection';
import { createTitleDirector } from './cinematic/TitleDirector';
import { createBlockoutCity, createBlockoutTower } from './scene/worldBlockout';
import { CITADEL_WORLD_SCALE } from './scene/citadelGeometry';
import { BEATS, CITY_DECK_Y, FILM_DURATION, TOWER_Z } from './scene/constants';
import { createEmberFallout } from './scene/embers';
import { createGetsuga } from './scene/getsuga';
import { createChargeLightning } from './scene/lightning';
import { createTitleWordmark } from './scene/wordmark';
import { createUpperEvent, UPPER_BEATS } from './scene/upperEvent';
import { createUpperEventComposite } from './materials/upperEventComposite';
import { createArchitectureGrade } from './materials/architectureGrade';
import { createArchitectureToon } from './materials/architectureToon';
import { createCitadelShadows } from './materials/citadelShadows';
import { createCityHaze } from './materials/cityHaze';
import { pulse, smoothstep } from './utils/math';
import { watchDeviceLoss } from './utils/deviceLoss';
import { chooseRenderPixelRatio } from './utils/renderBudget';
import { showWebGpuFallback } from './ui/webgpuFallback';
import { hasWebGPUDevice, WebGPUOnlyRenderer } from './utils/webgpuRenderer';

const canvas = document.querySelector<HTMLCanvasElement>('#cinema');
const loading = document.querySelector<HTMLElement>('#loading');
const loadingMessage = document.querySelector<HTMLElement>('#loading-message');
const playButton = document.querySelector<HTMLButtonElement>('#play');
const timeline = document.querySelector<HTMLInputElement>('#timeline');
const timeOutput = document.querySelector<HTMLOutputElement>('#time');
const hudButton = document.querySelector<HTMLButtonElement>('#hud');
const inspectButton = document.querySelector<HTMLButtonElement>('#inspect-mode');
const controls = document.querySelector<HTMLElement>('#controls');
const inspection = document.querySelector<HTMLElement>('#inspection');
const filmModeButton = document.querySelector<HTMLButtonElement>('#film-mode');
const performanceMonitor = document.querySelector<HTMLElement>('#performance-monitor');
const performanceStatus = document.querySelector<HTMLElement>('#perf-status');
const performanceFps = document.querySelector<HTMLOutputElement>('#perf-fps');
const performanceFrame = document.querySelector<HTMLOutputElement>('#perf-frame');
const performanceDraws = document.querySelector<HTMLOutputElement>('#perf-draws');
const performanceTriangles = document.querySelector<HTMLOutputElement>('#perf-triangles');
const performanceMemory = document.querySelector<HTMLOutputElement>('#perf-memory');
const performanceResolution = document.querySelector<HTMLElement>('#perf-resolution');
const inspectionCameraButtons = Array.from(
  document.querySelectorAll<HTMLButtonElement>('[data-inspect-camera]'),
);
const skyLayerControl = document.querySelector<HTMLElement>('#sky-layer-control');
const skyLayerToggle = document.querySelector<HTMLInputElement>('#sky-layer-toggle');
const upperControls = document.querySelector<HTMLElement>('#upper-controls');
const upperTimeline = document.querySelector<HTMLInputElement>('#upper-timeline');
const upperTimeOutput = document.querySelector<HTMLOutputElement>('#upper-time');
const upperMotionButton = document.querySelector<HTMLButtonElement>('#upper-motion');
const upperMatterToggle = document.querySelector<HTMLInputElement>('#upper-matter-toggle');
const upperBeatButtons = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-upper-beat]'));
const intro = document.querySelector<HTMLElement>('#intro');
const captions = document.querySelector<HTMLElement>('#captions');
const captionKicker = document.querySelector<HTMLElement>('#caption-kicker');
const captionLine = document.querySelector<HTMLElement>('#caption-line');
const flash = document.querySelector<HTMLElement>('#flash');
const unsupported = document.querySelector<HTMLElement>('#unsupported');

if (
  !canvas || !loading || !loadingMessage || !playButton || !timeline || !timeOutput || !hudButton || !inspectButton || !controls
  || !inspection || !filmModeButton || inspectionCameraButtons.length === 0
  || !performanceMonitor || !performanceStatus || !performanceFps || !performanceFrame
  || !performanceDraws || !performanceTriangles || !performanceMemory || !performanceResolution
  || !intro || !captions || !captionKicker || !captionLine || !flash || !unsupported
) {
  throw new Error('Cinematic DOM is incomplete');
}

const formatTime = (seconds: number, duration = FILM_DURATION): string => `00:${Math.floor(seconds).toString().padStart(2, '0')} / 00:${duration}`;

const formatCompactCount = (value: number): string => {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(value >= 100_000 ? 0 : 1)}K`;
  return Math.round(value).toString();
};

const formatMemory = (bytes: number): string => {
  if (bytes <= 0) return '—';
  return `${(bytes / (1024 * 1024)).toFixed(bytes >= 100 * 1024 * 1024 ? 0 : 1)}M`;
};

const isMobileRenderTarget = (): boolean => window.matchMedia(
  '(max-width: 820px), (pointer: coarse)',
).matches;

// The city is fill-rate heavy because its outline/DOF/bloom pipeline renders
// several full-screen passes. Keep desktop sharp, but avoid multiplying a
// phone's physical pixels by an expensive high-DPR screen.
const getRenderPixelRatio = (): number => chooseRenderPixelRatio(
  window.innerWidth, window.innerHeight, window.devicePixelRatio, isMobileRenderTarget(),
);

type InspectionPresetName = 'street' | 'quarter' | 'city' | 'citadel' | 'upper';

interface InspectionPreset {
  position: readonly [number, number, number];
  target: readonly [number, number, number];
  fov: number;
  time: number;
}

const INSPECTION_PRESETS: Record<InspectionPresetName, InspectionPreset> = {
  street: {
    // Stand inside the rebuilt southern street, rather than outside the old
    // island footprint. This is the eye-level facade and road-width check.
    position: [0, CITY_DECK_Y + 17, TOWER_Z + 610],
    target: [0, CITY_DECK_Y + 48, TOWER_Z + 160],
    fov: 48,
    time: 10.4,
  },
  quarter: {
    // A real district close-up: the front-east blocks and their narrow street
    // network fill the frame instead of collapsing into another island view.
    position: [420, CITY_DECK_Y + 165, TOWER_Z + 520],
    target: [145, CITY_DECK_Y + 18, TOWER_Z + 300],
    fov: 42,
    time: 10.4,
  },
  city: {
    // Full composition check, tightened to the current island dimensions.
    position: [610, CITY_DECK_Y + 540, TOWER_Z + 760],
    target: [0, CITY_DECK_Y + 20, TOWER_Z],
    fov: 50,
    time: 10.4,
  },
  citadel: {
    // Frontal proportion check with the citadel large enough to inspect.
    position: [0, CITY_DECK_Y + 28, TOWER_Z + 980],
    target: [0, CITY_DECK_Y + 118, TOWER_Z],
    fov: 30,
    time: 10.4,
  },
  upper: {
    // Replaced with world-bound coordinates once the scaled citadel exists.
    position: [0, 520, 800], target: [0, 490, TOWER_Z], fov: 48, time: 21.8,
  },
};

const isInspectionPresetName = (value: string | null): value is InspectionPresetName => (
  value === 'street' || value === 'quarter' || value === 'city' || value === 'citadel' || value === 'upper'
);

const enableArchitecturalShadows = (root: THREE.Object3D): void => {
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    const opaque = materials.every((material) => !material.transparent && material.opacity >= 0.999);
    const isGroundSurface = /(?:road|sidewalk|curb|city-deck|stairs)/.test(object.name);
    // Window inserts and thin facade trim are sub-texel relief cues, not useful
    // shadow silhouettes. Letting those narrow boxes cast into the 4096px city
    // shadow map produces a dense comb under cornices at grazing light angles.
    // Keep the visible trim, but reserve hard shadows for walls, roofs,
    // buttresses and the other architectural masses.
    const isShadowlessFacadeInset = /(?:window|stained|glass)/.test(object.name);
    const isShadowlessFacadeTrim = /(?:facade-course-bands|cornices|flat-roof-caps|roof-parapets)/
      .test(object.name);
    object.castShadow = opaque
      && !isGroundSurface
      && !isShadowlessFacadeInset
      && !isShadowlessFacadeTrim;
    // Keep the expensive city-wide shadow map on horizontal circulation
    // surfaces only. On a relief-normal facade the required normalBias moves
    // each block to a different shadow texel, turning a straight eave shadow
    // into the false triangular comb. Facades still retain hard toon lighting
    // and cast their silhouettes onto streets, decks and stairs.
    object.receiveShadow = isGroundSurface;
  });
};

const init = async (): Promise<void> => {
  performance.mark('scene-start');
  const showLoading = async (message: string): Promise<void> => {
    loadingMessage.textContent = message;
    // Paint the status before synchronous geometry work occupies this thread.
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  };
  if (!isSecureContext || !navigator.gpu) {
    showWebGpuFallback(isSecureContext ? 'browser' : 'https');
    return;
  }
  // API presence alone does not guarantee an available GPU. Stop before
  // Three's automatic WebGL fallback: this scene requires WebGPU features.
  await showLoading('Проверяем поддержку WebGPU…');
  try {
    if (!await navigator.gpu.requestAdapter()) {
      showWebGpuFallback('adapter');
      return;
    }
  } catch {
    showWebGpuFallback('adapter');
    return;
  }

  const url = new URL(window.location.href);
  const tourMode = url.searchParams.get('film') === 'tour';
  const filmDuration = tourMode ? SCENE_TOUR_DURATION : FILM_DURATION;
  const pacing = tourMode ? new ScenePacing() : null;
  const displayDuration = pacing?.duration ?? filmDuration;
  timeline.max = String(displayDuration);
  if (tourMode) {
    intro.style.display = 'none'; captions.style.display = 'none';
    document.body.dataset.view = url.searchParams.get('view') === 'frames' ? 'frames' : 'cinema';
    if (url.searchParams.get('debug') !== '1') performanceMonitor.style.display = 'none';
  }
  const requestedInspectionPreset = url.searchParams.get('inspect');
  const upperRequested = requestedInspectionPreset === 'upper';
  // The AO architecture route is the accepted look for the city and citadel:
  // it is the default for every inspection view (`?ao-only=0` restores the
  // older lit/outline route). The cinematic keeps its own explicit choice.
  const filmParams = url.searchParams.has('film') || url.searchParams.has('t') || url.searchParams.has('ft');
  const landingMode = !requestedInspectionPreset && !filmParams;
  document.body.classList.toggle('landing-mode', landingMode);
  canvas.tabIndex = landingMode ? -1 : 0;
  if (landingMode) canvas.setAttribute('aria-label', 'Цитадель и чёрная луна среди движущихся облаков');
  const explore = document.querySelector<HTMLElement>('#scene-entry');
  if (explore) explore.hidden = !landingMode;
  if (landingMode) createQuincyEntry();
  const aoOnly = tourMode || upperRequested || (filmParams
    ? url.searchParams.has('ao-only')
    : url.searchParams.get('ao-only') !== '0');
  let skyVisible = url.searchParams.get('sky') !== '0';
  const requestedUpperTime = Number(url.searchParams.get('ut') ?? 21.8);
  let upperTime = Number.isFinite(requestedUpperTime)
    ? Math.max(BEATS.anticipation, Math.min(FILM_DURATION, requestedUpperTime)) : 21.8;
  let upperMotionPlaying = url.searchParams.get('sky-motion') !== '0';
  const requestedMotionTime = Number(url.searchParams.get('mt') ?? upperTime);
  let upperMotionTime = Number.isFinite(requestedMotionTime)
    ? Math.max(0, Math.min(86400, requestedMotionTime)) : upperTime;
  // The home page holds the selected upper shot. Explicit inspection links
  // retain the free camera; cinematic captures keep their ?film/?t/?ft route.
  const filmRequested = url.searchParams.has('film')
    || url.searchParams.has('t')
    || url.searchParams.has('ft');
  let inspectionPreset: InspectionPresetName | null = isInspectionPresetName(requestedInspectionPreset)
    ? requestedInspectionPreset
    : filmRequested
      ? null
      : 'upper';

  // AO is one shared world: looking upward from any inspector must reveal
  // the event. GETSUGA is a camera preset, not a separate scene/load gate.
  const sharedSky = aoOnly && (inspectionPreset !== null || tourMode);
  const renderer = new WebGPUOnlyRenderer({
    canvas,
    antialias: true,
    alpha: false,
  });
  const deviceStatus = watchDeviceLoss(renderer, reason => {
    document.body.dataset.ready = 'false';
    document.body.dataset.gpu = reason;
    loading.hidden = true;
    performanceMonitor.dataset.state = 'critical';
    performanceStatus.textContent = reason === 'memory' ? 'GPU MEMORY' : reason === 'lost' ? 'GPU LOST' : 'GPU ERROR';
    performanceFps.value = performanceFrame.value = '—';
    performanceDraws.value = performanceTriangles.value = '—';
    showWebGpuFallback(reason);
  });
  // City background remains opaque. A null-background upper scene clears to
  // transparent black for its independent premultiplied-alpha render target.
  if (sharedSky) renderer.setClearColor(0x000000, 0);
  renderer.setPixelRatio(getRenderPixelRatio());
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = aoOnly ? 1 : 0.9;
  // The standalone AO diagnostic needs depth and normals, not the 4096px
  // direct-light shadow map. Disabling it keeps the AO link safe beside the
  // full-colour scene on a 3GB GPU.
  renderer.shadowMap.enabled = !aoOnly;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  await showLoading('Подготавливаем сцену…');
  try {
    await renderer.init();
  } catch (error) {
    console.warn('WebGPU initialization failed', error);
    showWebGpuFallback('adapter');
    return;
  }
  if (!hasWebGPUDevice(renderer)) {
    renderer.dispose();
    showWebGpuFallback('adapter');
    return;
  }
  if (deviceStatus.failed) return;
  document.body.dataset.renderer = 'webgpu';
  // Explicitly release this device before a same-tab reload/navigation. Do
  // not leave large GPU buffers waiting for the old document's GC.
  window.addEventListener('pagehide', () => renderer.dispose(), { once: true });
  window.addEventListener('pageshow', event => {
    if (event.persisted) window.location.reload();
  });

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x090611);
  scene.fog = tourMode ? null : new THREE.FogExp2(0x16122e, 0.0015);

  const camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.12, sharedSky ? 4200 : 2200);
  const upperShot: UpperShotSettings = { ...UPPER_SHOT_PRESETS.final };
  for (const [key, param, min, max] of [
    ['fov', 'ufov', 30, 95], ['distance', 'udist', 220, 2200],
    ['height', 'uheight', -400, 40], ['frameY', 'uframe', 0.20, 0.46], ['azimuth', 'uazimuth', -60, 60],
  ] as const) {
    const value = Number(url.searchParams.get(param));
    if (!landingMode && url.searchParams.has(param) && Number.isFinite(value)) upperShot[key] = Math.max(min, Math.min(max, value));
  }
  const director = new CinematicDirector(camera);
  const orbitControls = new OrbitControls(camera, canvas);
  orbitControls.enabled = false;
  orbitControls.enableDamping = true;
  orbitControls.dampingFactor = 0.075;
  orbitControls.screenSpacePanning = true;
  orbitControls.minDistance = 8;
  orbitControls.maxDistance = 2100;
  // Street inspection intentionally looks upward at the citadel. Keep enough
  // orbit below the target for that view while still preventing a full flip.
  orbitControls.maxPolarAngle = Math.PI * 0.62;
  let inspectionCameraMoved = false;
  orbitControls.addEventListener('start', () => { inspectionCameraMoved = true; });
  const inspectionNavigation = createInspectionNavigation(
    camera, orbitControls, () => !landingMode && inspectionPreset !== null,
    () => { inspectionCameraMoved = true; },
  );
  const titleDirector = createTitleDirector({
    intro,
    captions,
    kicker: captionKicker,
    line: captionLine,
  });

  // Reference lighting (night overhead frame): one steep, cool violet moon
  // key from high above — roofs and cornices catch pale violet light while
  // facades fall into deep readable navy. Everything else stays supporting.
  const hemisphere = new THREE.HemisphereLight(0x666477, 0x15121e, 0.24);
  scene.add(hemisphere);
  const moonKey = new THREE.DirectionalLight(0xd1cedd, 1.35);
  moonKey.position.set(-110, 470, 150);
  moonKey.target.position.set(0, CITY_DECK_Y + 48, TOWER_Z);
  moonKey.castShadow = true;
  moonKey.shadow.mapSize.set(4096, 4096);
  moonKey.shadow.camera.near = 30;
  moonKey.shadow.camera.far = 1000;
  moonKey.shadow.camera.left = -400;
  moonKey.shadow.camera.right = 400;
  moonKey.shadow.camera.top = 400;
  moonKey.shadow.camera.bottom = -400;
  moonKey.shadow.bias = -0.00012;
  // The light covers the whole 800-unit city plan, so its shadow texels are
  // much larger than the old 0.025 normal offset. A sub-texel offset made the
  // giant citadel planes repeatedly self-shadow into diagonal moire bands.
  // This is still small beside the city architecture, but large enough to move
  // the receiving plane beyond one shadow texel at grazing angles.
  moonKey.shadow.normalBias = 0.34;
  moonKey.shadow.radius = 0.35;
  moonKey.shadow.intensity = 0.88;
  // The only shadow casters are static architecture. Re-rendering the entire
  // 4096px city map every animation frame doubled the geometry workload for no
  // visual change, especially painfully on phones. Build it once and retain it.
  moonKey.shadow.autoUpdate = false;
  moonKey.shadow.needsUpdate = true;
  scene.add(moonKey);
  scene.add(moonKey.target);
  const rimKey = new THREE.DirectionalLight(0x68617c, 0.09);
  rimKey.position.set(210, 118, -24);
  rimKey.target.position.set(0, CITY_DECK_Y + 72, TOWER_Z);
  scene.add(rimKey);
  scene.add(rimKey.target);

  // Weak camera-side fill: keeps the facades the camera faces from clipping
  // to black; dim and shadowless so the top-down key structure dominates.
  const streetFill = new THREE.DirectionalLight(0x635f78, 0.12);
  streetFill.position.set(60, 150, 430);
  streetFill.target.position.set(0, CITY_DECK_Y + 36, TOWER_Z);
  scene.add(streetFill);
  scene.add(streetFill.target);

  // Frames 7 looks east along the middle-transverse. The moon key sits above
  // the canyon, so those side walls go black. Short local spots rake the
  // filmed facades without lifting the rest of the city or the citadel.
  const streetCanyonZ = 385 + TOWER_Z;
  const rakeStreet = (x: number, side: 1 | -1, intensity: number) => {
    const light = new THREE.SpotLight(0xc9c4d8, intensity, 210, Math.PI * 0.34, 0.58, 1.55);
    light.position.set(x, CITY_DECK_Y + 36, streetCanyonZ + side * 48);
    light.target.position.set(x, CITY_DECK_Y + 16, streetCanyonZ);
    light.name = `filmed-street-rake-${x}-${side}`;
    scene.add(light);
    scene.add(light.target);
  };
  rakeStreet(-210, 1, 165);
  rakeStreet(-110, -1, 140);
  rakeStreet(-20, 1, 120);

  // Front fill from the citadel side: the moon key and street fill both sit
  // behind the camera, so the facades the camera actually faces stay in full
  // shadow. This counter-fill lifts those front-facing walls out of black
  // without flattening the key structure.
  const frontFill = new THREE.DirectionalLight(0x57526d, 0.08);
  frontFill.position.set(0, 220, -360);
  frontFill.target.position.set(0, CITY_DECK_Y + 40, TOWER_Z);
  scene.add(frontFill);
  scene.add(frontFill.target);

  // A trace of neutral fill retains stone detail without flattening the night key.
  const inspectionFill = new THREE.AmbientLight(0xa6a2b2, inspectionPreset || tourMode ? 0.08 : 0);
  scene.add(inspectionFill);

  const towerBacklight = new THREE.PointLight(0x7854b0, 18, 220, 1.85);
  towerBacklight.position.set(-18, CITY_DECK_Y + 118, TOWER_Z - 54);
  scene.add(towerBacklight);

  // Reference frames light the citadel from the front (the city side): a
  // wide pale-lavender spot from above the city washes the street face and
  // the upper slabs so the keep reads white against the dark sky.
  const castleSpot = new THREE.SpotLight(0xf8e6fa, 620, 620, Math.PI * 0.14, 0.3, 1.7);
  castleSpot.position.set(-40, CITY_DECK_Y + 280, TOWER_Z + 380);
  castleSpot.target.position.set(0, CITY_DECK_Y + 150, TOWER_Z);
  scene.add(castleSpot);
  scene.add(castleSpot.target);

  await showLoading('Создаём город и кристаллы…');
  performance.mark('scene-geometry-start');
  const city = createBlockoutCity();
  enableArchitecturalShadows(city);
  scene.add(city);
  const tower = createBlockoutTower();
  performance.mark('scene-geometry-end');
  performance.measure('scene-geometry', 'scene-geometry-start', 'scene-geometry-end');
  // The reference citadel is a narrow vertical mountain, not a wide palace:
  // compress its plan while extending the silhouette above the city masses.
  tower.group.scale.set(...CITADEL_WORLD_SCALE);
  // Scaling a group also scales the deck-height offset of its child volumes.
  // Counter-shift the group so the citadel footprint remains planted on the
  // same CITY_DECK_Y plane instead of floating above the reduced city.
  tower.group.position.y = CITY_DECK_Y * (1 - tower.group.scale.y);
  enableArchitecturalShadows(tower.group);
  scene.add(tower.group);
  // AO describes the structural edges itself. Explicit near-black line meshes
  // made every little bevel look inked and also entered the normal/depth MRT.
  if (aoOnly) for (const root of [city, tower.group]) root.traverse(object => {
    if (object instanceof THREE.LineSegments && object.name.endsWith('-outline')) object.visible = false;
  });
  const upperEvent = sharedSky ? (() => {
    tower.group.updateMatrixWorld(true);
    const towerBounds = new THREE.Box3().setFromObject(tower.group);
    // The upper composition has its own stable anchor. Revising battlements
    // or the open crown arch must not move the accepted moon/cloud layout.
    const anchor = tower.group.userData.upperEventAnchor as number[] | undefined;
    const crown = anchor
      ? tower.group.localToWorld(new THREE.Vector3().fromArray(anchor))
      : towerBounds.getCenter(new THREE.Vector3()).setY(towerBounds.max.y);
    const stage = createUpperEvent(crown, tower.group.getWorldQuaternion(new THREE.Quaternion()));
    INSPECTION_PRESETS.upper = createUpperInspectionPreset(stage.layout, camera.aspect);
    stage.matter.controls.strength.value = url.searchParams.get('matter') === '0' ? 0 : 1;
    if (upperMatterToggle) upperMatterToggle.checked = stage.matter.controls.strength.value > 0;
    return stage;
  })() : null;
  const tour = tourMode && upperEvent ? new SceneTourDirector(camera, upperEvent.layout) : null;
  const getsuga = createGetsuga();
  scene.add(getsuga.group);
  const wordmark = createTitleWordmark();
  scene.add(wordmark.group);
  const lightning = createChargeLightning();
  scene.add(lightning.group);
  const embers = createEmberFallout();
  scene.add(embers.group);

  const citadelShadows = aoOnly
    ? await createCitadelShadows(renderer, tower.group, moonKey) : null;
  if (citadelShadows && url.searchParams.get('citadel-shadows') === '0') citadelShadows.controls.strength.value = 0;

  // The inspection view is also the visual-development master, so it needs a
  // clearly readable post stack rather than a nearly raw drafting render.
  // Growth uses a non-toon material and is therefore skipped by the inverted-
  // hull outline while remaining in the beauty/emissive buffers.
  const inspectionPostFxEnabled = url.searchParams.get('postfx') !== '0' && !aoOnly;
  const inspectionRenderPipeline = new THREE.RenderPipeline(renderer);
  const inspectionScenePass = inspectionPostFxEnabled
    ? toonOutlinePass(scene, camera, new THREE.Color(0x17101f), 0.00072, 0.58)
    : pass(scene, camera);
  // Normal alpha carries the citadel's unsmoothed shadow drawing.
  inspectionScenePass.setMRT(mrt({ output, emissive, normal: vec4(normalView, 0) }));
  const inspectionSceneColor = inspectionScenePass.getTextureNode('output');
  const inspectionEmissiveColor = inspectionScenePass.getTextureNode('emissive');
  const inspectionNormal = inspectionScenePass.getTextureNode('normal');
  const inspectionDepth = inspectionScenePass.getTextureNode('depth');
  const inspectionAoPass = ao(inspectionDepth, inspectionNormal, camera);
  inspectionAoPass.resolutionScale = 0.5;
  inspectionAoPass.radius.value = aoOnly ? 20 : 16;
  inspectionAoPass.thickness.value = 24;
  inspectionAoPass.distanceExponent.value = 1.45;
  inspectionAoPass.distanceFallOff.value = 0.52;
  inspectionAoPass.scale.value = aoOnly ? 2.35 : 1.65;
  inspectionAoPass.samples.value = 12;
  const inspectionAoTexture = inspectionAoPass.getTextureNode();
  // A second, tighter GTAO layer supplies neutral contact separation over the
  // broad violet atmosphere. It is deliberately cheaper and much weaker.
  const inspectionSeparationAoPass = ao(inspectionDepth, inspectionNormal, camera);
  inspectionSeparationAoPass.resolutionScale = 0.5;
  inspectionSeparationAoPass.radius.value = 6;
  inspectionSeparationAoPass.thickness.value = 8;
  inspectionSeparationAoPass.distanceExponent.value = 1.55;
  inspectionSeparationAoPass.distanceFallOff.value = 0.62;
  inspectionSeparationAoPass.scale.value = 1.65;
  inspectionSeparationAoPass.samples.value = 8;
  const inspectionSeparationAoTexture = inspectionSeparationAoPass.getTextureNode();
  const architectureToon = aoOnly ? createArchitectureToon(
    inspectionSceneColor, inspectionDepth, inspectionNormal, inspectionSeparationAoTexture, camera,
  ) : null;
  const inspectionAoDenoisePass = denoise(
    inspectionAoTexture,
    inspectionDepth,
    inspectionNormal,
    camera,
  );
  inspectionAoDenoisePass.radius.value = aoOnly ? 4 : 3;
  inspectionAoDenoisePass.depthPhi.value = 8;
  inspectionAoDenoisePass.normalPhi.value = aoOnly ? 6 : 12;
  const inspectionAoDenoised = nodeObject(inspectionAoDenoisePass) as unknown as ReturnType<typeof vec4>;
  const inspectionOcclusion = inspectionAoDenoised.r.oneMinus();
  // Keep more blue than red/green in creases, matching the violet ambient
  // light instead of treating AO as a neutral black-and-white multiply.
  const inspectionAoTint = vec3(1).sub(
    vec3(0.46, 0.52, 0.36).mul(inspectionOcclusion),
  );
  const inspectionOccludedColor = vec4(
    (architectureToon?.color ?? inspectionSceneColor.rgb).mul(inspectionAoTint),
    1,
  );
  const inspectionBloomPass = bloom(inspectionEmissiveColor, 0.68, 0.34, 0.12);
  inspectionBloomPass.smoothWidth.value = 0.16;
  const inspectionComposite = inspectionOccludedColor.add(inspectionBloomPass);
  const inspectionContrast = inspectionComposite.rgb.sub(0.5).mul(1.055).add(0.5);
  const inspectionVignette = vec4(
    vignette(inspectionContrast, float(0.1), float(0.66)),
    1,
  );
  const inspectionSharpenPass = sharpen(inspectionVignette, 1.05, true);
  // Retain the actual stone/crystal beauty and its directional lighting.
  // Replacing it with 1 - AO made every exposed surface white regardless of
  // the lights; emissive window markers were needed only for that old mask.
  const inspectionSeparationFactor = (architectureToon?.contact ?? inspectionSeparationAoTexture.r).mul(0.34).add(0.66);
  const inspectionLitArchitecture = inspectionOccludedColor.rgb.mul(inspectionSeparationFactor);
  const inspectionShadowedArchitecture = citadelShadows?.apply(
    inspectionLitArchitecture, inspectionDepth, inspectionNormal,
  ) ?? inspectionLitArchitecture;
  const architectureGrade = createArchitectureGrade(
    aoOnly ? inspectionShadowedArchitecture
      : inspectionPostFxEnabled ? inspectionSharpenPass.rgb : inspectionSceneColor.rgb,
    inspectionDepth.r,
    camera,
    upperEvent?.layout.crown.y ?? new THREE.Box3().setFromObject(tower.group).max.y,
    // The AO route never composited the emissive bloom; luminous crystals
    // were graded down with the stone. Add their glow after the height gain.
    aoOnly ? (inspectionBloomPass as unknown as ReturnType<typeof vec4>).rgb : null,
  );
  const cityHaze = upperEvent ? createCityHaze(
    inspectionDepth.r, camera, upperEvent.clouds.noise,
    upperEvent.clouds.motionTime, CITY_DECK_Y, TOWER_Z,
  ) : null;
  if (cityHaze && url.searchParams.get('city-haze') === '0') cityHaze.controls.strength.value = 0;
  inspectionRenderPipeline.outputNode = architectureGrade.output;

  const upperComposite = upperEvent ? createUpperEventComposite(
    upperEvent, camera, inspectionScenePass,
    inspectionRenderPipeline.outputNode as ReturnType<typeof vec4>,
    cityHaze?.layer,
  ) : null;
  if (upperComposite) inspectionRenderPipeline.outputNode = upperComposite.output;
  const storyAtmosphere = tour && upperEvent
    ? new SceneAtmosphereDirector(upperEvent, architectureGrade, cityHaze) : null;

  const frameTransition = new FrameTransition();
  let viewMode: SceneViewMode = url.searchParams.get('view') === 'frames' ? 'frames' : 'cinema';
  let selectedFrame = -1;
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  let frameMotion = !reducedMotion.matches && url.searchParams.get('motion') !== '0';
  let frameLifeTime = 0;
  const travelBlur = tour ? createFrameTravelBlur(inspectionRenderPipeline.outputNode as THREE.Node<'vec4'>) : null;
  if (travelBlur) inspectionRenderPipeline.outputNode = travelBlur.output;
  const travelPreviewCamera = camera.clone();
  const travelPreview = tour && upperEvent ? new SceneTourDirector(travelPreviewCamera, upperEvent.layout) : null;
  const frameFlight = tour && upperEvent ? new FrameFlight(city, upperEvent.layout) : null;
  frameFlight?.warm(camera.aspect);
  const travelAim = new THREE.Vector3();
  const travelFocus = new THREE.Vector2(.5, .5);
  const previousViewPoint = new THREE.Vector3();
  const smearDirection = new THREE.Vector2();

  const filmRenderPipeline = new THREE.RenderPipeline(renderer);
  const scenePass = toonOutlinePass(
    scene,
    camera,
    new THREE.Color(0x080610),
    0.0012,
    0.78,
  );
  scenePass.setMRT(mrt({ output, emissive, normal: normalView }));
  const sceneColor = scenePass.getTextureNode('output');
  const emissiveColor = scenePass.getTextureNode('emissive');
  const filmAoPass = ao(
    scenePass.getTextureNode('depth'),
    scenePass.getTextureNode('normal'),
    camera,
  );
  filmAoPass.resolutionScale = 0.5;
  filmAoPass.radius.value = 12;
  filmAoPass.thickness.value = 18;
  filmAoPass.distanceExponent.value = 1.4;
  filmAoPass.distanceFallOff.value = 0.58;
  filmAoPass.scale.value = 1.4;
  filmAoPass.samples.value = 8;
  const filmAoMask = filmAoPass.getTextureNode().r.mul(0.32).add(0.68);
  const sceneColorWithAo = sceneColor.mul(vec4(vec3(filmAoMask), 1));

  const bloomPass = bloom(emissiveColor, 0.62, 0.58, 0.11);
  bloomPass.smoothWidth.value = 0.18;
  const highlightBloomPass = bloom(sceneColorWithAo, 0.055, 0.28, 0.72);
  highlightBloomPass.smoothWidth.value = 0.08;
  const focusDistance = uniform(director.focusDistance);
  const focusRange = uniform(director.focusRange);
  const bokehScale = uniform(director.bokehScale);
  const compositedScene = sceneColorWithAo.add(bloomPass).add(highlightBloomPass);
  const depthOfFieldPass = dof(
    compositedScene,
    scenePass.getViewZNode(),
    focusDistance,
    focusRange,
    bokehScale,
  );
  filmRenderPipeline.outputNode = depthOfFieldPass;

  // Debug handle for capture diagnostics: ?debug=1 exposes the live scene.
  if (url.searchParams.get('debug') === '1') {
    (globalThis as Record<string, unknown>).__threefxDebug = {
      scene,
      camera,
      orbitControls,
      tour,
      storyAtmosphere,
      frameTransition, frameFlight, travelBlur, pacing,
      viewer: { get mode() { return viewMode; }, get selectedFrame() { return selectedFrame; }, get live() { return frameMotion; }, get lifeTime() { return frameLifeTime; } },
      wordmark,
      upperEvent,
      upperComposite,
      architectureGrade,
      architectureToon,
      citadelShadows,
      cityHaze,
      inspectionScenePass,
      renderer,
      moonKey,
      castleSpot,
      bloomPass,
      filmAoPass,
      inspectionAoPass,
      inspectionSeparationAoPass,
      inspectionAoDenoisePass,
      inspectionBloomPass,
      inspectionSharpenPass,
      highlightBloomPass,
      depthOfFieldPass,
      focusDistance,
      focusRange,
      bokehScale,
    };
  }

  const exactTime = Number(url.searchParams.get('t') ?? url.searchParams.get('ft'));
  let currentTime = inspectionPreset
    ? INSPECTION_PRESETS[inspectionPreset].time
    : Number.isFinite(exactTime) && exactTime >= 0
      ? Math.min(filmDuration, exactTime)
      : 0;
  let playing = !inspectionPreset && (!tourMode || viewMode === 'cinema')
    && !url.searchParams.has('paused')
    && !url.searchParams.has('t')
    && !url.searchParams.has('ft')
    && !(tourMode && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  let previousNow = performance.now();
  // A suspended tab resumes from the same story beat. Its first new frame
  // must not turn the background interval into a camera/weather jump.
  document.addEventListener('visibilitychange', () => { previousNow = performance.now(); });
  let uiIdleTimer = 0;
  let performanceWindowStart = previousNow;
  let performanceFrameCount = 0;
  const performanceWarmupUntil = previousNow + 1_600;
  const drawingBufferSize = new THREE.Vector2();

  // DOM writes happen only once per 750ms window. This keeps the monitor
  // useful on a phone without turning the monitor itself into frame workload.
  const updatePerformanceMonitor = (wallNow: number): void => {
    if (document.visibilityState !== 'visible' || wallNow < performanceWarmupUntil) {
      performanceWindowStart = wallNow;
      performanceFrameCount = 0;
      return;
    }

    performanceFrameCount += 1;
    const elapsed = wallNow - performanceWindowStart;
    if (elapsed < 750) return;

    const fps = performanceFrameCount * 1000 / Math.max(1, elapsed);
    const frameMs = elapsed / Math.max(1, performanceFrameCount);
    const state = fps >= 50 && frameMs <= 20
      ? 'good'
      : fps >= 35 && frameMs <= 28.6
        ? 'warn'
        : 'critical';

    performanceMonitor.dataset.state = state;
    performanceStatus.textContent = state === 'good'
      ? 'GOOD'
      : state === 'warn'
        ? 'WATCH'
        : 'OVER';
    performanceFps.value = fps.toFixed(fps >= 100 ? 0 : 1);
    performanceFrame.value = `${frameMs.toFixed(frameMs >= 10 ? 1 : 2)}ms`;
    performanceDraws.value = formatCompactCount(renderer.info.render.drawCalls);
    performanceTriangles.value = formatCompactCount(renderer.info.render.triangles);
    performanceMemory.value = formatMemory(renderer.info.memory.total);

    renderer.getDrawingBufferSize(drawingBufferSize);
    performanceResolution.textContent = [
      `RENDER ${Math.round(drawingBufferSize.x)}×${Math.round(drawingBufferSize.y)}`,
      `DPR ${renderer.getPixelRatio().toFixed(2)}`,
      isMobileRenderTarget() ? 'PHONE CAP' : 'DESKTOP CAP',
    ].join(' · ');

    performanceWindowStart = wallNow;
    performanceFrameCount = 0;
  };

  const setPlaying = (value: boolean): void => {
    frameTransition.cancel();
    if (value && tourMode) {
      if (viewMode === 'frames' && currentTime < filmDuration && frameFlight && travelPreview && tour) {
        travelPreviewCamera.aspect = camera.aspect; travelPreview.update(currentTime);
        frameFlight.start(camera, tour.target, travelPreviewCamera, travelPreview.target);
        frameTransition.start(currentTime, currentTime, reducedMotion.matches, 0, 0, frameFlight.length);
      }
      viewMode = 'cinema'; selectedFrame = -1;
    }
    if (value && tourMode && currentTime >= filmDuration) currentTime = 0;
    playing = value;
    playButton.dataset.playing = String(playing);
    if (!tourMode) playButton.textContent = playing ? 'Ⅱ' : '▶';
    playButton.setAttribute('aria-label', playing ? 'Pause' : 'Play');
  };
  setPlaying(playing);

  const activateInspectionPreset = (name: InspectionPresetName): void => {
    inspectionNavigation.reset();
    inspectionCameraMoved = false;
    if (name === 'upper' && upperEvent) {
      INSPECTION_PRESETS.upper = createUpperInspectionPreset(upperEvent.layout, camera.aspect, upperShot);
      skyVisible = true;
      url.searchParams.delete('sky');
    }
    const preset = INSPECTION_PRESETS[name];
    inspectionPreset = name;
    currentTime = name === 'upper' ? upperTime : preset.time;
    if (upperControls) upperControls.hidden = name !== 'upper';
    if (skyLayerControl) skyLayerControl.hidden = !upperEvent;
    if (skyLayerToggle) skyLayerToggle.checked = skyVisible;
    document.body.classList.toggle('upper-mode', name === 'upper');
    const heading = inspection.querySelector('span');
    if (heading) heading.textContent = name === 'upper' ? 'GETSUGA · FINAL VIEW' : 'ARCHITECTURE INSPECTION';
    setPlaying(false);
    document.body.classList.add('inspection-mode');
    document.body.classList.remove('hud-hidden');
    controls.inert = false; controls.removeAttribute('aria-hidden');
    document.querySelector<HTMLButtonElement>('#restore-controls')!.hidden = true;
    inspection.hidden = landingMode;
    scene.fog = null;
    inspectionFill.intensity = 0.08;
    orbitControls.enabled = !landingMode;
    // The old 21.6-degree upward limit silently lifted the new low camera
    // above the roofs. Allow the anime street-to-sky angle for this preset.
    orbitControls.maxPolarAngle = Math.PI * (name === 'upper' ? 0.86 : 0.62);
    camera.position.fromArray(preset.position);
    orbitControls.target.fromArray(preset.target);
    camera.fov = preset.fov;
    // Every AO preset shares the sky. Its volume exit faces must stay inside
    // the frustum, including when the city camera is raised above the island.
    camera.far = sharedSky ? 4200 : 2200;
    camera.updateProjectionMatrix();
    orbitControls.update();
    for (const button of inspectionCameraButtons) {
      button.setAttribute(
        'aria-pressed',
        String(button.dataset.inspectCamera === name),
      );
    }
    if (!landingMode) url.searchParams.set('inspect', name);
    url.searchParams.delete('t');
    url.searchParams.delete('ft');
    url.searchParams.delete('paused');
    window.history.replaceState(null, '', url);
  };

  // Start the tour only from the explicit button. Esc/0 keeps its existing
  // inspector behaviour and must not navigate an AO review into the film.
  filmModeButton.hidden = false;
  filmModeButton.disabled = false;
  filmModeButton.textContent = 'Смотреть проходку';
  const leaveInspection = (): void => {
    if (aoOnly) return;
    window.location.href = `${window.location.pathname}?film`;
  };

  if (inspectionPreset) activateInspectionPreset(inspectionPreset);

  const syncUpperCameraUi = (): void => {
    for (const [id, key, scale, suffix] of [
      ['fov', 'fov', 1, '°'], ['distance', 'distance', 1, ''],
      ['height', 'height', 1, ''], ['frame', 'frameY', 100, '%'], ['azimuth', 'azimuth', 1, '°'],
    ] as const) {
      const value = String(Math.round(upperShot[key] * scale));
      const input = document.querySelector<HTMLInputElement>(`#upper-${id}`);
      const output = document.querySelector<HTMLOutputElement>(`#upper-${id}-value`);
      if (input) input.value = value;
      if (output) output.value = value + suffix;
    }
    const summary = document.querySelector<HTMLOutputElement>('#upper-lens-summary');
    if (summary) summary.value = `${Math.round(upperShot.fov)}°`;
    for (const button of document.querySelectorAll<HTMLButtonElement>('[data-upper-shot]')) {
      const preset = UPPER_SHOT_PRESETS[button.dataset.upperShot as keyof typeof UPPER_SHOT_PRESETS];
      button.setAttribute('aria-pressed', String(Object.keys(preset).every(key =>
        Math.abs(preset[key as keyof UpperShotSettings] - upperShot[key as keyof UpperShotSettings]) < 0.001)));
    }
  };
  const applyUpperShot = (): void => {
    if (!upperEvent || inspectionPreset !== 'upper') return;
    for (const [key, param] of [
      ['fov', 'ufov'], ['distance', 'udist'], ['height', 'uheight'], ['frameY', 'uframe'], ['azimuth', 'uazimuth'],
    ] as const) url.searchParams.set(param, String(upperShot[key]));
    // Clear residual orbit damping before applying the authored pose.
    const damping = orbitControls.enableDamping;
    orbitControls.enableDamping = false; orbitControls.update();
    activateInspectionPreset('upper');
    orbitControls.enableDamping = damping;
    syncUpperCameraUi();
  };
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-upper-shot]')) {
    button.addEventListener('click', () => {
      Object.assign(upperShot, UPPER_SHOT_PRESETS[button.dataset.upperShot as keyof typeof UPPER_SHOT_PRESETS]);
      applyUpperShot();
    });
  }
  for (const [id, key, scale] of [
    ['fov', 'fov', 1], ['distance', 'distance', 1], ['height', 'height', 1], ['frame', 'frameY', 100], ['azimuth', 'azimuth', 1],
  ] as const) document.querySelector<HTMLInputElement>(`#upper-${id}`)?.addEventListener('input', event => {
    upperShot[key] = Number((event.target as HTMLInputElement).value) / scale;
    applyUpperShot();
  });
  syncUpperCameraUi();

  const restoreControls = document.querySelector<HTMLButtonElement>('#restore-controls')!;
  const hidePanel = document.querySelector<HTMLButtonElement>('#hide-panel')!;
  const setHud = (visible: boolean): void => {
    if (visible) uiIdleTimer = 0;
    document.body.classList.toggle('hud-hidden', !visible);
    controls.classList.toggle('is-hidden', !visible);
    controls.inert = !visible;
    controls.setAttribute('aria-hidden', String(!visible));
    restoreControls.hidden = visible || !tourMode || !!inspectionPreset;
  };
  hidePanel.addEventListener('click', () => { setHud(false); restoreControls.focus({ preventScroll: true }); });
  restoreControls.addEventListener('click', () => { setHud(true); hidePanel.focus({ preventScroll: true }); });
  if (url.searchParams.get('hud') === '0') setHud(false);

  playButton.addEventListener('click', () => {
    if (!inspectionPreset) setPlaying(!playing);
  });
  timeline.addEventListener('input', () => {
    currentTime = pacing ? pacing.storyAt(Number(timeline.value)) : Number(timeline.value);
    selectedFrame = -1;
    setPlaying(false);
    if (tourMode) {
      viewMode = 'cinema';
      url.searchParams.delete('view'); url.searchParams.delete('ft');
      url.searchParams.set('t', String(currentTime)); url.searchParams.set('paused', '');
      window.history.replaceState(null, '', url);
    }
  });
  const chooseFrame = (index: number): void => {
    if (!tour || inspectionPreset) return;
    const frame = SCENE_TOUR_FRAMES[Math.max(0, Math.min(SCENE_TOUR_FRAMES.length - 1, index))]!;
    const incomingSmear = frameTransition.amount;
    const incomingPush = frameTransition.push;
    setPlaying(false); viewMode = 'frames'; selectedFrame = SCENE_TOUR_FRAMES.indexOf(frame);
    strikeQuincyControl(document.querySelector<HTMLButtonElement>(`[data-frame="${selectedFrame}"]`));
    travelPreviewCamera.aspect = camera.aspect;
    travelPreview!.updateFrame(frame.time);
    frameFlight!.start(camera, tour.target, travelPreviewCamera, travelPreview!.target);
    frameTransition.start(currentTime, frame.time, reducedMotion.matches, incomingSmear, incomingPush, frameFlight!.length);
    if (!frameTransition.active) currentTime = frameTransition.time;
    if (!document.body.classList.contains('hud-hidden')) setHud(true);
    url.searchParams.set('view', 'frames'); url.searchParams.set('t', String(frame.time));
    url.searchParams.set('paused', ''); window.history.replaceState(null, '', url);
  };
  const stepFrame = (direction: number): void => {
    let index = selectedFrame;
    if (index < 0) {
      index = direction > 0
        ? SCENE_TOUR_FRAMES.findIndex(frame => frame.time > currentTime + .05) - 1
        : SCENE_TOUR_FRAMES.findLastIndex(frame => frame.time < currentTime - .05) + 1;
      if (direction > 0 && index === -2) index = SCENE_TOUR_FRAMES.length - 1;
    }
    chooseFrame(index + direction);
  };
  const navigation = tour ? createSceneNavigation(SCENE_TOUR_FRAMES, {
    mode: mode => {
      if (inspectionPreset) return;
      setPlaying(mode === 'cinema'); viewMode = mode; selectedFrame = -1; setHud(true);
      url.searchParams.delete('t'); url.searchParams.delete('ft');
      if (mode === 'frames') { url.searchParams.set('view', 'frames'); url.searchParams.set('paused', ''); }
      else { url.searchParams.delete('view'); url.searchParams.delete('paused'); }
      window.history.replaceState(null, '', url);
    },
    frame: chooseFrame, step: stepFrame,
    motion: () => {
      frameMotion = !frameMotion;
      url.searchParams.set('motion', frameMotion ? '1' : '0');
      window.history.replaceState(null, '', url);
    },
  }) : null;
  if (tourMode) createQuincyInterface();
  reducedMotion.addEventListener('change', () => {
    if (reducedMotion.matches) { frameMotion = false; if (selectedFrame >= 0) currentTime = SCENE_TOUR_FRAMES[selectedFrame]!.time; setPlaying(false); if (travelBlur) travelBlur.amount.value = 0; }
  });
  hudButton.addEventListener('click', () => setHud(false));
  inspectButton.addEventListener('click', () => activateInspectionPreset('street'));
  filmModeButton.addEventListener('click', () => {
    window.location.href = `${window.location.pathname}?film=tour`;
  });
  for (const button of inspectionCameraButtons) {
    button.addEventListener('click', () => {
      const name = button.dataset.inspectCamera ?? null;
      if (name === 'upper' && !upperEvent) {
        window.location.href = `${window.location.pathname}?inspect=upper&ao-only=1`;
      } else if (isInspectionPresetName(name)) activateInspectionPreset(name);
    });
  }
  upperMatterToggle?.addEventListener('change', () => {
    if (!upperEvent) return;
    upperEvent.matter.controls.strength.value = upperMatterToggle.checked ? 1 : 0;
    if (upperMatterToggle.checked) url.searchParams.delete('matter');
    else url.searchParams.set('matter', '0');
    window.history.replaceState(null, '', url);
  });
  skyLayerToggle?.addEventListener('change', () => {
    skyVisible = skyLayerToggle.checked;
    if (skyVisible) url.searchParams.delete('sky');
    else url.searchParams.set('sky', '0');
    window.history.replaceState(null, '', url);
  });
  const setUpperTime = (time: number): void => {
    if (!Number.isFinite(time)) return;
    upperTime = Math.max(BEATS.anticipation, Math.min(FILM_DURATION, time));
    if (!upperMotionPlaying) {
      upperMotionTime = upperTime;
      url.searchParams.set('mt', upperMotionTime.toFixed(3));
    }
    url.searchParams.set('ut', upperTime.toFixed(3));
    window.history.replaceState(null, '', url);
  };
  upperTimeline?.addEventListener('input', () => setUpperTime(Number(upperTimeline.value)));
  for (const button of upperBeatButtons) {
    button.addEventListener('click', () => {
      const beat = UPPER_BEATS[Number(button.dataset.upperBeat)];
      if (beat) setUpperTime(beat.time);
    });
  }
  const syncUpperMotionButton = (): void => {
    if (!upperMotionButton) return;
    upperMotionButton.setAttribute('aria-pressed', String(upperMotionPlaying));
    upperMotionButton.textContent = upperMotionPlaying ? 'Ⅱ ПАУЗА ОБЛАКОВ' : '▶ ДВИЖЕНИЕ ОБЛАКОВ';
  };
  syncUpperMotionButton();
  upperMotionButton?.addEventListener('click', () => {
    upperMotionPlaying = !upperMotionPlaying;
    if (upperMotionPlaying) {
      url.searchParams.delete('sky-motion');
      url.searchParams.delete('mt');
    } else {
      url.searchParams.set('sky-motion', '0');
      url.searchParams.set('mt', upperMotionTime.toFixed(3));
    }
    syncUpperMotionButton();
    window.history.replaceState(null, '', url);
  });
  canvas.addEventListener('pointerdown', () => {
    if (landingMode) return;
    if (inspectionPreset) { canvas.focus({ preventScroll: true }); return; }
    if (tourMode && viewMode === 'frames') { setHud(true); return; }
    const hidden = document.body.classList.contains('hud-hidden');
    if (hidden) setHud(true);
    else setPlaying(!playing);
  });
  window.addEventListener('keydown', (event) => {
    if (landingMode) return;
    // Physical number keys also work on Russian layouts and the numeric keypad.
    // Preserve browser shortcuts, text entry and a held key's repeat behavior.
    const typing = event.target instanceof HTMLElement && event.target.closest('textarea, select, [contenteditable], input:not([type=range])');
    const chapter = event.code.match(/^(?:Digit|Numpad)([1-7])$/) ?? event.key.match(/^([1-7])$/);
    if (tourMode && !inspectionPreset && !typing && chapter
      && !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      if (!event.repeat) chooseFrame(Number(chapter[1]) - 1);
      return;
    }
    const editing = event.target instanceof HTMLElement && event.target.closest('input, textarea, select, [contenteditable]');
    if (!inspectionPreset && !editing && (event.code === 'KeyH' || event.key.toLowerCase() === 'h')) {
      event.preventDefault();
      const show = document.body.classList.contains('hud-hidden'); setHud(show);
      if (tourMode) (show ? hidePanel : restoreControls).focus({ preventScroll: true });
      return;
    }
    if (!inspectionPreset && !editing && tourMode && viewMode === 'frames' && (event.key === 'ArrowRight' || event.key === 'ArrowLeft')) {
      event.preventDefault(); stepFrame(event.key === 'ArrowRight' ? 1 : -1); return;
    }
    if (event.target instanceof HTMLElement && event.target.closest('button, a, input, textarea, select')) return;
    if (inspectionPreset && ['1', '2', '3', '4', '5'].includes(event.key)) {
      const names: InspectionPresetName[] = ['street', 'quarter', 'city', 'citadel', 'upper'];
      const name = names[Number(event.key) - 1];
      if (name === 'upper' && !upperEvent) {
        window.location.href = `${window.location.pathname}?inspect=upper&ao-only=1`;
      } else if (name) activateInspectionPreset(name);
      return;
    }
    if (inspectionPreset && (event.key === 'Escape' || event.key === '0')) {
      leaveInspection();
      return;
    }
    if (event.code === 'Space') {
      if (inspectionPreset) return;
      event.preventDefault();
      setPlaying(!playing);
    }
    if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
      if (inspectionPreset) return;
      const direction = event.key === 'ArrowRight' ? 1 : -1;
      if (tourMode && viewMode === 'frames') { event.preventDefault(); stepFrame(direction); return; }
      currentTime = Math.max(0, Math.min(filmDuration, currentTime + direction * 0.1));
      setPlaying(false);
    }
  });

  const resize = (): void => {
    camera.aspect = window.innerWidth / window.innerHeight;
    if (inspectionPreset === 'upper' && upperEvent && !inspectionCameraMoved) {
      // Keep the selected final-shot lens/height when adapting the framing.
      // A freely moved camera keeps its pose instead of snapping to the preset.
      const preset = createUpperInspectionPreset(upperEvent.layout, camera.aspect, upperShot);
      camera.position.fromArray(preset.position);
      orbitControls.target.fromArray(preset.target);
      camera.fov = preset.fov;
      orbitControls.update();
    }
    camera.updateProjectionMatrix();
    renderer.setPixelRatio(getRenderPixelRatio());
    renderer.setSize(window.innerWidth, window.innerHeight);
    if (frameTransition.active && viewMode === 'frames' && selectedFrame >= 0) chooseFrame(selectedFrame);
  };
  window.addEventListener('resize', resize);

  if (tour && storyAtmosphere && !inspectionPreset) {
    await showLoading('Готовим движение…');
    // Compile/upload both the night and illuminated passes under the loading
    // screen. A first visible event must not pay for the hidden lunar volume,
    // and the first street frames must not race outstanding GPU uploads.
    getsuga.group.visible = wordmark.group.visible = lightning.group.visible = embers.group.visible = false;
    for (const time of [19.8, currentTime, currentTime]) {
      tour.update(time);
      storyAtmosphere.update(tour.state);
      inspectionRenderPipeline.render();
      const backend = renderer.backend;
      if ('device' in backend && backend.device instanceof GPUDevice) {
        await backend.device.queue.onSubmittedWorkDone();
      }
      if (deviceStatus.failed) return;
    }
  }

  await showLoading('Настраиваем свет…');
  if (deviceStatus.failed) return;
  previousNow = performance.now();
  let firstFrame = true;
  renderer.setAnimationLoop(() => {
    if (deviceStatus.failed) return;
    const wallNow = performance.now();
    // WebGPU software fallbacks can render only a few frames per second. Keep the
    // edit locked to wall time while still rejecting very long background-tab jumps.
    const delta = Math.min(1, Math.max(0, (wallNow - previousNow) / 1000));
    previousNow = wallNow;
    if (!firstFrame && tour && !inspectionPreset && viewMode === 'frames' && frameMotion && document.visibilityState === 'visible') {
      frameLifeTime += Math.min(.1, delta);
    }
    if (!firstFrame && frameTransition.active && !inspectionPreset && document.visibilityState === 'visible') {
      currentTime = frameTransition.update(delta);
    }
    if (!firstFrame && playing && !frameTransition.active && !inspectionPreset && (!tourMode || document.visibilityState === 'visible')) {
      currentTime = pacing ? pacing.storyAt(pacing.filmAt(currentTime) + delta) : currentTime + delta;
      if (currentTime >= filmDuration) {
        if (tourMode) { currentTime = filmDuration; setPlaying(false); if (!document.body.classList.contains('hud-hidden')) setHud(true); }
        else currentTime %= filmDuration;
      }
    }

    // Undo only the temporary frame-travel crop before sampling any camera.
    if (camera.view?.enabled) camera.clearViewOffset();
    if (inspectionPreset) {
      if (travelBlur) travelBlur.amount.value = 0;
      currentTime = inspectionPreset === 'upper' ? upperTime : INSPECTION_PRESETS[inspectionPreset].time;
      orbitControls.update();
      inspectionNavigation.update(delta);
    } else if (tour) {
      previousViewPoint.set(0, 0, -400).applyMatrix4(camera.matrixWorld);
      if (frameTransition.active && frameFlight) {
        tour.state.update(currentTime);
        frameFlight.sample(frameTransition.progress, camera);
        tour.target.copy(frameFlight.target);
      } else if (viewMode === 'frames') tour.updateFrame(currentTime);
      else tour.update(currentTime);
      if (travelBlur) {
        const amount = reducedMotion.matches ? 0 : Math.max(frameTransition.amount,
          viewMode === 'cinema' && playing ? Math.max(tour.motionSmear, .11 * (pacing?.rushAt(currentTime) ?? 0)) : 0);
        travelBlur.amount.value = amount;
        if (amount > 0) {
          const follow = 1 - Math.exp(-delta * 8);
          if (travelPreview) {
            travelPreviewCamera.aspect = camera.aspect;
            if (frameTransition.active && frameFlight) travelAim.copy(frameFlight.lookAhead);
            else { travelPreview.update(Math.min(filmDuration, currentTime + .25)); travelAim.copy(travelPreviewCamera.position); }
            travelAim.sub(camera.position).transformDirection(camera.matrixWorldInverse);
            // A bounded vanishing point leads the turn, including reverse travel.
            // Positive depth avoids a projected point flipping behind the lens.
            const depth = Math.max(.4, -travelAim.z);
            const tangent = Math.tan(THREE.MathUtils.degToRad(camera.fov) * .5);
            travelFocus.set(.5 + travelAim.x / (2 * tangent * camera.aspect * depth),
              .5 - travelAim.y / (2 * tangent * depth)).clampScalar(.26, .74);
            travelBlur.focus.value.lerp(travelFocus, follow);
          }
          previousViewPoint.project(camera);
          const shutter = .3 / (60 * Math.max(.008, delta));
          smearDirection.set(previousViewPoint.x * shutter, -previousViewPoint.y * shutter).clampScalar(-.12, .12);
          travelBlur.direction.value.lerp(smearDirection, follow);
          // Off-axis lens push into the next direction; never widen the lens.
          // World-space position follows the selected clear spatial corridor.
          const zoom = 1 + frameTransition.push * .46, crop = 1 - 1 / zoom;
          camera.setViewOffset(camera.aspect, 1, travelBlur.focus.value.x * camera.aspect * crop,
            travelBlur.focus.value.y * crop, camera.aspect / zoom, 1 / zoom);
        } else {
          travelBlur.direction.value.set(0, 0); travelBlur.focus.value.set(.5, .5);
        }
      }
    } else {
      director.update(currentTime);
    }
    tower.update(currentTime);
    if (upperEvent) {
      // The sky has its own review time, independent of fixed city-camera
      // times (10.4s, before the event). Keep it visible when orbiting upward.
      if (inspectionPreset && skyVisible && upperMotionPlaying && document.visibilityState === 'visible') {
        upperMotionTime += delta;
      }
      if (tour && !inspectionPreset && storyAtmosphere) {
        storyAtmosphere.update(tour.state, frameLifeTime);
      } else {
        storyAtmosphere?.restore();
        upperEvent.update(inspectionPreset && skyVisible ? upperTime : 0, upperMotionTime);
      }
      // Old film FX belong to a different lighting/timing prototype. Do not
      // double-render them or let them pollute the AO masks during this study.
      getsuga.group.visible = wordmark.group.visible = lightning.group.visible = embers.group.visible = false;
      if (upperTimeline) upperTimeline.value = upperTime.toFixed(3);
      if (upperTimeOutput) upperTimeOutput.value = `${upperTime.toFixed(2)} s`;
      for (const button of upperBeatButtons) {
        const beat = UPPER_BEATS[Number(button.dataset.upperBeat)];
        button.setAttribute('aria-pressed', String(!!beat && Math.abs(upperTime - beat.time) < 0.01));
      }
    } else {
      getsuga.update(currentTime);
      wordmark.update(currentTime);
      lightning.update(currentTime);
      embers.update(currentTime);
    }

    const impactFlash = inspectionPreset || tour ? 0 : pulse(BEATS.impact + 0.12, 0.58, currentTime);
    const whiteout = inspectionPreset || tour ? 0 : pulse(BEATS.impact + 0.55, 1.2, currentTime);
    flash.style.opacity = Math.min(0.96, impactFlash * 0.84 + whiteout * 0.24).toFixed(3);
    const aftermath = smoothstep(BEATS.moonBirth, BEATS.scaleReveal, currentTime);
    renderer.toneMappingExposure = inspectionPreset || tour
      ? aoOnly ? 1 : 0.9
      : 0.94 + impactFlash * 0.94 + aftermath * 0.03;
    bloomPass.strength.value = 0.62 + impactFlash * 0.36 + aftermath * 0.06;
    highlightBloomPass.strength.value = 0.055 + impactFlash * 0.06 + aftermath * 0.012;
    if (inspectionPreset) {
      focusDistance.value = camera.position.distanceTo(orbitControls.target);
      focusRange.value = 520;
      bokehScale.value = 0;
    } else {
      focusDistance.value = director.focusDistance;
      focusRange.value = director.focusRange;
      bokehScale.value = director.bokehScale;
    }

    if (!tourMode) titleDirector.update(currentTime);
    const shownTime = pacing ? pacing.filmAt(currentTime) : currentTime;
    timeline.value = shownTime.toFixed(3);
    timeOutput.value = formatTime(shownTime, displayDuration);
    if (tourMode) timeline.style.setProperty('--q-progress', `${(shownTime / displayDuration * 100).toFixed(1)}%`);

    uiIdleTimer += delta;
    navigation?.update(viewMode, currentTime, selectedFrame, frameTransition.active, frameMotion);
    if (!tourMode && playing && !inspectionPreset && uiIdleTimer > 4 && url.searchParams.get('hud') !== '1') setHud(false);

    try {
      if (inspectionPreset || tour) inspectionRenderPipeline.render();
      else filmRenderPipeline.render();
    } catch (error) {
      console.error('WebGPU frame failed', error);
      void renderer.setAnimationLoop(null);
      showWebGpuFallback('render');
      return;
    }
    if (deviceStatus.failed) return;
    if (firstFrame) {
      firstFrame = false;
      previousNow = performance.now();
      loading.hidden = true;
      performance.mark('scene-ready');
      performance.measure('scene-startup', 'scene-start', 'scene-ready');
    }
    updatePerformanceMonitor(wallNow);
    document.body.dataset.ready = 'true';
    document.body.dataset.time = currentTime.toFixed(3);
  });
};

void init().catch((error: unknown) => {
  console.error(error);
  showWebGpuFallback('render');
});
