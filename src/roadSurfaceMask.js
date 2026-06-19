import * as THREE from 'three';

// Road surface mask system: bake top-down canvas masks for asphalt / shoulder /
// junction / line, sampled in terrain shader by world (x,z).
//
// All four CanvasTextures cover the terrain bounds [-terrainSize/2, terrainSize/2].
// World->UV: u = (x + S/2)/S, v = (z + S/2)/S. Mask CanvasTextures use
// flipY=false so the baked pixel row (v*H) matches the shader sample row.

const CANVAS_SIZE = 2048;

function makeCanvas(size) {
  if (typeof OffscreenCanvas !== 'undefined') {
    try { return new OffscreenCanvas(size, size); } catch (_) { /* fallthrough */ }
  }
  const c = document.createElement('canvas');
  c.width = size; c.height = size;
  return c;
}

function worldToPx(wx, wz, terrainSize, canvasSize) {
  const u = (wx + terrainSize * 0.5) / terrainSize;
  const v = (wz + terrainSize * 0.5) / terrainSize;
  return [u * canvasSize, v * canvasSize];
}

function strokePolyline(ctx, pts, lineWidthPx, strokeStyle, alpha) {
  if (!pts.length) return;
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = strokeStyle;
  ctx.globalAlpha = alpha;
  ctx.lineWidth = lineWidthPx;
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  // close loop if first/last close (main road is a loop)
  const dx = pts[0][0] - pts[pts.length-1][0], dy = pts[0][1] - pts[pts.length-1][1];
  if (Math.hypot(dx, dy) < lineWidthPx * 1.5) ctx.closePath();
  ctx.stroke();
  ctx.restore();
}

function samplesToPx(samples, terrainSize, canvasSize) {
  const out = new Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    out[i] = worldToPx(samples[i].x, samples[i].z, terrainSize, canvasSize);
  }
  return out;
}

function makeTexture(canvas) {
  const tex = new THREE.CanvasTexture(canvas);
  // Data mask textures must NOT be vertically flipped: canvas pixel rows are
  // baked via worldToPx (v = (wz+S/2)/S, row = v*H) and the shader samples with
  // the same v from world z. CanvasTexture defaults flipY=true, which mirrored
  // the mask on the z axis (off-center-z surfaces landed on the opposite side).
  tex.flipY = false;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  tex.colorSpace = THREE.NoColorSpace;
  tex.needsUpdate = true;
  return tex;
}

function drawAsphalt(ctx, mainPx, branchPx, mainWPx, branchWPx) {
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  strokePolyline(ctx, mainPx, mainWPx, '#ffffff', 1.0);
  if (branchPx && branchPx.length) {
    strokePolyline(ctx, branchPx, branchWPx, '#ffffff', 1.0);
  }
}

function drawShoulder(ctx, mainPx, branchPx, mainShoulderPx, branchShoulderPx) {
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  // soft outer band: stroke slightly wider with low alpha twice
  for (let pass = 0; pass < 2; pass++) {
    strokePolyline(ctx, mainPx, mainShoulderPx, '#ffffff', 0.6);
    if (branchPx && branchPx.length) {
      strokePolyline(ctx, branchPx, branchShoulderPx, '#ffffff', 0.6);
    }
  }
}

function drawJunction(ctx, centersPx, radiusPx) {
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  for (const [cx, cy] of centersPx) {
    // 内 60% 半径实心 alpha=1（核心区 junctionM≈1，线条抑制可靠），外 40% 软过渡到 0
    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, radiusPx);
    grad.addColorStop(0.0, 'rgba(255,255,255,1.0)');
    grad.addColorStop(0.6, 'rgba(255,255,255,1.0)');
    grad.addColorStop(1.0, 'rgba(255,255,255,0.0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(cx, cy, radiusPx, 0, Math.PI * 2);
    ctx.fill();
  }
}

function buildEdgePolylines(samples, halfW) {
  const left = [], right = [];
  const N = samples.length;
  for (let i = 0; i < N; i++) {
    const a = samples[i];
    const b = samples[(i + 1) % N];
    let tx = b.x - a.x, tz = b.z - a.z;
    const L = Math.hypot(tx, tz) || 1;
    tx /= L; tz /= L;
    // left normal = (-tz, tx); right normal = (tz, -tx)
    const nlx = -tz, nlz = tx;
    left.push([a.x + nlx * halfW, a.z + nlz * halfW]);
    right.push([a.x - nlx * halfW, a.z - nlz * halfW]);
  }
  return { left, right };
}

function drawLines(ctx, samples, bSamples, terrainSize, canvasSize, mainHalf, branchHalf, metersPerPx) {
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);

  // R channel = yellow centerline ; G channel = white edge lines.
  // We can draw R-only by using strokeStyle 'rgb(255,0,0)', and G by 'rgb(0,255,0)'.
  const mainPx = samplesToPx(samples, terrainSize, canvasSize);
  const yellowWidthPx = 0.22 / metersPerPx; // ~22cm yellow centerline
  strokePolyline(ctx, mainPx, Math.max(1, yellowWidthPx), 'rgb(255,0,0)', 1.0);

  // edge lines on main road: ±HALF_W → in pixels
  const mainEdges = buildEdgePolylines(samples, mainHalf);
  const mainEdgeLeftPx = mainEdges.left.map(([x, z]) => worldToPx(x, z, terrainSize, canvasSize));
  const mainEdgeRightPx = mainEdges.right.map(([x, z]) => worldToPx(x, z, terrainSize, canvasSize));
  const whiteEdgePx = 0.22 / metersPerPx;
  strokePolyline(ctx, mainEdgeLeftPx, Math.max(1, whiteEdgePx), 'rgb(0,255,0)', 1.0);
  strokePolyline(ctx, mainEdgeRightPx, Math.max(1, whiteEdgePx), 'rgb(0,255,0)', 1.0);

  if (bSamples && bSamples.length) {
    const bEdges = buildEdgePolylines(bSamples, branchHalf);
    const bLeftPx = bEdges.left.map(([x, z]) => worldToPx(x, z, terrainSize, canvasSize));
    const bRightPx = bEdges.right.map(([x, z]) => worldToPx(x, z, terrainSize, canvasSize));
    strokePolyline(ctx, bLeftPx, Math.max(1, whiteEdgePx), 'rgb(0,255,0)', 1.0);
    strokePolyline(ctx, bRightPx, Math.max(1, whiteEdgePx), 'rgb(0,255,0)', 1.0);
  }
}

export function createRoadSurfaceMasks({
  samples,
  bSamples,
  HALF_W,
  B_HALF,
  BRANCH_A,
  BRANCH_B,
  terrainSize,
  canvasSize = CANVAS_SIZE,
}) {
  const metersPerPx = terrainSize / canvasSize;

  const mainPx = samplesToPx(samples, terrainSize, canvasSize);
  const branchPx = bSamples && bSamples.length ? samplesToPx(bSamples, terrainSize, canvasSize) : [];

  // --- asphalt ---
  const cAsphalt = makeCanvas(canvasSize);
  const ctxA = cAsphalt.getContext('2d');
  drawAsphalt(
    ctxA,
    mainPx,
    branchPx,
    (HALF_W * 2) / metersPerPx,
    (B_HALF * 2) / metersPerPx,
  );

  // --- shoulder ---
  const SHOULDER_WIDTH_M = 4.0;
  const cShoulder = makeCanvas(canvasSize);
  const ctxS = cShoulder.getContext('2d');
  drawShoulder(
    ctxS,
    mainPx,
    branchPx,
    ((HALF_W + SHOULDER_WIDTH_M) * 2) / metersPerPx,
    ((B_HALF + SHOULDER_WIDTH_M) * 2) / metersPerPx,
  );

  // --- junction ---
  const cJunction = makeCanvas(canvasSize);
  const ctxJ = cJunction.getContext('2d');
  const junctionRadiusM = HALF_W + B_HALF + 12.0; // 加大覆盖，让三线交错的交汇区被充分盖住
  const junctionRadiusPx = junctionRadiusM / metersPerPx;
  const centersPx = [];
  if (samples[BRANCH_A]) {
    centersPx.push(worldToPx(samples[BRANCH_A].x, samples[BRANCH_A].z, terrainSize, canvasSize));
  }
  if (samples[BRANCH_B]) {
    centersPx.push(worldToPx(samples[BRANCH_B].x, samples[BRANCH_B].z, terrainSize, canvasSize));
  }
  drawJunction(ctxJ, centersPx, junctionRadiusPx);

  // --- line (R = yellow center, G = white edges) ---
  const cLine = makeCanvas(canvasSize);
  const ctxL = cLine.getContext('2d');
  drawLines(ctxL, samples, bSamples, terrainSize, canvasSize, HALF_W, B_HALF, metersPerPx);

  return {
    asphaltMask: makeTexture(cAsphalt),
    shoulderMask: makeTexture(cShoulder),
    junctionMask: makeTexture(cJunction),
    lineMask: makeTexture(cLine),
    terrainSize,
    canvasSize,
    _canvases: { asphalt: cAsphalt, shoulder: cShoulder, junction: cJunction, line: cLine },
  };
}

// Dev overlay: dump 4 mini canvases into a fixed div in the corner.
// Activated by `?roadmask=1`.
export function maybeShowRoadMaskDebug(masks) {
  if (typeof location === 'undefined' || typeof document === 'undefined') return;
  const on = new URLSearchParams(location.search).get('roadmask') === '1';
  if (!on) return;
  const wrap = document.createElement('div');
  wrap.style.cssText = [
    'position:fixed', 'right:8px', 'bottom:8px', 'z-index:9999',
    'display:grid', 'grid-template-columns:repeat(2, 256px)', 'grid-gap:4px',
    'padding:6px', 'background:rgba(0,0,0,0.55)', 'font:11px monospace', 'color:#fff',
    'border:1px solid #555',
  ].join(';');
  const labels = [
    ['asphalt', masks._canvases.asphalt],
    ['shoulder', masks._canvases.shoulder],
    ['junction', masks._canvases.junction],
    ['line(RG)', masks._canvases.line],
  ];
  for (const [name, src] of labels) {
    const cell = document.createElement('div');
    const c = document.createElement('canvas');
    c.width = 256; c.height = 256;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, 256, 256);
    try { ctx.drawImage(src, 0, 0, 256, 256); } catch (_) {}
    const lbl = document.createElement('div');
    lbl.textContent = name;
    cell.appendChild(c);
    cell.appendChild(lbl);
    wrap.appendChild(cell);
  }
  document.body.appendChild(wrap);
}
