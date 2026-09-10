import * as THREE from 'three/webgpu';
import type { OrbitControls } from 'three/addons/controls/OrbitControls.js';

/** Translate the camera and orbit target together, keeping the current view. */
export const createInspectionNavigation = (
  camera: THREE.PerspectiveCamera,
  orbit: OrbitControls,
  isActive: () => boolean,
  onMove: () => void,
) => {
  const keys = new Set<string>();
  const movementCodes = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE']);
  const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-camera-lift]'));
  const held = new Map<number, { direction: number; since: number; button: HTMLButtonElement }>();
  const height = document.querySelector<HTMLOutputElement>('#camera-altitude');
  const right = new THREE.Vector3(), forward = new THREE.Vector3(), movement = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  const active = () => isActive() && orbit.enabled && !document.hidden;
  const editing = (target: EventTarget | null) => target instanceof HTMLElement
    && (target.isContentEditable || !!target.closest('input, textarea, select'));
  const reset = () => {
    keys.clear(); held.clear();
    for (const button of buttons) button.removeAttribute('data-held');
  };
  const translate = (offset: THREE.Vector3) => {
    if (!active() || offset.lengthSq() === 0) return;
    camera.position.add(offset); orbit.target.add(offset); onMove();
  };
  window.addEventListener('keydown', event => {
    if (!active() || editing(event.target) || event.ctrlKey || event.metaKey || event.altKey) return;
    if (movementCodes.has(event.code)) {
      event.preventDefault(); keys.add(event.code);
    }
    if (event.code === 'ShiftLeft' || event.code === 'ShiftRight') keys.add(event.code);
  });
  window.addEventListener('keyup', event => keys.delete(event.code));
  window.addEventListener('blur', reset);
  document.addEventListener('visibilitychange', reset);
  document.addEventListener('focusin', event => { if (editing(event.target)) reset(); });
  for (const button of buttons) {
    const direction = Number(button.dataset.cameraLift);
    button.addEventListener('pointerdown', event => {
      if (event.button !== 0 || !active()) return;
      event.preventDefault(); button.setPointerCapture(event.pointerId);
      held.set(event.pointerId, { direction, since: performance.now(), button });
      button.setAttribute('data-held', 'true');
      // A short tap must work even when pointerup happens before the next frame.
      translate(movement.set(0, direction * 8, 0));
    });
    const release = (event: PointerEvent) => {
      held.delete(event.pointerId); button.removeAttribute('data-held');
    };
    button.addEventListener('pointerup', release);
    button.addEventListener('pointercancel', release);
    button.addEventListener('lostpointercapture', release);
    button.addEventListener('click', event => {
      // Keyboard/assistive activation has no pointerdown; pointer clicks already moved.
      if (event.detail === 0) translate(movement.set(0, direction * 8, 0));
    });
  }
  return {
    reset,
    update(delta: number) {
      if (!active()) { reset(); return; }
      const axis = (positive: string, negative: string) => Number(keys.has(positive)) - Number(keys.has(negative));
      right.setFromMatrixColumn(camera.matrixWorld, 0).setY(0).normalize();
      forward.crossVectors(up, right);
      let lift = axis('KeyE', 'KeyQ');
      for (const pointer of held.values()) if (performance.now() - pointer.since > 180) lift += pointer.direction;
      movement.copy(forward).multiplyScalar(axis('KeyW', 'KeyS'))
        .addScaledVector(right, axis('KeyD', 'KeyA')).addScaledVector(up, Math.max(-1, Math.min(1, lift)));
      const speed = keys.has('ShiftLeft') || keys.has('ShiftRight') ? 540 : 180;
      translate(movement.normalize().multiplyScalar(speed * Math.min(delta, 0.1)));
      if (height) height.value = String(Math.round(camera.position.y));
    },
  };
};
