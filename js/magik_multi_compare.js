import { app } from "/scripts/app.js";
import * as Core from "./magik_compare_core.js";

// ═══════════════════════════════════════════════════════════════
//  Magik Multi Compare — dynamic-input picker on top of the shared core
// ═══════════════════════════════════════════════════════════════

const MAX_SLOTS = 10;
const PICKER_CELL = 16;
const PICKER_GAP = 2;
// Extra header height (beyond the base 2-label-row block) the picker grid needs:
// 4 rows of PICKER_CELL+PICKER_GAP, plus an 8px gap before the mode-buttons row.
const HEADER_EXTRA = 34;
const SLOT_ROW_H_FALLBACK = 20;

function getGeo(node) {
  const slotRowH = window.LiteGraph?.NODE_SLOT_HEIGHT || SLOT_ROW_H_FALLBACK;
  const visibleInputs = node.inputs?.length || 2;
  const topOffset = Math.max(0, visibleInputs - 2) * slotRowH;
  return Core.buildGeometry({ topOffset, headerExtra: HEADER_EXTRA });
}

// ── Dynamic input management ──
function isSlotConnected(node, slot) {
  const inp = node.inputs?.[slot - 1];
  return !!(inp && inp.link != null);
}

// Auto-reassigns any selection slot that's no longer connected to the
// lowest-numbered still-connected slot that isn't the other current selection.
function ensureValidSelection(node) {
  const selA = node._cmpSelA, selB = node._cmpSelB;
  const aOk = isSlotConnected(node, selA);
  const bOk = isSlotConnected(node, selB);
  if (aOk && bOk) return false;
  const connected = [];
  for (let i = 1; i <= (node.inputs?.length || 0); i++) if (isSlotConnected(node, i)) connected.push(i);
  let newA = aOk ? selA : null;
  let newB = bOk ? selB : null;
  for (const slot of connected) {
    if (newA === null && slot !== newB) { newA = slot; continue; }
    if (newB === null && slot !== newA) { newB = slot; continue; }
  }
  // Shouldn't normally happen (image1/image2 are required), but stay defensive
  // rather than leaving a selection pointing at nothing.
  if (newA === null) newA = selA;
  if (newB === null) newB = selB;
  const changed = newA !== selA || newB !== selB;
  node._cmpSelA = newA;
  node._cmpSelB = newB;
  if (changed && node._cmpMostRecent !== newA && node._cmpMostRecent !== newB) {
    node._cmpMostRecent = newB;
  }
  return changed;
}

// Grows/shrinks the trailing optional input slots (2..MAX_SLOTS) so exactly one
// empty slot is always available past the last connected one, without ever
// renumbering or removing a non-trailing (gap) slot. Also grows the node's
// canvas-mode height to keep the image area from shrinking as the header grows.
function manageMultiInputs(node) {
  const slotRowH = window.LiteGraph?.NODE_SLOT_HEIGHT || SLOT_ROW_H_FALLBACK;
  let grew = 0;
  while (node.inputs.length < MAX_SLOTS) {
    const last = node.inputs[node.inputs.length - 1];
    if (last && last.link != null) {
      node.addInput(`image${node.inputs.length + 1}`, "IMAGE");
      grew++;
    } else break;
  }
  while (node.inputs.length > 2) {
    const last = node.inputs[node.inputs.length - 1];
    const prev = node.inputs[node.inputs.length - 2];
    const lastEmpty = !last || last.link == null;
    const prevEmpty = !prev || prev.link == null;
    if (lastEmpty && prevEmpty) node.removeInput(node.inputs.length - 1);
    else break;
  }
  if (grew > 0 && !Core.isVueNodes()) node.size[1] += grew * slotRowH;
  if (ensureValidSelection(node)) {
    updateActiveCmpImages(node);
    saveCompareState(node);
  }
  Core.cmpRepaint(node);
}

// ── Selection (rotating-buffer replace: a 3rd pick replaces whichever of the
//    current two was chosen less recently) ──
function selectSlot(node, slot) {
  if (slot === node._cmpSelA || slot === node._cmpSelB) return;
  const older = node._cmpMostRecent === node._cmpSelA ? node._cmpSelB : node._cmpSelA;
  if (older === node._cmpSelA) node._cmpSelA = slot; else node._cmpSelB = slot;
  node._cmpMostRecent = slot;
  updateActiveCmpImages(node);
  saveCompareState(node);
}

// Resolves node._cmpImg1/_cmpImg2/_cmpLabel1/_cmpLabel2 -- the fields Core's
// paint/label-edit code reads -- from the current pair selection. Lower slot
// number is always _cmpImg1/label1 (stable wipe-direction convention).
function updateActiveCmpImages(node) {
  const a = Math.min(node._cmpSelA, node._cmpSelB);
  const b = Math.max(node._cmpSelA, node._cmpSelB);
  node._cmpImg1 = node._cmpCandidates?.[a] || null;
  node._cmpImg2 = node._cmpCandidates?.[b] || null;
  node._cmpLabel1 = node._cmpLabelsBySlot?.[a] || `image ${a}`;
  node._cmpLabel2 = node._cmpLabelsBySlot?.[b] || `image ${b}`;
}

// ── Picker grid geometry (phone-dialer layout: 1-9 in a 3x3 grid, 10 centered
//    on its own row below) ──
function pickerOrigin(geo) {
  return { x: geo.EYE_X + Core.EYE_SIZE + 10, y: geo.SLOT_0_Y };
}

function pickerCellRect(slot, geo) {
  const { x: ox, y: oy } = pickerOrigin(geo);
  if (slot <= 9) {
    const idx = slot - 1;
    const col = idx % 3, row = Math.floor(idx / 3);
    return {
      x: ox + col * (PICKER_CELL + PICKER_GAP),
      y: oy + row * (PICKER_CELL + PICKER_GAP),
      w: PICKER_CELL, h: PICKER_CELL,
    };
  }
  const gridW = 3 * PICKER_CELL + 2 * PICKER_GAP;
  const row3Y = oy + 3 * (PICKER_CELL + PICKER_GAP);
  return { x: ox + (gridW - PICKER_CELL) / 2, y: row3Y, w: PICKER_CELL, h: PICKER_CELL };
}

function paintPicker(ctx, node, geo) {
  for (let slot = 1; slot <= MAX_SLOTS; slot++) {
    const r = pickerCellRect(slot, geo);
    const connected = isSlotConnected(node, slot);
    const selected = slot === node._cmpSelA || slot === node._cmpSelB;
    ctx.save();
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(r.x, r.y, r.w, r.h, 3);
    else ctx.rect(r.x, r.y, r.w, r.h);
    ctx.fillStyle = connected ? "#2a2c2e" : "#202122";
    ctx.fill();
    ctx.strokeStyle = selected ? Core.BRAND : (connected ? "#4a4a4a" : "#333");
    ctx.lineWidth = selected ? 2 : 1;
    ctx.stroke();
    ctx.fillStyle = selected ? Core.BRAND : (connected ? "#999" : "#555");
    ctx.font = "9px 'Segoe UI',sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(slot), r.x + r.w / 2, r.y + r.h / 2);
    ctx.restore();
  }
}

function pickerDown(node, lx, ly, geo) {
  const p = [lx, ly];
  for (let slot = 1; slot <= MAX_SLOTS; slot++) {
    if (Core.inside(p, pickerCellRect(slot, geo))) {
      if (isSlotConnected(node, slot)) selectSlot(node, slot);
      return true; // consume the click either way (disabled cells just do nothing)
    }
  }
  return false;
}

function pickerCursor(node, lx, ly, geo) {
  const p = [lx, ly];
  for (let slot = 1; slot <= MAX_SLOTS; slot++) {
    if (Core.inside(p, pickerCellRect(slot, geo))) return isSlotConnected(node, slot) ? "pointer" : "not-allowed";
  }
  return null;
}

function pickerTooltip(node, lx, ly, geo) {
  const p = [lx, ly];
  for (let slot = 1; slot <= MAX_SLOTS; slot++) {
    if (Core.inside(p, pickerCellRect(slot, geo))) {
      if (!isSlotConnected(node, slot)) return `Image ${slot} isn't connected.`;
      if (slot === node._cmpSelA || slot === node._cmpSelB) return `Image ${slot} is currently shown.`;
      return `Click to compare image ${slot}.`;
    }
  }
  return "";
}

// ── Composed paint / interaction (Core base + picker) ──
function paint(ctx, node, W, H, mouse, geo) {
  Core.paintCompareBase(ctx, node, W, H, mouse, geo);
  paintPicker(ctx, node, geo);
}

function cmpDown(node, lx, ly, W, H, canvasEl, nodePos, scale, root, geo) {
  if (Core.labelEditBlocking()) return false;
  if (pickerDown(node, lx, ly, geo)) return true;
  return Core.cmpDownBase(node, lx, ly, W, H, canvasEl, nodePos, scale, root, geo);
}

function cmpMove(node, lx, ly, W, H, geo) {
  if (Core.labelEditBlocking()) return false;
  return Core.cmpMoveBase(node, lx, ly, W, H, geo);
}

function cmpUp(node) {
  Core.cmpUpBase(node);
}

function cmpWheel(node, ly, deltaY, geo) {
  if (Core.labelEditBlocking()) return false;
  return Core.cmpWheelBase(node, ly, deltaY, geo);
}

function cmpLeave(node) {
  if (Core.labelEditBlocking()) return;
  Core.cmpLeaveBase(node);
}

function cmpCursor(node, lx, ly, W, H, geo) {
  const base = Core.cmpCursorBase(node, lx, ly, W, H, geo);
  if (base) return base;
  const extra = pickerCursor(node, lx, ly, geo);
  if (extra) return extra;
  return "default";
}

function cmpTooltipFor(node, lx, ly, W, geo) {
  return Core.cmpTooltipForBase(node, lx, ly, W, geo) || pickerTooltip(node, lx, ly, geo) || "";
}

// ── Candidate image loading ──
// The Python node tags every saved file with its slot number in the filename
// (e.g. "..._slot7.png") since connected slots can have gaps; parse it back out
// rather than relying on array order.
function parseSlotTag(filename) {
  const m = /_slot(\d+)\.png$/.exec(filename);
  return m ? parseInt(m[1], 10) : null;
}

function loadCandidates(node, metaBySlot) {
  node._cmpCandidates = node._cmpCandidates || {};
  Object.entries(metaBySlot).forEach(([slotStr, meta]) => {
    const slot = parseInt(slotStr, 10);
    Core.loadOneImage(meta)
      .then((img) => {
        node._cmpCandidates[slot] = img;
        node.imgs = null;
        updateActiveCmpImages(node);
        Core.cmpRepaint(node);
      })
      .catch((err) => console.warn(`[Magik Multi Compare] ${err.message}`));
  });
}

// ── State persistence ──
const STATE_KEY = "compareState";

function saveCompareState(node) {
  // Capture any freshly-edited label text back into the per-slot store before persisting.
  const a = Math.min(node._cmpSelA, node._cmpSelB);
  const b = Math.max(node._cmpSelA, node._cmpSelB);
  node._cmpLabelsBySlot = node._cmpLabelsBySlot || {};
  node._cmpLabelsBySlot[a] = node._cmpLabel1;
  node._cmpLabelsBySlot[b] = node._cmpLabel2;

  node.properties = node.properties || {};
  const prev = node.properties[STATE_KEY];
  node.properties[STATE_KEY] = {
    ...Core.baseStateFields(node),
    selA: node._cmpSelA,
    selB: node._cmpSelB,
    mostRecent: node._cmpMostRecent,
    labelsBySlot: node._cmpLabelsBySlot,
    candidates: prev?.candidates || {},
  };
}

function saveCandidatesToProps(node, outputImages) {
  const metaBySlot = {};
  for (const d of outputImages) {
    const slot = parseSlotTag(d.filename);
    if (slot == null) continue;
    metaBySlot[slot] = { filename: d.filename, subfolder: d.subfolder || "", type: d.type || "temp" };
  }
  node.properties = node.properties || {};
  node.properties[STATE_KEY] = {
    ...Core.baseStateFields(node),
    selA: node._cmpSelA,
    selB: node._cmpSelB,
    mostRecent: node._cmpMostRecent,
    labelsBySlot: node._cmpLabelsBySlot || {},
    candidates: metaBySlot,
  };
  return metaBySlot;
}

function restoreCompareFromProperties(node) {
  // Same one-shot guard rationale as Magik Image Compare: onNodeCreated queues
  // this via queueMicrotask while onConfigure calls it synchronously right
  // after node creation, and since image loading is async, an image-presence
  // check wouldn't catch the second call in time.
  if (node._cmpRestored) return;
  node._cmpRestored = true;
  const s = node.properties?.[STATE_KEY];
  if (!s) return;
  Core.applyBaseStateFields(node, s);
  if (typeof s.selA === "number") node._cmpSelA = s.selA;
  if (typeof s.selB === "number") node._cmpSelB = s.selB;
  if (typeof s.mostRecent === "number") node._cmpMostRecent = s.mostRecent;
  if (s.labelsBySlot && typeof s.labelsBySlot === "object") node._cmpLabelsBySlot = { ...s.labelsBySlot };
  if (s.candidates && typeof s.candidates === "object" && Object.keys(s.candidates).length) {
    loadCandidates(node, s.candidates);
  }
  updateActiveCmpImages(node);
  Core.cmpRepaint(node);
}

// ── Hooks bundle passed to Core's DOM widget / canvas-hooks installers ──
const hooks = {
  widgetName: "magik_multi_compare",
  getGeo,
  paint,
  cmpDown,
  cmpMove,
  cmpUp,
  cmpWheel,
  cmpLeave,
  cmpCursor,
  cmpTooltipFor,
};

app.registerExtension({
  name: "Magik.MultiCompare",
  async beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== "Magik.MultiCompare") return;

    const _origCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      _origCreated?.apply(this, arguments);
      Core.initBaseInstanceFields(this);
      this._cmpSelA = 1;
      this._cmpSelB = 2;
      this._cmpMostRecent = 2;
      this._cmpLabelsBySlot = { 1: "image 1", 2: "image 2" };
      this._cmpCandidates = {};
      this._cmpOnStateChange = () => saveCompareState(this);
      const geo = getGeo(this);
      this.size[0] = geo.INIT_W;
      this.size[1] = geo.INIT_H;
      this.hideOutputImages = true;
      if (Core.isVueNodes()) Core.createCompareDOMWidget(this, hooks);
      queueMicrotask(() => restoreCompareFromProperties(this));
    };

    const _origConnChange = nodeType.prototype.onConnectionsChange;
    nodeType.prototype.onConnectionsChange = function (type, slotIndex, isConnected, linkInfo, ioSlot) {
      _origConnChange?.apply(this, arguments);
      if (type !== (window.LiteGraph?.INPUT ?? 1)) return;
      manageMultiInputs(this);
    };

    const _origConfigure = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function () {
      const r = _origConfigure ? _origConfigure.apply(this, arguments) : undefined;
      restoreCompareFromProperties(this);
      // Re-validate selection against the now-restored input set (only fixes a
      // genuinely broken selection; harmless no-op otherwise).
      manageMultiInputs(this);
      return r;
    };

    nodeType.prototype.onExecuted = function (output) {
      this.imgs = null;
      if (!output?.images || output.images.length < 1) return;
      const metaBySlot = saveCandidatesToProps(this, output.images);
      this._cmpCandidates = {};
      loadCandidates(this, metaBySlot);
      if (ensureValidSelection(this)) saveCompareState(this);
      updateActiveCmpImages(this);
    };

    Core.installCanvasHooks(nodeType, hooks);
  },
});
