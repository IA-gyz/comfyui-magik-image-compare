import { app } from "/scripts/app.js";
import * as Core from "./magik_compare_core.js";

// ═══════════════════════════════════════════════════════════════
//  Magik Image Compare — batch/mosaic extras on top of the shared core
// ═══════════════════════════════════════════════════════════════

const BATCH_TOGGLE_W = 64;
const STEP_ARROW_W = 20;
// Reserved band between the mode-buttons row and the hint/slider row for the
// batch toggle + frame stepper, matching Core.BTN_H's own row height + gap.
const BATCH_ROW_EXTRA = Core.BTN_H + 4;

function getGeo() {
  return Core.buildGeometry({ rowExtra: BATCH_ROW_EXTRA });
}

function batchRowY(geo) {
  return geo.MODE_ROW_Y + Core.BTN_H + 4;
}

function batchRowRect(W, geo) {
  const L = Core.rowLayout(W);
  return { x: L.leftPad, y: batchRowY(geo), w: L.bw * 6 + L.gap * 5, h: Core.BTN_H };
}

function batchToggleRect(W, geo) {
  const r = batchRowRect(W, geo);
  return { x: r.x, y: r.y, w: BATCH_TOGGLE_W, h: r.h };
}

function batchStepRects(W, geo) {
  const r = batchRowRect(W, geo);
  const t = batchToggleRect(W, geo);
  const prevX = t.x + t.w + Core.BTN_GAP;
  const nextX = r.x + r.w - STEP_ARROW_W;
  const labelX = prevX + STEP_ARROW_W + Core.BTN_GAP;
  const labelW = Math.max(20, nextX - Core.BTN_GAP - labelX);
  return {
    prev: { x: prevX, y: r.y, w: STEP_ARROW_W, h: r.h },
    next: { x: nextX, y: r.y, w: STEP_ARROW_W, h: r.h },
    label: { x: labelX, y: r.y, w: labelW, h: r.h },
  };
}

// Both sides are always padded/truncated to the same frame count by the Python
// node, so batch1's length alone tells us whether there's anything to page through.
function batchLen(node) {
  return (node._cmpBatch1 && node._cmpBatch1.length) || 1;
}

function paintBatchRow(ctx, node, W, mouse, geo) {
  if (batchLen(node) <= 1) return;
  const hov = (rect) => !!(mouse &&
    mouse.x >= rect.x && mouse.x <= rect.x + rect.w &&
    mouse.y >= rect.y && mouse.y <= rect.y + rect.h);
  ctx.save();
  const bt = batchToggleRect(W, geo);
  const mosaicOn = node._cmpBatchView === "mosaic";
  Core.paintBtn(ctx, bt, mosaicOn ? "Mosaic" : "Frame", mosaicOn, hov(bt));
  if (!mosaicOn) {
    const st = batchStepRects(W, geo);
    Core.paintBtn(ctx, st.prev, "◀", false, hov(st.prev));
    Core.paintBtn(ctx, st.next, "▶", false, hov(st.next));
    ctx.fillStyle = "#999";
    ctx.font = "9px 'Segoe UI',sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(`Frame ${(node._cmpFrameIdx || 0) + 1} / ${batchLen(node)}`,
      st.label.x + st.label.w / 2, st.label.y + st.label.h / 2);
  } else {
    const br = batchRowRect(W, geo);
    const infoX = bt.x + bt.w + Core.BTN_GAP;
    const infoW = br.x + br.w - infoX;
    ctx.fillStyle = "#999";
    ctx.font = "9px 'Segoe UI',sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(`Comparing all ${batchLen(node)} frames as one image`,
      infoX + infoW / 2, bt.y + bt.h / 2);
  }
  ctx.restore();
}

function batchDown(node, lx, ly, W, geo) {
  if (batchLen(node) <= 1) return false;
  const p = [lx, ly];
  const bt = batchToggleRect(W, geo);
  if (Core.inside(p, bt)) {
    node._cmpBatchView = node._cmpBatchView === "mosaic" ? "frame" : "mosaic";
    updateActiveCmpImages(node);
    saveCompareState(node);
    return true;
  }
  if (node._cmpBatchView !== "mosaic") {
    const st = batchStepRects(W, geo);
    const n = batchLen(node);
    if (Core.inside(p, st.prev)) {
      node._cmpFrameIdx = ((node._cmpFrameIdx || 0) - 1 + n) % n;
      updateActiveCmpImages(node);
      saveCompareState(node);
      return true;
    }
    if (Core.inside(p, st.next)) {
      node._cmpFrameIdx = ((node._cmpFrameIdx || 0) + 1) % n;
      updateActiveCmpImages(node);
      saveCompareState(node);
      return true;
    }
  }
  return false;
}

function batchCursor(node, lx, ly, W, geo) {
  if (batchLen(node) <= 1) return null;
  const p = [lx, ly];
  if (Core.inside(p, batchToggleRect(W, geo))) return "pointer";
  if (node._cmpBatchView !== "mosaic") {
    const st = batchStepRects(W, geo);
    if (Core.inside(p, st.prev) || Core.inside(p, st.next)) return "pointer";
  }
  return null;
}

function batchTooltip(node, lx, ly, W, geo) {
  if (batchLen(node) <= 1) return "";
  const p = [lx, ly];
  if (Core.inside(p, batchToggleRect(W, geo))) {
    return node._cmpBatchView === "mosaic"
      ? "Comparing both full batches as one mosaic image each. Click to compare frame by frame instead."
      : "Comparing one frame pair at a time. Click to compare both full batches as a single mosaic image.";
  }
  if (node._cmpBatchView !== "mosaic") {
    const st = batchStepRects(W, geo);
    if (Core.inside(p, st.prev)) return "Previous frame pair.";
    if (Core.inside(p, st.next)) return "Next frame pair.";
  }
  return "";
}

// ── Composed paint / interaction (Core base + batch row) ──
function paint(ctx, node, W, H, mouse, geo) {
  Core.paintCompareBase(ctx, node, W, H, mouse, geo);
  paintBatchRow(ctx, node, W, mouse, geo);
}

function cmpDown(node, lx, ly, W, H, canvasEl, nodePos, scale, root, geo) {
  if (Core.labelEditBlocking()) return false;
  if (batchDown(node, lx, ly, W, geo)) return true;
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
  if (batchLen(node) > 1 && ly >= batchRowY(geo) && ly < batchRowY(geo) + Core.BTN_H) return false; // don't fight the batch row
  return Core.cmpWheelBase(node, ly, deltaY, geo);
}

function cmpLeave(node) {
  if (Core.labelEditBlocking()) return; // don't reset split while editing
  Core.cmpLeaveBase(node);
}

function cmpCursor(node, lx, ly, W, H, geo) {
  const base = Core.cmpCursorBase(node, lx, ly, W, H, geo);
  if (base) return base;
  const extra = batchCursor(node, lx, ly, W, geo);
  if (extra) return extra;
  return "default";
}

function cmpTooltipFor(node, lx, ly, W, geo) {
  return Core.cmpTooltipForBase(node, lx, ly, W, geo) || batchTooltip(node, lx, ly, W, geo) || "";
}

// ── Mosaic compositing ──
// Square-ish contact-sheet layout (cols = ceil(sqrt(n))), the same general
// approach ComfyUI's own multi-image gallery uses to tile a batch of thumbnails.
function computeGridLayout(n) {
  const cols = Math.max(1, Math.ceil(Math.sqrt(n)));
  const rows = Math.max(1, Math.ceil(n / cols));
  return { cols, rows };
}

// Composites a whole batch into one offscreen canvas so it can be treated as a
// single image by the shared wipe/overlay/difference paint code (a canvas is a
// valid ctx.drawImage source, same as an <img>). All frames in a ComfyUI IMAGE
// batch share identical dimensions (it's one tensor), so the first loaded
// frame's aspect ratio is authoritative for every cell.
function buildMosaicCanvas(frames) {
  const n = frames.length;
  if (!n) return null;
  const first = frames.find(Boolean);
  if (!first) return null;
  const { cols, rows } = computeGridLayout(n);
  const CELL = 256;
  const MAX_DIM = 2048;
  const aspect = Core.mediaW(first) / Core.mediaH(first) || 1;
  let cellW = CELL, cellH = CELL;
  if (aspect >= 1) cellH = Math.round(CELL / aspect);
  else cellW = Math.round(CELL * aspect);
  const scale = Math.min(1, MAX_DIM / (cols * cellW), MAX_DIM / (rows * cellH));
  cellW = Math.max(1, Math.round(cellW * scale));
  cellH = Math.max(1, Math.round(cellH * scale));

  const canvas = document.createElement("canvas");
  canvas.width = cols * cellW;
  canvas.height = rows * cellH;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  for (let i = 0; i < n; i++) {
    const img = frames[i];
    if (!img) continue;
    const col = i % cols, row = Math.floor(i / cols);
    const cx = col * cellW, cy = row * cellH;
    const iw = Core.mediaW(img), ih = Core.mediaH(img);
    const ia = (iw / ih) || aspect;
    let dw = cellW, dh = cellW / ia;
    if (dh > cellH) { dh = cellH; dw = cellH * ia; }
    ctx.drawImage(img, cx + (cellW - dw) / 2, cy + (cellH - dh) / 2, dw, dh);
  }
  return canvas;
}

// Resolves node._cmpImg1/_cmpImg2 — the pair Core's paint code renders — from
// either the currently selected frame or a cached full-batch mosaic, depending
// on node._cmpBatchView.
function updateActiveCmpImages(node) {
  if (node._cmpBatchView === "mosaic") {
    if (!node._cmpMosaic1) node._cmpMosaic1 = buildMosaicCanvas(node._cmpBatch1 || []);
    if (!node._cmpMosaic2) node._cmpMosaic2 = buildMosaicCanvas(node._cmpBatch2 || []);
    node._cmpImg1 = node._cmpMosaic1;
    node._cmpImg2 = node._cmpMosaic2;
  } else {
    const idx = node._cmpFrameIdx || 0;
    node._cmpImg1 = (node._cmpBatch1 || [])[idx] || null;
    node._cmpImg2 = (node._cmpBatch2 || [])[idx] || null;
  }
}

// outputImages is [side1_frame0..side1_frameN-1, side2_frame0..side2_frameN-1],
// matching the Python node's save order.
function loadCmpBatch(node, outputImages) {
  const half = outputImages.length / 2;
  node._cmpBatch1 = new Array(half).fill(null);
  node._cmpBatch2 = new Array(half).fill(null);
  node._cmpMosaic1 = null;
  node._cmpMosaic2 = null;
  if (typeof node._cmpFrameIdx !== "number" || node._cmpFrameIdx >= half || node._cmpFrameIdx < 0) {
    node._cmpFrameIdx = 0;
  }

  const onFrameLoaded = () => {
    node._cmpMosaic1 = null; // a new frame arrived; any cached mosaic is stale
    node._cmpMosaic2 = null;
    node.imgs = null;
    updateActiveCmpImages(node);
    Core.cmpRepaint(node);
  };

  outputImages.slice(0, half).forEach((meta, idx) => {
    Core.loadOneImage(meta)
      .then((img) => { node._cmpBatch1[idx] = img; onFrameLoaded(); })
      .catch((err) => console.warn(`[Magik Image Compare] ${err.message}`));
  });
  outputImages.slice(half).forEach((meta, idx) => {
    Core.loadOneImage(meta)
      .then((img) => { node._cmpBatch2[idx] = img; onFrameLoaded(); })
      .catch((err) => console.warn(`[Magik Image Compare] ${err.message}`));
  });
}

// ── State persistence ──
const STATE_KEY = "compareState";

function saveCompareState(node) {
  node.properties = node.properties || {};
  const prev = node.properties[STATE_KEY];
  node.properties[STATE_KEY] = {
    ...Core.baseStateFields(node),
    batchView: node._cmpBatchView || "frame",
    frameIdx: node._cmpFrameIdx || 0,
    images1: prev?.images1 || [],
    images2: prev?.images2 || [],
  };
}

function saveCompareImagesToProps(node, outputImages) {
  const half = outputImages.length / 2;
  const toMeta = (d) => ({ filename: d.filename, subfolder: d.subfolder || "", type: d.type || "temp" });
  node.properties = node.properties || {};
  node.properties[STATE_KEY] = {
    ...Core.baseStateFields(node),
    batchView: node._cmpBatchView || "frame",
    frameIdx: 0, // start from the first frame pair on a fresh execution
    images1: outputImages.slice(0, half).map(toMeta),
    images2: outputImages.slice(half).map(toMeta),
  };
}

function restoreCompareFromProperties(node) {
  // Guard with a one-shot flag rather than checking _cmpImg1/_cmpImg2: onNodeCreated
  // queues this via queueMicrotask while onConfigure calls it synchronously right after
  // node creation during graph load, and since loadCmpBatch is async, an image-presence
  // check doesn't catch the second call in time (it fires twice, double-loading images).
  if (node._cmpRestored) return;
  node._cmpRestored = true;
  const s = node.properties?.[STATE_KEY];
  if (!s) return;
  Core.applyBaseStateFields(node, s);
  if (s.batchView === "mosaic" || s.batchView === "frame") node._cmpBatchView = s.batchView;
  if (typeof s.frameIdx === "number") node._cmpFrameIdx = s.frameIdx;
  // Older saved workflows (pre-batch-support) stored a single "images" pair instead
  // of images1/images2; those won't match here and simply won't restore a preview
  // until the node is run again, no crash, nothing to migrate.
  if (Array.isArray(s.images1) && Array.isArray(s.images2) &&
      s.images1.length > 0 && s.images1.length === s.images2.length) {
    loadCmpBatch(node, s.images1.concat(s.images2));
  }
  Core.cmpRepaint(node);
}

// ── Hooks bundle passed to Core's DOM widget / canvas-hooks installers ──
const hooks = {
  widgetName: "magik_image_compare",
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
  name: "Magik.ImageCompare",
  async beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== "Magik.ImageCompare") return;

    const _origCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      _origCreated?.apply(this, arguments);
      Core.initBaseInstanceFields(this);
      this._cmpBatch1 = [];
      this._cmpBatch2 = [];
      this._cmpMosaic1 = null;
      this._cmpMosaic2 = null;
      this._cmpBatchView = "frame";
      this._cmpFrameIdx = 0;
      this._cmpOnStateChange = () => saveCompareState(this);
      const geo = getGeo();
      this.size[0] = geo.INIT_W;
      this.size[1] = geo.INIT_H;
      this.hideOutputImages = true;
      if (Core.isVueNodes()) Core.createCompareDOMWidget(this, hooks);
      queueMicrotask(() => restoreCompareFromProperties(this));
    };

    const _origConfigure = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function () {
      const r = _origConfigure ? _origConfigure.apply(this, arguments) : undefined;
      restoreCompareFromProperties(this);
      return r;
    };

    nodeType.prototype.onExecuted = function (output) {
      this.imgs = null;
      if (!output?.images || output.images.length < 2 || output.images.length % 2 !== 0) return;
      saveCompareImagesToProps(this, output.images);
      loadCmpBatch(this, output.images);
    };

    Core.installCanvasHooks(nodeType, hooks);
  },
});
