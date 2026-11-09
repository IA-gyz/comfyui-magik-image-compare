import { app } from "/scripts/app.js";

// ═══════════════════════════════════════════════════════════════
//  Magik Compare Core — shared engine
// ═══════════════════════════════════════════════════════════════
//
// Used by both Magik Image Compare (fixed 2 inputs, batch/mosaic per side) and
// Magik Multi Compare (up to 10 inputs, pick any 2 to view). This module owns
// the ~90% that's identical between them: wipe/overlay/difference painting,
// editable labels, the eye-icon toggle, tooltips, and the dual canvas/DOM
// rendering lifecycle. Each node supplies:
//   - its own "geometry extras" (topOffset/headerExtra/rowExtra) so its own
//     header content (batch row, picker grid) gets reserved space without this
//     module needing to know what that content is,
//   - its own extra painting/hit-testing for that reserved space,
//   - its own state-persistence shape (the fields below are the common subset;
//     each node's properties object can carry additional fields alongside them).
//
// Nothing in here is exported as a class or "plugin" — just plain functions and
// constants a node file composes directly in its own onMouseDown/paint/etc.

export const BRAND = "#F66744";

export function isVueNodes() {
  return !!window.LiteGraph?.vueNodesMode;
}

export function applyAdaptiveCanvasOnly(widget) {
  if (!widget || !widget.options) return widget;
  try {
    Object.defineProperty(widget.options, "canvasOnly", {
      configurable: true, enumerable: true,
      get() { return !window.LiteGraph?.vueNodesMode; },
    });
  } catch (e) {
    widget.options.canvasOnly = !window.LiteGraph?.vueNodesMode;
  }
  return widget;
}

export function installCanvasZoomPassthrough(root) {
  if (!root || typeof root.addEventListener !== "function") return () => {};
  const onWheel = (e) => {
    if (isVueNodes()) return;
    let el = e.target;
    while (el && el !== root.parentElement) {
      if (el.nodeType === 1) {
        const cs = getComputedStyle(el);
        const oy = cs.overflowY, ox = cs.overflowX;
        const vertical = Math.abs(e.deltaY) >= Math.abs(e.deltaX);
        if (vertical && (oy === "auto" || oy === "scroll") && el.scrollHeight > el.clientHeight + 1) {
          const atTop = el.scrollTop <= 0, atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 1;
          if ((e.deltaY < 0 && !atTop) || (e.deltaY > 0 && !atBottom)) return;
        } else if (!vertical && (ox === "auto" || ox === "scroll") && el.scrollWidth > el.clientWidth + 1) {
          const atLeft = el.scrollLeft <= 0, atRight = el.scrollLeft + el.clientWidth >= el.scrollWidth - 1;
          if ((e.deltaX < 0 && !atLeft) || (e.deltaX > 0 && !atRight)) return;
        }
      }
      el = el.parentElement;
    }
    const canvasEl = app?.canvas?.canvas;
    if (!canvasEl) return;
    e.preventDefault();
    e.stopPropagation();
    const { clientX, clientY, deltaX, deltaY, deltaMode, ctrlKey, metaKey, shiftKey } = e;
    canvasEl.dispatchEvent(new WheelEvent("wheel", {
      clientX, clientY, deltaX, deltaY, deltaMode,
      ctrlKey, metaKey, shiftKey, bubbles: true, cancelable: true,
    }));
  };
  root.addEventListener("wheel", onWheel, { passive: false });
  return () => root.removeEventListener("wheel", onWheel);
}

// ── Shared constants ──
export const MODES = ["Left Right", "Right Left", "Up Down", "Overlay", "Difference"];
export const MODE_HINTS = [
  "↔  Hover to slide left / right",
  "↔  Hover to slide right / left",
  "↕  Hover to slide up / down",
  "",
  "Shows pixel differences",
];
export const MODE_TIPS = [
  "Split view. Hover the image to wipe between the two, left to right.",
  "Split view with the sides swapped. Hover to wipe right to left.",
  "Split view. Hover the image to wipe top to bottom.",
  "Overlay the two images. Drag the slider to fade between them.",
  "Show only the pixels that differ between the two images.",
];
export const BTN_GAP = 3;
export const BTN_H = 18;
export const BTN_W = 56;
export const LABEL_W = 80;
export const LABEL_H = 16;
export const LABEL_X = 72;
export const EYE_SIZE = 16;
export const SLIDER_PAD = 50;

// ── Geometry ──
// topOffset   — pushes the whole header down (Multi Compare uses this as its
//               dynamic input-socket column grows past 2 rows).
// headerExtra — extra px between the label/eye rows and the mode-buttons row
//               (Multi Compare's picker grid is taller than 2 label rows).
// rowExtra    — extra px between the mode-buttons row and the hint row
//               (Image Compare's batch/mosaic row).
// With all three at 0 this reproduces the original fixed layout exactly.
export function buildGeometry({ topOffset = 0, headerExtra = 0, rowExtra = 0 } = {}) {
  const SLOT_0_Y = 6 + topOffset;
  const SLOT_1_Y = 26 + topOffset;
  const EYE_X = LABEL_X + LABEL_W + 6;
  const EYE_Y = SLOT_0_Y + (SLOT_1_Y - SLOT_0_Y) / 2 + LABEL_H / 2 - EYE_SIZE / 2;
  const MODE_ROW_Y = SLOT_1_Y + LABEL_H + 8 + headerExtra;
  const HINT_ROW_Y = MODE_ROW_Y + BTN_H + 4 + rowExtra;
  const IMG_Y = HINT_ROW_Y + BTN_H + 6;
  const INIT_W = 440;
  const INIT_H = INIT_W + IMG_Y;
  const MIN_W = 180 + BTN_W * 6 + BTN_GAP * 5 + 6;
  const MIN_H = IMG_Y + 100;
  return { SLOT_0_Y, SLOT_1_Y, EYE_X, EYE_Y, MODE_ROW_Y, HINT_ROW_Y, IMG_Y, INIT_W, INIT_H, MIN_W, MIN_H };
}

export function rowLayout(W) {
  const gap = BTN_GAP;
  const vue = isVueNodes();
  const leftPad = vue ? 12 : 100;
  const rightPad = vue ? 12 : 6;
  const n = 6;
  let bw = Math.floor((W - leftPad - rightPad - gap * (n - 1)) / n);
  bw = Math.max(30, vue ? bw : Math.min(BTN_W, bw));
  return { leftPad, gap, bw };
}

export function showRect(W, geo) {
  const L = rowLayout(W);
  return { x: L.leftPad, y: geo.MODE_ROW_Y, w: L.bw, h: BTN_H };
}

export function modeRect(W, i, geo) {
  const L = rowLayout(W);
  return { x: L.leftPad + (i + 1) * (L.bw + L.gap), y: geo.MODE_ROW_Y, w: L.bw, h: BTN_H };
}

export function hintRect(W, geo) {
  const L = rowLayout(W);
  return { x: L.leftPad, y: geo.HINT_ROW_Y, w: L.bw * 6 + L.gap * 5, h: BTN_H };
}

export function sliderGeo(W, geo) {
  const mid = hintRect(W, geo);
  const trackX = mid.x + SLIDER_PAD;
  const trackW = Math.max(20, mid.w - SLIDER_PAD - 36);
  const trackY = mid.y + mid.h / 2 - 3;
  const trackH = 6;
  return { trackX, trackW, trackY, trackH };
}

export function labelRectForSlot(slotIndex, geo) {
  const y = slotIndex === 0 ? geo.SLOT_0_Y : geo.SLOT_1_Y;
  return { x: LABEL_X, y, w: LABEL_W, h: LABEL_H };
}

export function eyeRect(geo) {
  return { x: geo.EYE_X, y: geo.EYE_Y, w: EYE_SIZE, h: EYE_SIZE };
}

export function inside(pos, r) {
  return pos[0] >= r.x && pos[0] <= r.x + r.w && pos[1] >= r.y && pos[1] <= r.y + r.h;
}

// Works for both <img> (naturalWidth/Height) and <canvas> (width/height), so a
// composited canvas (e.g. a batch mosaic) can be treated identically to a loaded image.
export function mediaW(el) { return el ? (el.naturalWidth || el.width || 0) : 0; }
export function mediaH(el) { return el ? (el.naturalHeight || el.height || 0) : 0; }

// ── Base cursor / tooltip (labels, eye, mode buttons, slider, image area) ──
// Returns null/"" when the point isn't over anything base-level knows about, so
// callers can fall through to their own extra regions before defaulting.
export function cmpCursorBase(node, lx, ly, W, H, geo) {
  const p = [lx, ly];
  if (inside(p, showRect(W, geo))) return "pointer";
  for (let i = 0; i < 5; i++) if (inside(p, modeRect(W, i, geo))) return "pointer";
  if (inside(p, labelRectForSlot(0, geo))) return "text";
  if (inside(p, labelRectForSlot(1, geo))) return "text";
  if (inside(p, eyeRect(geo))) return "pointer";
  if (node._cmpShowWhich === 0 && node._cmpMode === 3) {
    const g = sliderGeo(W, geo);
    if (lx >= g.trackX - 8 && lx <= g.trackX + g.trackW + 8 &&
        ly >= g.trackY - 6 && ly <= g.trackY + g.trackH + 6) return "pointer";
  }
  if (ly >= geo.IMG_Y && node._cmpShowWhich === 0 && (node._cmpImg1 || node._cmpImg2)) {
    if (node._cmpMode <= 1) return "ew-resize";
    if (node._cmpMode === 2) return "ns-resize";
  }
  return null;
}

export function cmpTooltipForBase(node, lx, ly, W, geo) {
  const p = [lx, ly];
  if (inside(p, showRect(W, geo)))
    return "Show one image full-size. Click to switch between image 1 and 2.";
  for (let i = 0; i < 5; i++) if (inside(p, modeRect(W, i, geo))) return MODE_TIPS[i];
  if (inside(p, labelRectForSlot(0, geo))) return "Click to edit label for image 1.";
  if (inside(p, labelRectForSlot(1, geo))) return "Click to edit label for image 2.";
  if (inside(p, eyeRect(geo)))
    return node._cmpShowLabels !== false ? "Hide all label overlays." : "Show all label overlays.";
  return "";
}

// ── Tooltip system (one floating div shared by every compare-widget instance) ──
let _cmpTipEl = null, _cmpTipTimer = null, _cmpTipText = null, _cmpTipX = 0, _cmpTipY = 0;

function cmpTipDiv() {
  if (_cmpTipEl) return _cmpTipEl;
  const d = document.createElement("div");
  d.style.cssText =
    "position:fixed;z-index:99999;pointer-events:none;display:none;white-space:nowrap;" +
    "background:#ffffff;color:#000000;border:1px solid #767676;" +
    "border-radius:0;padding:3px 7px;font:12px 'Segoe UI',sans-serif;" +
    "box-shadow:0 2px 4px rgba(0,0,0,0.15);";
  document.body.appendChild(d);
  _cmpTipEl = d;
  return d;
}

function cmpPositionTip(x, y) {
  const d = _cmpTipEl;
  if (!d || d.style.display !== "block") return;
  let nx = x + 14, ny = y + 18;
  const r = d.getBoundingClientRect();
  if (nx + r.width > window.innerWidth - 4) nx = window.innerWidth - r.width - 4;
  if (ny + r.height > window.innerHeight - 4) ny = y - r.height - 8;
  d.style.left = `${Math.max(4, nx)}px`;
  d.style.top = `${Math.max(4, ny)}px`;
}

export function cmpShowTooltip(text, x, y) {
  if (!text) { cmpHideTooltip(); return; }
  _cmpTipX = x; _cmpTipY = y;
  if (text === _cmpTipText) return;
  _cmpTipText = text;
  clearTimeout(_cmpTipTimer);
  if (_cmpTipEl) _cmpTipEl.style.display = "none";
  _cmpTipTimer = setTimeout(() => {
    const d = cmpTipDiv();
    d.textContent = text;
    d.style.display = "block";
    cmpPositionTip(_cmpTipX, _cmpTipY);
  }, 450);
}

export function cmpHideTooltip() {
  clearTimeout(_cmpTipTimer);
  _cmpTipText = null;
  if (_cmpTipEl) _cmpTipEl.style.display = "none";
}

// ── Inline label editing (textarea for multiline; shared across all instances,
//    so editing a label on one node saves/closes any edit active on another) ──
let _activeLabelInput = null;

export function labelEditBlocking() {
  return !!_activeLabelInput;
}

export function finishLabelEdit(node, save) {
  if (!_activeLabelInput) return;
  const input = _activeLabelInput;
  _activeLabelInput = null;
  if (save && input._which === 1) node._cmpLabel1 = input.value;
  else if (save && input._which === 2) node._cmpLabel2 = input.value;
  if (save) node._cmpOnStateChange?.();
  if (input.parentNode) input.parentNode.removeChild(input);
  cmpRepaint(node);
}

function makeLabelTextarea(node, which, rect, parent, isDom) {
  const current = which === 1 ? (node._cmpLabel1 || "image 1") : (node._cmpLabel2 || "image 2");
  const input = document.createElement("textarea");
  input.value = current;
  input._which = which;
  input._node = node;
  input.style.cssText =
    "position:absolute;z-index:1000;background:#2a2c2e;border:1px solid " + BRAND + ";" +
    "color:#fff;font:9px 'Segoe UI',sans-serif;padding:2px 4px;border-radius:3px;" +
    "outline:none;box-sizing:border-box;resize:none;overflow-y:auto;" +
    "line-height:1.4;white-space:pre-wrap;word-wrap:break-word;" +
    "pointer-events:auto;touch-action:manipulation;";
  input.style.width = rect.w + "px";
  input.style.height = "48px";

  if (isDom) {
    input.style.left = rect.x + "px";
    input.style.top = rect.y + "px";
  }

  const stop = (e) => { e.stopPropagation(); };
  input.addEventListener("pointerdown", stop);
  input.addEventListener("pointermove", stop);
  input.addEventListener("pointerup", stop);
  input.addEventListener("wheel", stop, { passive: false });
  input.addEventListener("mousedown", stop);
  input.addEventListener("mousemove", stop);
  input.addEventListener("mouseup", stop);

  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && e.ctrlKey) { e.preventDefault(); finishLabelEdit(node, true); }
    else if (e.key === "Escape") { e.preventDefault(); finishLabelEdit(node, false); }
  });
  input.addEventListener("blur", () => finishLabelEdit(node, true));

  parent.appendChild(input);
  _activeLabelInput = input;
  requestAnimationFrame(() => { input.focus(); input.select(); });
  return input;
}

export function startLabelEdit(node, which, canvasEl, nodePos, scale, geo) {
  if (_activeLabelInput) {
    if (_activeLabelInput._node === node) return;
    finishLabelEdit(_activeLabelInput._node, true);
  }
  const rect = labelRectForSlot(which === 1 ? 0 : 1, geo);
  const absX = nodePos[0] + rect.x * scale;
  const absY = nodePos[1] + rect.y * scale;
  makeLabelTextarea(node, which, rect, document.body, false);
  _activeLabelInput.style.left = absX + "px";
  _activeLabelInput.style.top = absY + "px";
}

export function startLabelEditDOM(node, which, root, geo) {
  if (_activeLabelInput) {
    if (_activeLabelInput._node === node) return;
    finishLabelEdit(_activeLabelInput._node, true);
  }
  const rect = labelRectForSlot(which === 1 ? 0 : 1, geo);
  makeLabelTextarea(node, which, rect, root, true);
}

export function toggleLabelsOverlay(node) {
  node._cmpShowLabels = node._cmpShowLabels === false ? true : false;
  node._cmpOnStateChange?.();
  cmpRepaint(node);
}

// ── Drawing helpers ──
export function paintBtn(ctx, r, label, on, hovered) {
  ctx.fillStyle = on ? BRAND : "#2a2c2e";
  ctx.strokeStyle = on ? BRAND : (hovered ? BRAND : "#444");
  ctx.lineWidth = 1;
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(r.x, r.y, r.w, r.h, 3);
  else ctx.rect(r.x, r.y, r.w, r.h);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = on ? "#fff" : (hovered ? "#ddd" : "#999");
  ctx.font = "9px 'Segoe UI',sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, r.x + r.w / 2, r.y + r.h / 2);
}

export function paintLabelDisplay(ctx, r, text, hovered) {
  ctx.fillStyle = hovered ? "#3a3c2e" : "#2a2c2e";
  ctx.strokeStyle = hovered ? BRAND : "#555";
  ctx.lineWidth = 1;
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(r.x, r.y, r.w, r.h, 3);
  else ctx.rect(r.x, r.y, r.w, r.h);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = hovered ? "#fff" : "#ccc";
  ctx.font = "9px 'Segoe UI',sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  let display = (text || "").split('\n')[0];
  while (display && ctx.measureText(display).width > r.w - 8 && display.length > 0) {
    display = display.slice(0, -1);
  }
  if (display.length < (text || "").split('\n')[0].length) display += "…";
  ctx.fillText(display, r.x + r.w / 2, r.y + r.h / 2);
}

export function paintEyeIcon(ctx, r, visible, hovered) {
  ctx.save();
  ctx.strokeStyle = hovered ? BRAND : (visible ? "#ccc" : "#666");
  ctx.fillStyle = visible ? "#ccc" : "transparent";
  ctx.lineWidth = 1.2;
  const cx = r.x + r.w / 2;
  const cy = r.y + r.h / 2;
  const rx = r.w / 2 - 2;
  const ry = r.h / 2 - 3;
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
  ctx.stroke();
  if (visible) {
    ctx.beginPath();
    ctx.arc(cx, cy, 2, 0, Math.PI * 2);
    ctx.fill();
  } else {
    ctx.beginPath();
    ctx.moveTo(cx - rx + 1, cy - ry + 2);
    ctx.lineTo(cx + rx - 1, cy + ry - 2);
    ctx.stroke();
  }
  ctx.restore();
}

// ── Text overlay on images (multiline-aware) ──
export function drawTextOverlay(ctx, text, x, y, maxW) {
  if (!text) return;
  ctx.save();
  ctx.font = "bold 14px 'Segoe UI', sans-serif";
  const lines = text.split('\n');
  const padX = 8, padY = 4;
  const lineHeight = 18;
  let maxLineWidth = 0;
  for (const line of lines) {
    const w = ctx.measureText(line).width;
    if (w > maxLineWidth) maxLineWidth = w;
  }
  const tw = Math.min(maxLineWidth + padX * 2, maxW);
  const th = Math.max(22, padY * 2 + lines.length * lineHeight);

  ctx.fillStyle = "rgba(0, 0, 0, 0.65)";
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(x, y, tw, th, 4);
  else ctx.rect(x, y, tw, th);
  ctx.fill();

  ctx.fillStyle = "#fff";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";

  for (let i = 0; i < lines.length; i++) {
    let display = lines[i];
    while (display && ctx.measureText(display).width > tw - padX * 2 && display.length > 0) {
      display = display.slice(0, -1);
    }
    if (display.length < lines[i].length) display += "…";
    ctx.fillText(display, x + padX, y + padY + lineHeight * i + lineHeight / 2);
  }
  ctx.restore();
}

// ── Base painter: labels, eye icon, mode buttons, hint/slider row, image area.
//    Node-specific extra content (batch row / picker grid) is painted by the
//    caller after this returns, into space this function never touches. ──
export function paintCompareBase(ctx, node, W, H, mouse, geo) {
  ctx.save();
  const showLabel = node._cmpShowWhich === 1 ? "Show 1" : node._cmpShowWhich === 2 ? "Show 2" : "Show 1";
  const hov = (rect) => !!(mouse &&
    mouse.x >= rect.x && mouse.x <= rect.x + rect.w &&
    mouse.y >= rect.y && mouse.y <= rect.y + rect.h);

  const l1r = labelRectForSlot(0, geo);
  const l2r = labelRectForSlot(1, geo);
  paintLabelDisplay(ctx, l1r, node._cmpLabel1 || "image 1", hov(l1r));
  paintLabelDisplay(ctx, l2r, node._cmpLabel2 || "image 2", hov(l2r));

  const er = eyeRect(geo);
  paintEyeIcon(ctx, er, node._cmpShowLabels !== false, hov(er));

  const sr = showRect(W, geo);
  paintBtn(ctx, sr, showLabel, node._cmpShowWhich !== 0, hov(sr));
  for (let i = 0; i < 5; i++) {
    const mr = modeRect(W, i, geo);
    paintBtn(ctx, mr, MODES[i], node._cmpShowWhich === 0 && node._cmpMode === i, hov(mr));
  }
  ctx.restore();

  const mid = hintRect(W, geo);
  if (node._cmpShowWhich === 0 && node._cmpMode === 3) {
    ctx.save();
    const { trackX, trackW, trackY, trackH } = sliderGeo(W, geo);
    const pct = node._cmpOpacity;
    const thumbX = trackX + trackW * pct;

    ctx.font = "9px 'Segoe UI',sans-serif";
    ctx.fillStyle = "#999";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText("Opacity", mid.x, mid.y + mid.h / 2);

    ctx.fillStyle = "#2a2c2e";
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(trackX, trackY, trackW, trackH, 3);
    else ctx.rect(trackX, trackY, trackW, trackH);
    ctx.fill();

    ctx.fillStyle = BRAND;
    ctx.beginPath();
    if (ctx.roundRect)
      ctx.roundRect(trackX, trackY, Math.max(0, trackW * pct), trackH, 3);
    else ctx.rect(trackX, trackY, trackW * pct, trackH);
    ctx.fill();

    ctx.fillStyle = BRAND;
    ctx.beginPath();
    ctx.arc(thumbX, mid.y + mid.h / 2, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.arc(thumbX, mid.y + mid.h / 2, 2.5, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "#ccc";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(`${Math.round(pct * 100)}%`, trackX + trackW + 6, mid.y + mid.h / 2);
    ctx.restore();
  } else if (node._cmpShowWhich === 0) {
    ctx.save();
    const hint = MODE_HINTS[node._cmpMode] || "";
    ctx.beginPath();
    ctx.rect(mid.x, geo.HINT_ROW_Y, mid.w, BTN_H);
    ctx.clip();
    let hfs = 9;
    ctx.font = `${hfs}px 'Segoe UI',sans-serif`;
    while (hfs > 7.5 && ctx.measureText(hint).width > mid.w - 6) {
      hfs -= 0.5;
      ctx.font = `${hfs}px 'Segoe UI',sans-serif`;
    }
    ctx.fillStyle = "#999";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(hint, mid.x + mid.w / 2, mid.y + mid.h / 2);
    ctx.restore();
  }

  const IMG_Y = geo.IMG_Y;
  const imgH = H - IMG_Y;
  if (!node._cmpImg1 && !node._cmpImg2) {
    ctx.save();
    ctx.fillStyle = "#171718";
    ctx.fillRect(0, IMG_Y, W, imgH);
    ctx.fillStyle = "#555";
    ctx.font = "12px 'Segoe UI',sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("Connect images & run to compare", W / 2, IMG_Y + imgH / 2);
    ctx.restore();
    return;
  }

  const fit = (img) => {
    const iw = mediaW(img), ih = mediaH(img);
    if (!img || !iw || !ih) return { x: 0, y: IMG_Y, w: W, h: imgH };
    const a = iw / ih;
    const fh = W / a;
    if (fh <= imgH) return { x: 0, y: IMG_Y + (imgH - fh) / 2, w: W, h: fh };
    const fw = imgH * a;
    return { x: (W - fw) / 2, y: IMG_Y, w: fw, h: imgH };
  };
  const fr1 = fit(node._cmpImg1), fr2 = fit(node._cmpImg2);

  ctx.save();
  ctx.beginPath();
  ctx.rect(0, IMG_Y, W, imgH);
  ctx.clip();
  ctx.fillStyle = "#111";
  ctx.fillRect(0, IMG_Y, W, imgH);

  const showLabels = node._cmpShowLabels !== false;
  const label1 = showLabels ? (node._cmpLabel1 || "image 1") : "";
  const label2 = showLabels ? (node._cmpLabel2 || "image 2") : "";

  const displayTop = IMG_Y;
  const displayBottom = H;
  const displayLeft = 0;
  const displayRight = W;

  if (node._cmpShowWhich !== 0) {
    const img = node._cmpShowWhich === 1 ? node._cmpImg1 : node._cmpImg2;
    const label = node._cmpShowWhich === 1 ? label1 : label2;
    if (img) {
      const f = fit(img);
      ctx.drawImage(img, f.x, f.y, f.w, f.h);
      if (label) drawTextOverlay(ctx, label, displayLeft + 8, displayTop + 8, W - 16);
    }
    ctx.restore();
    return;
  }

  const m = node._cmpMode;
  if (m === 0 || m === 1) {
    const imgL = m === 0 ? node._cmpImg2 : node._cmpImg1;
    const imgR = m === 0 ? node._cmpImg1 : node._cmpImg2;
    const frL = m === 0 ? fr2 : fr1;
    const frR = m === 0 ? fr1 : fr2;
    const labelL = m === 0 ? label2 : label1;
    const labelR = m === 0 ? label1 : label2;
    const sx = W * node._cmpSplitX;
    const textPad = 8;
    const textMaxW = 120;

    ctx.save();
    ctx.font = "bold 14px 'Segoe UI', sans-serif";
    const rightLabelW = labelR ? Math.min(ctx.measureText(labelR.split('\n')[0]).width + 16, textMaxW) : 0;
    const leftLabelW = labelL ? Math.min(ctx.measureText(labelL.split('\n')[0]).width + 16, textMaxW) : 0;
    ctx.restore();

    if (imgR) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(sx, IMG_Y, W - sx, imgH);
      ctx.clip();
      ctx.drawImage(imgR, frR.x, frR.y, frR.w, frR.h);
      if (labelR) {
        let textRight = Math.min(sx + textPad + rightLabelW, displayRight - textPad);
        let textX = textRight - rightLabelW;
        if (sx > displayRight - textPad - rightLabelW) {
          textX = displayRight - textPad - rightLabelW;
        }
        drawTextOverlay(ctx, labelR, textX, displayTop + textPad, rightLabelW);
      }
      ctx.restore();
    }
    if (imgL) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, IMG_Y, sx, imgH);
      ctx.clip();
      ctx.drawImage(imgL, frL.x, frL.y, frL.w, frL.h);
      if (labelL) {
        let textX = sx - leftLabelW - textPad;
        if (textX < displayLeft + textPad) {
          textX = displayLeft + textPad;
        }
        drawTextOverlay(ctx, labelL, textX, displayTop + textPad, leftLabelW);
      }
      ctx.restore();
    }
    if (node._cmpSplitX > 0.01 && node._cmpSplitX < 0.99) {
      ctx.strokeStyle = "rgba(255,255,255,0.4)";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(sx, IMG_Y);
      ctx.lineTo(sx, IMG_Y + imgH);
      ctx.stroke();
    }
  } else if (m === 2) {
    const sy = IMG_Y + imgH * node._cmpSplitY;
    const textPad = 8;

    if (node._cmpImg1) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, sy, W, IMG_Y + imgH - sy);
      ctx.clip();
      ctx.drawImage(node._cmpImg1, fr1.x, fr1.y, fr1.w, fr1.h);
      if (label1) {
        let textY = sy + textPad;
        if (textY + 22 > displayBottom - textPad) {
          textY = displayBottom - 22 - textPad;
        }
        drawTextOverlay(ctx, label1, displayLeft + textPad, textY, W - textPad * 2);
      }
      ctx.restore();
    }
    if (node._cmpImg2) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, IMG_Y, W, sy - IMG_Y);
      ctx.clip();
      ctx.drawImage(node._cmpImg2, fr2.x, fr2.y, fr2.w, fr2.h);
      if (label2) {
        let textY = sy - 22 - textPad;
        if (textY < displayTop + textPad) {
          textY = displayTop + textPad;
        }
        drawTextOverlay(ctx, label2, displayLeft + textPad, textY, W - textPad * 2);
      }
      ctx.restore();
    }
    if (node._cmpSplitY > 0.01 && node._cmpSplitY < 0.99) {
      ctx.strokeStyle = "rgba(255,255,255,0.4)";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(0, sy);
      ctx.lineTo(W, sy);
      ctx.stroke();
    }
  } else if (m === 3) {
    if (node._cmpImg1) ctx.drawImage(node._cmpImg1, fr1.x, fr1.y, fr1.w, fr1.h);
    if (node._cmpImg2) {
      ctx.globalAlpha = node._cmpOpacity;
      ctx.drawImage(node._cmpImg2, fr2.x, fr2.y, fr2.w, fr2.h);
      ctx.globalAlpha = 1;
    }
  } else {
    if (node._cmpImg1) ctx.drawImage(node._cmpImg1, fr1.x, fr1.y, fr1.w, fr1.h);
    if (node._cmpImg2) {
      ctx.globalCompositeOperation = "difference";
      ctx.drawImage(node._cmpImg2, fr2.x, fr2.y, fr2.w, fr2.h);
      ctx.globalCompositeOperation = "source-over";
    }
  }
  ctx.restore();
}

// ── Base interaction (labels, eye, mode buttons, slider drag, wipe drag) ──
export function cmpDownBase(node, lx, ly, W, H, canvasEl, nodePos, scale, root, geo) {
  const p = [lx, ly];
  if (inside(p, labelRectForSlot(0, geo))) {
    if (root) startLabelEditDOM(node, 1, root, geo);
    else startLabelEdit(node, 1, canvasEl, nodePos, scale, geo);
    return true;
  }
  if (inside(p, labelRectForSlot(1, geo))) {
    if (root) startLabelEditDOM(node, 2, root, geo);
    else startLabelEdit(node, 2, canvasEl, nodePos, scale, geo);
    return true;
  }
  if (inside(p, eyeRect(geo))) { toggleLabelsOverlay(node); return true; }
  if (inside(p, showRect(W, geo))) {
    node._cmpShowWhich = node._cmpShowWhich === 2 ? 1 : 2;
    node._cmpOnStateChange?.();
    return true;
  }
  for (let i = 0; i < 5; i++)
    if (inside(p, modeRect(W, i, geo))) {
      node._cmpMode = i;
      node._cmpShowWhich = 0;
      node._cmpOnStateChange?.();
      return true;
    }
  if (node._cmpShowWhich === 0 && node._cmpMode === 3) {
    const g = sliderGeo(W, geo);
    const hx = g.trackX, hw = g.trackW, hy = g.trackY - 6, hh = g.trackH + 12;
    if (lx >= hx - 8 && lx <= hx + hw + 8 && ly >= hy && ly <= hy + hh) {
      node._cmpOpacity = Math.max(0, Math.min(1, (lx - hx) / hw));
      node._cmpDragging = true;
      return true;
    }
  }
  return false;
}

export function cmpMoveBase(node, lx, ly, W, H, geo) {
  if (node._cmpDragging && node._cmpShowWhich === 0 && node._cmpMode === 3) {
    const g = sliderGeo(W, geo);
    node._cmpOpacity = Math.max(0, Math.min(1, (lx - g.trackX) / g.trackW));
    return true;
  }
  if (node._cmpShowWhich === 0 && node._cmpMode <= 2 && (node._cmpImg1 || node._cmpImg2)) {
    const imgH = H - geo.IMG_Y;
    if (node._cmpMode <= 1) node._cmpSplitX = Math.max(0, Math.min(1, lx / W));
    else node._cmpSplitY = Math.max(0, Math.min(1, (ly - geo.IMG_Y) / imgH));
    return true;
  }
  return false;
}

export function cmpUpBase(node) {
  if (node._cmpDragging) node._cmpOnStateChange?.();
  node._cmpDragging = false;
}

export function cmpWheelBase(node, ly, deltaY, geo) {
  if (node._cmpShowWhich === 0 && node._cmpMode === 3 && ly > geo.MODE_ROW_Y) {
    node._cmpOpacity = Math.max(0, Math.min(1, node._cmpOpacity + (deltaY > 0 ? -0.05 : 0.05)));
    node._cmpOnStateChange?.();
    return true;
  }
  return false;
}

export function cmpLeaveBase(node) {
  if (node._cmpDragging) node._cmpOnStateChange?.();
  node._cmpDragging = false;
  if (node._cmpMode <= 1) node._cmpSplitX = 0;
  else if (node._cmpMode === 2) node._cmpSplitY = 0;
}

// ── Common state-field helpers (each node's properties object extends these) ──
export function baseStateFields(node) {
  return {
    mode: node._cmpMode ?? 0,
    showWhich: node._cmpShowWhich ?? 0,
    opacity: node._cmpOpacity ?? 0.5,
    label1: node._cmpLabel1 || "image 1",
    label2: node._cmpLabel2 || "image 2",
    showLabels: node._cmpShowLabels !== false,
  };
}

export function applyBaseStateFields(node, s) {
  if (typeof s.mode === "number") node._cmpMode = s.mode;
  if (typeof s.showWhich === "number") node._cmpShowWhich = s.showWhich;
  if (typeof s.opacity === "number") node._cmpOpacity = s.opacity;
  if (s.label1) node._cmpLabel1 = s.label1;
  if (s.label2) node._cmpLabel2 = s.label2;
  if (typeof s.showLabels === "boolean") node._cmpShowLabels = s.showLabels;
}

export function initBaseInstanceFields(node) {
  node._cmpMode = 0;
  node._cmpShowWhich = 0;
  node._cmpSplitX = 0;
  node._cmpSplitY = 0;
  node._cmpOpacity = 0.5;
  node._cmpImg1 = null;
  node._cmpImg2 = null;
  node._cmpLabel1 = "image 1";
  node._cmpLabel2 = "image 2";
  node._cmpShowLabels = true;
}

// ── Image loading ──
export function buildCmpUrl(d) {
  return `/view?filename=${encodeURIComponent(d.filename)}&type=${encodeURIComponent(d.type)}&subfolder=${encodeURIComponent(d.subfolder || "")}&t=${Date.now()}`;
}

// Loads one metadata entry {filename,subfolder,type} into an <img>, resolving
// once it has loaded (or rejecting on error) — a low-level primitive both
// nodes' own batch/candidate loaders build on.
export function loadOneImage(meta) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load image: ${meta.filename}`));
    img.src = buildCmpUrl(meta);
  });
}

export function cmpRepaint(node) {
  if (!node) return;
  node.setDirtyCanvas?.(true, true);
  if (window.LiteGraph?.vueNodesMode) node._cmpDomRender?.();
}

// ── DOM widget (Nodes 2.0) ──
// hooks: { widgetName, getGeo(node), paint(ctx,node,W,H,mouse,geo),
//          cmpDown(node,lx,ly,W,H,canvasEl,nodePos,scale,root,geo),
//          cmpMove(node,lx,ly,W,H,geo), cmpUp(node), cmpWheel(node,ly,deltaY,geo),
//          cmpLeave(node), cmpCursor(node,lx,ly,W,H,geo), cmpTooltipFor(node,lx,ly,W,geo) }
export function createCompareDOMWidget(node, hooks) {
  const root = document.createElement("div");
  root.className = "magik-cmp-root";
  root.style.cssText = "position:relative;width:100%;flex:1 1 0;min-height:0;box-sizing:border-box;cursor:default;";
  const canvas = document.createElement("canvas");
  canvas.style.cssText = "position:absolute;inset:0;width:100%;height:100%;display:block;";
  canvas.style.imageRendering = "auto";
  root.appendChild(canvas);

  installCanvasZoomPassthrough(root);
  const widget = node.addDOMWidget(hooks.widgetName, hooks.widgetName, root, {
    serialize: false,
    hideOnZoom: false,
    getMinHeight: () => hooks.getGeo(node).MIN_H,
  });
  widget.computeLayoutSize = () => ({ minHeight: hooks.getGeo(node).MIN_H, minWidth: 1 });
  applyAdaptiveCanvasOnly(widget);

  const BACKING_CAP = 6000;
  const backingScale = (cssW, cssH) => {
    const dpr = window.devicePixelRatio || 1;
    const zoom = Math.max(1, app.canvas?.ds?.scale || 1);
    let s = dpr * zoom;
    const longCss = Math.max(cssW, cssH);
    if (longCss * s > BACKING_CAP) s = BACKING_CAP / longCss;
    return s;
  };

  const TOP_TRIM = 8;
  const render = () => {
    // Belt-and-suspenders suppression of ComfyUI's default image gallery widget,
    // mirroring onDrawBackground's canvas-mode behavior (hideOutputImages isn't
    // confirmed to be read anywhere in core, so we don't rely on it alone).
    if (node.imgs) node.imgs = null;
    const cssW = root.clientWidth;
    const cssH = root.clientHeight;
    if (cssW <= 0 || cssH <= 0) return;
    const s = backingScale(cssW, cssH);
    const bw = Math.round(cssW * s);
    const bh = Math.round(cssH * s);
    if (canvas.width !== bw) canvas.width = bw;
    if (canvas.height !== bh) canvas.height = bh;
    const ctx = canvas.getContext("2d");
    ctx.setTransform(s, 0, 0, s, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);
    ctx.translate(0, -TOP_TRIM);
    node._cmpDomW = cssW;
    node._cmpDomH = cssH;
    hooks.paint(ctx, node, cssW, cssH + TOP_TRIM, node._cmpDomMouse || null, hooks.getGeo(node));
  };
  node._cmpDomRender = render;

  let _lastZoom = -1;
  const zoomWatch = () => {
    const currentZoom = app.canvas?.ds?.scale || 1;
    if (Math.abs(currentZoom - _lastZoom) > 0.005) {
      _lastZoom = currentZoom;
      const w = root.clientWidth;
      const h = root.clientHeight;
      if (w > 0 && h > 0) render();
    }
    node._cmpZoomRaf = requestAnimationFrame(zoomWatch);
  };
  node._cmpZoomRaf = requestAnimationFrame(zoomWatch);

  const localPos = (e) => {
    const r = root.getBoundingClientRect();
    const sx = r.width ? root.clientWidth / r.width : 1;
    const sy = r.height ? root.clientHeight / r.height : 1;
    return [(e.clientX - r.left) * sx, (e.clientY - r.top) * sy + TOP_TRIM];
  };
  const W = () => node._cmpDomW || root.clientWidth;
  const H = () => (node._cmpDomH || root.clientHeight) + TOP_TRIM;

  root.addEventListener("pointerdown", (e) => {
    cmpHideTooltip();
    const [lx, ly] = localPos(e);
    const geo = hooks.getGeo(node);
    if (hooks.cmpDown(node, lx, ly, W(), H(), null, null, null, root, geo)) {
      e.stopPropagation();
      if (node._cmpDragging) {
        try { root.setPointerCapture(e.pointerId); } catch {}
      }
      render();
    }
  });
  root.addEventListener("pointermove", (e) => {
    const [lx, ly] = localPos(e);
    node._cmpDomMouse = { x: lx, y: ly };
    const geo = hooks.getGeo(node);
    root.style.cursor = hooks.cmpCursor(node, lx, ly, W(), H(), geo);
    hooks.cmpMove(node, lx, ly, W(), H(), geo);
    cmpShowTooltip(hooks.cmpTooltipFor(node, lx, ly, W(), geo), e.clientX, e.clientY);
    render();
  });
  root.addEventListener("pointerup", (e) => {
    hooks.cmpUp(node);
    try { root.releasePointerCapture(e.pointerId); } catch {}
    render();
  });
  root.addEventListener("pointerleave", () => {
    node._cmpDomMouse = null;
    cmpHideTooltip();
    hooks.cmpLeave(node);
    render();
  });
  root.addEventListener("wheel", (e) => {
    const [, ly] = localPos(e);
    const geo = hooks.getGeo(node);
    if (hooks.cmpWheel(node, ly, e.deltaY, geo)) {
      e.preventDefault();
      e.stopPropagation();
      render();
    }
  }, { passive: false });

  const ro = new ResizeObserver(() => render());
  ro.observe(root);
  node._cmpDomRO = ro;
  requestAnimationFrame(render);
  return widget;
}

// ── Canvas-mode lifecycle hooks (onDrawBackground/Foreground, mouse, resize, removed) ──
// Same `hooks` shape as createCompareDOMWidget, minus widgetName.
export function installCanvasHooks(nodeType, hooks) {
  nodeType.prototype.onDrawBackground = function () {
    if (this.flags?.collapsed) return;
    if (this.imgs) this.imgs = null;
  };

  const _origDraw = nodeType.prototype.onDrawForeground;
  nodeType.prototype.onDrawForeground = function (ctx) {
    if (_origDraw) _origDraw.call(this, ctx);
    if (this.flags?.collapsed) return;
    if (isVueNodes()) return;
    const geo = hooks.getGeo(this);
    if (this.size[0] < geo.MIN_W) this.size[0] = geo.MIN_W;
    if (this.size[1] < geo.MIN_H) this.size[1] = geo.MIN_H;
    let mouse = null;
    const gm = app.canvas?.graph_mouse;
    if (gm) mouse = { x: gm[0] - this.pos[0], y: gm[1] - this.pos[1] };
    hooks.paint(ctx, this, this.size[0], this.size[1], mouse, geo);
  };

  const _origDown = nodeType.prototype.onMouseDown;
  nodeType.prototype.onMouseDown = function (e, pos) {
    if (isVueNodes()) return _origDown ? _origDown.call(this, e, pos) : undefined;
    cmpHideTooltip();
    const canvasEl = app.canvas?.canvas;
    const scale = app.canvas?.ds?.scale || 1;
    const geo = hooks.getGeo(this);
    if (hooks.cmpDown(this, pos[0], pos[1], this.size[0], this.size[1], canvasEl, this.pos, scale, null, geo)) {
      app.graph.setDirtyCanvas(true, true);
      return true;
    }
    if (_origDown) return _origDown.call(this, e, pos);
  };

  const _origMove = nodeType.prototype.onMouseMove;
  nodeType.prototype.onMouseMove = function (e, pos) {
    if (isVueNodes()) return _origMove ? _origMove.call(this, e, pos) : undefined;
    const geo = hooks.getGeo(this);
    if (hooks.cmpMove(this, pos[0], pos[1], this.size[0], this.size[1], geo)) {
      app.graph.setDirtyCanvas(true, true);
    }
    cmpShowTooltip(hooks.cmpTooltipFor(this, pos[0], pos[1], this.size[0], geo), e?.clientX ?? 0, e?.clientY ?? 0);
    if (_origMove) return _origMove.call(this, e, pos);
  };

  const _origUp = nodeType.prototype.onMouseUp;
  nodeType.prototype.onMouseUp = function (e, pos) {
    if (isVueNodes()) return _origUp ? _origUp.call(this, e, pos) : undefined;
    hooks.cmpUp(this);
    if (_origUp) return _origUp.call(this, e, pos);
  };

  const _origWheel = nodeType.prototype.onMouseWheel;
  nodeType.prototype.onMouseWheel = function (e, pos) {
    if (isVueNodes()) return _origWheel ? _origWheel.call(this, e, pos) : undefined;
    const geo = hooks.getGeo(this);
    if (hooks.cmpWheel(this, pos[1], e.deltaY, geo)) {
      app.graph.setDirtyCanvas(true, true);
      return true;
    }
    if (_origWheel) return _origWheel.call(this, e, pos);
  };

  const _origLeave = nodeType.prototype.onMouseLeave;
  nodeType.prototype.onMouseLeave = function (e) {
    if (isVueNodes()) return _origLeave ? _origLeave.call(this, e) : undefined;
    cmpHideTooltip();
    hooks.cmpLeave(this);
    app.graph.setDirtyCanvas(true, true);
    if (_origLeave) return _origLeave.call(this, e);
  };

  const _origResize = nodeType.prototype.onResize;
  nodeType.prototype.onResize = function (e) {
    if (!isVueNodes()) {
      const geo = hooks.getGeo(this);
      // Same floor as onDrawForeground uses so the node can't transiently sit
      // below its real minimum before the next paint snaps it back.
      this.size[0] = Math.max(this.size[0], geo.MIN_W);
      this.size[1] = Math.max(this.size[1], geo.MIN_H);
    }
    if (_origResize) return _origResize.call(this, e);
  };

  const _origRemoved = nodeType.prototype.onRemoved;
  nodeType.prototype.onRemoved = function () {
    try { this._cmpDomRO?.disconnect(); } catch {}
    try { cancelAnimationFrame(this._cmpZoomRaf); } catch {}
    if (labelEditBlocking()) finishLabelEdit(this, false);
    cmpHideTooltip();
    this._cmpDomRO = null;
    this._cmpDomRender = null;
    return _origRemoved ? _origRemoved.apply(this, arguments) : undefined;
  };
}
