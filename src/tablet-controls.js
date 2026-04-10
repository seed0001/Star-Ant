/**
 * Touch UI for tablet / browser play: virtual move stick, look drag zone, up/down.
 * Assumes `body.app-mode-tablet` is set by the launcher splash.
 */

const DEAD = 0.14;

/**
 * @param {object} o
 * @param {Set<string>} o.keys
 * @param {(dx: number, dy: number) => void} o.applyLookDelta  screen-space deltas (like mouse movement)
 * @param {() => boolean} o.shouldBlockLook
 * @param {() => boolean} o.shouldSyncMoveStick
 */
export function initTabletControls(o) {
  const { keys, applyLookDelta, shouldBlockLook, shouldSyncMoveStick } = o;

  const layer = document.createElement("div");
  layer.className = "tablet-touch-layer";
  layer.setAttribute("aria-hidden", "true");

  const joyWrap = document.createElement("div");
  joyWrap.className = "tablet-joystick-wrap";

  const joyBase = document.createElement("div");
  joyBase.className = "tablet-joystick-base";
  const joyKnob = document.createElement("div");
  joyKnob.className = "tablet-joystick-knob";
  joyBase.appendChild(joyKnob);
  joyWrap.appendChild(joyBase);

  const vertStack = document.createElement("div");
  vertStack.className = "tablet-vert-btns";
  const btnUp = document.createElement("button");
  btnUp.type = "button";
  btnUp.className = "tablet-fly-btn tablet-fly-btn--up";
  btnUp.textContent = "Up";
  btnUp.setAttribute("aria-label", "Fly up");
  const btnDown = document.createElement("button");
  btnDown.type = "button";
  btnDown.className = "tablet-fly-btn tablet-fly-btn--down";
  btnDown.textContent = "Dn";
  btnDown.setAttribute("aria-label", "Fly down");
  vertStack.appendChild(btnUp);
  vertStack.appendChild(btnDown);

  joyWrap.appendChild(vertStack);

  const lookZone = document.createElement("div");
  lookZone.className = "tablet-look-zone";

  layer.appendChild(joyWrap);
  layer.appendChild(lookZone);
  const root = document.getElementById("game-root") ?? document.body;
  root.appendChild(layer);

  let joyId = /** @type {number | null} */ (null);
  let joyCx = 0;
  let joyCy = 0;
  const maxR = 52;

  function joyVec() {
    const tr = joyKnob.style.transform || "";
    const m = tr.match(/translate\(([-0-9.]+)px,\s*([-0-9.]+)px\)/);
    const vx = m ? parseFloat(m[1]) : 0;
    const vy = m ? parseFloat(m[2]) : 0;
    return { dx: vx / maxR, dy: vy / maxR };
  }

  function syncMoveKeys() {
    keys.delete("KeyW");
    keys.delete("KeyS");
    keys.delete("KeyA");
    keys.delete("KeyD");
    if (!shouldSyncMoveStick()) return;
    const { dx, dy } = joyVec();
    if (dy < -DEAD) keys.add("KeyW");
    if (dy > DEAD) keys.add("KeyS");
    if (dx < -DEAD) keys.add("KeyA");
    if (dx > DEAD) keys.add("KeyD");
  }

  function placeKnob(clientX, clientY) {
    const rect = joyBase.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    let vx = clientX - cx;
    let vy = clientY - cy;
    const len = Math.hypot(vx, vy) || 1;
    if (len > maxR) {
      vx = (vx / len) * maxR;
      vy = (vy / len) * maxR;
    }
    joyKnob.style.transform = `translate(${vx}px, ${vy}px)`;
    syncMoveKeys();
  }

  function resetKnob() {
    joyKnob.style.transform = "translate(0px, 0px)";
    syncMoveKeys();
  }

  function onJoyStart(ev) {
    const t = ev.changedTouches[0];
    joyId = t.identifier;
    joyCx = t.clientX;
    joyCy = t.clientY;
    placeKnob(t.clientX, t.clientY);
  }

  function onJoyMove(ev) {
    if (joyId === null) return;
    for (let i = 0; i < ev.changedTouches.length; i++) {
      const t = ev.changedTouches[i];
      if (t.identifier === joyId) {
        placeKnob(t.clientX, t.clientY);
        break;
      }
    }
  }

  function onJoyEnd(ev) {
    for (let i = 0; i < ev.changedTouches.length; i++) {
      if (ev.changedTouches[i].identifier === joyId) {
        joyId = null;
        resetKnob();
        break;
      }
    }
  }

  joyBase.addEventListener("touchstart", onJoyStart, { passive: true });
  joyBase.addEventListener("touchmove", onJoyMove, { passive: true });
  joyBase.addEventListener("touchend", onJoyEnd, { passive: true });
  joyBase.addEventListener("touchcancel", onJoyEnd, { passive: true });

  function bindHoldKey(code, el) {
    el.addEventListener(
      "touchstart",
      (e) => {
        e.preventDefault();
        keys.add(code);
      },
      { passive: false }
    );
    el.addEventListener(
      "touchend",
      () => {
        keys.delete(code);
      },
      { passive: true }
    );
    el.addEventListener(
      "touchcancel",
      () => {
        keys.delete(code);
      },
      { passive: true }
    );
  }
  bindHoldKey("Space", btnUp);
  bindHoldKey("ShiftRight", btnDown);

  let lookId = /** @type {number | null} */ (null);
  let lastLx = 0;
  let lastLy = 0;
  const lookMul = 2.4;

  function onLookStart(ev) {
    const t = ev.changedTouches[0];
    lookId = t.identifier;
    lastLx = t.clientX;
    lastLy = t.clientY;
  }

  function onLookMove(ev) {
    if (lookId === null) return;
    for (let i = 0; i < ev.changedTouches.length; i++) {
      const t = ev.changedTouches[i];
      if (t.identifier !== lookId) continue;
      const dx = t.clientX - lastLx;
      const dy = t.clientY - lastLy;
      lastLx = t.clientX;
      lastLy = t.clientY;
      if (!shouldBlockLook()) {
        applyLookDelta(dx * lookMul, dy * lookMul);
      }
      ev.preventDefault();
      break;
    }
  }

  function onLookEnd(ev) {
    for (let i = 0; i < ev.changedTouches.length; i++) {
      if (ev.changedTouches[i].identifier === lookId) {
        lookId = null;
        break;
      }
    }
  }

  lookZone.addEventListener("touchstart", onLookStart, { passive: true });
  lookZone.addEventListener("touchmove", onLookMove, { passive: false });
  lookZone.addEventListener("touchend", onLookEnd, { passive: true });
  lookZone.addEventListener("touchcancel", onLookEnd, { passive: true });

  return () => {
    keys.delete("KeyW");
    keys.delete("KeyS");
    keys.delete("KeyA");
    keys.delete("KeyD");
    keys.delete("Space");
    keys.delete("ShiftLeft");
    layer.remove();
  };
}
