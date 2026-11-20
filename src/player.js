import * as THREE from "three";

const MOVE = new Set(["KeyW", "KeyA", "KeyS", "KeyD", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "ShiftLeft", "ShiftRight"]);
const TAU = Math.PI * 2;
const START_PITCH = 0.14;
const GRAVITY = 18;
const JUMP_SPEED = 6.1;

export function createPlayer(world, canvas, canMove, onClick, onLand) {
  const position = world.spawn.clone();
  const keys = new Set();
  const forward = new THREE.Vector3();
  const right = new THREE.Vector3();
  const eye = new THREE.Vector3();
  const desired = new THREE.Vector3();
  let drawHeight = position.y;
  let yaw = 0.18;
  let pitch = START_PITCH;
  let shoulder = false;
  let drag = null;
  let dragged = false;
  let traveled = 0;
  let sprinting = false;
  let velocityY = 0;
  let isGrounded = true;
  let pointerActive = false;
  let pendingPointer = false;
  let pointerUnavailable = !canvas.requestPointerLock;
  if (pointerUnavailable) canvas.dataset.mouseFallback = "true";

  function lockPointer() {
    if (pointerActive || pendingPointer || !canMove() || !canvas.requestPointerLock) return;
    pendingPointer = true;
    const rejected = () => {
      pendingPointer = false;
      if (document.pointerLockElement === canvas) return;
      pointerUnavailable = true;
      canvas.dataset.mouseFallback = "true";
    };
    try {
      Promise.resolve(canvas.requestPointerLock()).catch(rejected);
    } catch {
      rejected();
    }
  }

  function releasePointer() {
    if (document.pointerLockElement === canvas) document.exitPointerLock();
  }

  function look(dx, dy) {
    yaw = (yaw - dx * 0.0032) % TAU;
    pitch = THREE.MathUtils.clamp(pitch - dy * 0.00285, -1.16, 1.22);
  }

  window.addEventListener("keydown", (event) => {
    if (!canMove() || event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.code === "Space") {
      if (event.target instanceof Element && event.target.closest("button, input")) return;
      event.preventDefault();
      if (!event.repeat) jump();
      return;
    }
    if (!MOVE.has(event.code)) return;
    event.preventDefault();
    keys.add(event.code);
  });
  window.addEventListener("keyup", (event) => keys.delete(event.code));
  window.addEventListener("blur", () => {
    keys.clear();
    drag = null;
  });
  document.addEventListener("visibilitychange", () => keys.clear());
  canvas.addEventListener("contextmenu", (event) => event.preventDefault());
  canvas.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || !canMove()) return;
    dragged = false;
    if (pointerActive || (!pointerUnavailable && event.pointerType !== "touch")) return;
    drag = { id: event.pointerId, x: event.clientX, y: event.clientY, distance: 0 };
    canvas.setPointerCapture(event.pointerId);
  });
  canvas.addEventListener("pointermove", (event) => {
    if (!drag || drag.id !== event.pointerId || !canMove() || document.pointerLockElement === canvas) return;
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    drag.distance += Math.hypot(dx, dy);
    drag.x = event.clientX;
    drag.y = event.clientY;
    if (drag.distance > 3) look(dx, dy);
  });
  canvas.addEventListener("pointerup", (event) => {
    const click = drag?.id === event.pointerId && drag.distance < 5;
    dragged = Boolean(drag && !click);
    drag = null;
    if (click && canMove() && event.pointerType === "touch") onClick(event.clientX, event.clientY);
  });
  canvas.addEventListener("pointercancel", () => { drag = null; });
  canvas.addEventListener("click", (event) => {
    if (!canMove() || dragged || event.pointerType === "touch") return;
    if (pointerActive) {
      const bounds = canvas.getBoundingClientRect();
      onClick(bounds.left + bounds.width / 2, bounds.top + bounds.height / 2);
    } else {
      canvas.focus({ preventScroll: true });
      lockPointer();
    }
  });
  document.addEventListener("mousemove", (event) => {
    if (document.pointerLockElement === canvas && canMove()) look(event.movementX, event.movementY);
  });
  document.addEventListener("pointerlockchange", () => {
    pendingPointer = false;
    pointerActive = document.pointerLockElement === canvas;
    drag = null;
    if (pointerActive) {
      pointerUnavailable = false;
      delete canvas.dataset.mouseFallback;
      if (!canMove()) releasePointer();
    }
  });
  document.addEventListener("pointerlockerror", () => {
    if (!pendingPointer) return;
    pendingPointer = false;
    pointerUnavailable = true;
    canvas.dataset.mouseFallback = "true";
  });

  function jump() {
    if (!isGrounded || !canMove()) return;
    velocityY = JUMP_SPEED;
    isGrounded = false;
    drawHeight = position.y;
  }

  function tryMove(x, z) {
    const hit = isGrounded ? world.floor(x, z, position.y, .32, .50) : world.floor(x, z, position.y, .075, 2.7);
    if (!hit) return false;
    const feet = isGrounded ? hit.point.y : position.y;
    if (world.occupied(x, feet, z)) return false;
    traveled += Math.hypot(position.x - x, position.z - z);
    position.set(x, feet, z);
    return true;
  }

  function fall(seconds) {
    const previousY = position.y;
    const nextY = previousY + velocityY * seconds - GRAVITY * seconds * seconds * .5;
    velocityY -= GRAVITY * seconds;
    if (nextY > previousY && world.occupied(position.x, nextY, position.z)) {
      velocityY = 0;
      return;
    }
    const hit = velocityY <= 0 ? world.floor(position.x, position.z, previousY, .075, 2.7) : null;
    if (velocityY <= 0 && hit && nextY <= hit.point.y) {
      position.y = hit.point.y;
      onLand(-velocityY, hit.object.name);
      velocityY = 0;
      isGrounded = true;
    } else position.y = nextY;
  }

  function update(seconds) {
    forward.set(-Math.sin(yaw), 0, -Math.cos(yaw));
    right.set(Math.cos(yaw), 0, -Math.sin(yaw));
    const moving = canMove();
    const ahead = moving ? Number(keys.has("KeyW") || keys.has("ArrowUp")) - Number(keys.has("KeyS") || keys.has("ArrowDown")) : 0;
    const sideways = moving ? Number(keys.has("KeyD") || keys.has("ArrowRight")) - Number(keys.has("KeyA") || keys.has("ArrowLeft")) : 0;
    sprinting = Boolean(ahead || sideways) && (keys.has("ShiftLeft") || keys.has("ShiftRight"));
    const steps = Math.max(1, Math.ceil(seconds * 90));
    const dt = seconds / steps;
    const meters = (sprinting ? 5.7 : 2.95) * dt / (Math.hypot(ahead, sideways) || 1);
    const dx = (forward.x * ahead + right.x * sideways) * meters;
    const dz = (forward.z * ahead + right.z * sideways) * meters;
    for (let i = 0; i < steps; i++) {
      if ((ahead || sideways) && !tryMove(position.x + dx, position.z + dz)) {
        if (Math.abs(dx) > 0.00001) tryMove(position.x + dx, position.z);
        if (Math.abs(dz) > 0.00001) tryMove(position.x, position.z + dz);
      }
      if (!isGrounded) fall(dt);
    }
    drawHeight = isGrounded ? THREE.MathUtils.damp(drawHeight, position.y, 18, seconds) : position.y;
    eye.set(position.x, drawHeight + 1.66, position.z);
    if (shoulder) {
      desired.copy(eye).addScaledVector(right, 0.80).addScaledVector(forward, -2.84);
      desired.y += 0.66;
      const distance = world.blockers(eye, desired);
      desired.sub(eye).setLength(Math.max(0.12, Math.min(desired.length(), distance - 0.19))).add(eye);
      world.camera.position.copy(desired);
    } else {
      world.camera.position.copy(eye);
    }
    world.camera.rotation.set(pitch, yaw, 0, "YXZ");
    world.camera.updateMatrixWorld();
  }

  return {
    position, update, clear: () => keys.clear(),
    get yaw() { return yaw; },
    get pitch() { return pitch; },
    get shoulder() { return shoulder; },
    get moved() { return traveled > 0.8; },
    get pointerActive() { return pointerActive; },
    get sprinting() { return sprinting; },
    get velocityY() { return velocityY; },
    get isGrounded() { return isGrounded; },
    setShoulder(value) { shoulder = value; },
    lookAt(target) {
      const dx=target.x-position.x, dz=target.z-position.z;
      yaw=Math.atan2(-dx,-dz);
      pitch=THREE.MathUtils.clamp(Math.atan2(target.y-position.y-1.66,Math.hypot(dx,dz)),-1.16,1.22);
    },
    relocate(point) {
      position.copy(point);
      drawHeight = point.y;
      velocityY = 0;
      isGrounded = true;
    },
    jump,
    touchKey(code, pressed) { if (pressed) keys.add(code); else keys.delete(code); },
    lockPointer, releasePointer,
  };
}
