// Procedurally painted, seamlessly tiling ground textures (no image files to download).
import * as THREE from 'three';
import { mulberry32 } from './util.js';

/** Tileable fractal value noise: returns Float32Array size*size in 0..1. */
export function tileFbm(size, basePeriod, octaves, seed) {
  const out = new Float32Array(size * size); let norm = 0;
  const R = mulberry32(seed);
  for (let o = 0, amp = 1, per = basePeriod; o < octaves; o++, amp *= .5, per *= 2) {
    const lat = new Float32Array(per * per); for (let i = 0; i < lat.length; i++) lat[i] = R();
    const k = per / size;
    for (let y = 0; y < size; y++) {
      const fy = y * k, yi = fy | 0, ty = fy - yi, sy = ty * ty * (3 - 2 * ty), y0 = (yi % per) * per, y1 = ((yi + 1) % per) * per;
      for (let x = 0; x < size; x++) {
        const fx = x * k, xi = fx | 0, tx = fx - xi, sx = tx * tx * (3 - 2 * tx), x0 = xi % per, x1 = (xi + 1) % per;
        const a = lat[y0 + x0], b = lat[y0 + x1], c = lat[y1 + x0], d = lat[y1 + x1];
        out[y * size + x] += amp * (a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy);
      }
    }
    norm += amp;
  }
  for (let i = 0; i < out.length; i++) out[i] /= norm;
  return out;
}
function canvasFrom(size, fn) {
  const cv = document.createElement('canvas'); cv.width = cv.height = size;
  const ctx = cv.getContext('2d'), img = ctx.createImageData(size, size);
  fn(img.data); ctx.putImageData(img, 0, 0); return { cv, ctx };
}
const mixc = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
/** Draw something at (x,y) and its wrapped copies so the texture still tiles. */
function wrapDraw(size, x, y, r, fn) { for (const ox of [-size, 0, size]) for (const oy of [-size, 0, size]) { const X = x + ox, Y = y + oy; if (X > -r && X < size + r && Y > -r && Y < size + r) fn(X, Y); } }

function grass(size) {
  const n = tileFbm(size, 4, 6, 11), m = tileFbm(size, 8, 3, 12), R = mulberry32(13);
  const { cv, ctx } = canvasFrom(size, d => {
    for (let i = 0; i < size * size; i++) {
      let c = mixc([52, 70, 30], [104, 122, 58], n[i]);
      c = mixc(c, [122, 116, 66], Math.max(0, m[i] - .55) * 1.6);
      const j = (R() - .5) * 18; d[i * 4] = c[0] + j; d[i * 4 + 1] = c[1] + j; d[i * 4 + 2] = c[2] + j * .5; d[i * 4 + 3] = 255;
    }
  });
  const s = size / 512;
  for (let i = 0; i < 9000 * s * s; i++) {
    const x = R() * size, y = R() * size, l = (3 + R() * 7) * s, a = -Math.PI / 2 + (R() - .5) * 1.1;
    const t = R(), c = t < .5 ? mixc([60, 84, 30], [128, 150, 66], R()) : t < .85 ? mixc([84, 100, 40], [150, 160, 80], R()) : [150, 134, 80];
    ctx.strokeStyle = `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${.45 + R() * .4})`; ctx.lineWidth = (.6 + R() * .9) * s;
    wrapDraw(size, x, y, l, (X, Y) => { ctx.beginPath(); ctx.moveTo(X, Y); ctx.lineTo(X + Math.cos(a) * l, Y + Math.sin(a) * l); ctx.stroke(); });
  }
  return cv;
}
function dirt(size) {
  const n = tileFbm(size, 4, 6, 21), R = mulberry32(23);
  const { cv, ctx } = canvasFrom(size, d => {
    for (let i = 0; i < size * size; i++) { const c = mixc([86, 66, 46], [146, 120, 88], n[i]), j = (R() - .5) * 22; d[i * 4] = c[0] + j; d[i * 4 + 1] = c[1] + j; d[i * 4 + 2] = c[2] + j; d[i * 4 + 3] = 255; }
  });
  const s = size / 512;
  for (let i = 0; i < 1400 * s * s; i++) {
    const x = R() * size, y = R() * size, r = (1 + R() * 3.2) * s, v = 90 + R() * 90;
    wrapDraw(size, x, y, r + 2, (X, Y) => {
      ctx.fillStyle = 'rgba(30,22,14,.35)'; ctx.beginPath(); ctx.ellipse(X + r * .3, Y + r * .4, r, r * .75, 0, 0, 6.3); ctx.fill();
      ctx.fillStyle = `rgb(${v | 0},${v * .92 | 0},${v * .8 | 0})`; ctx.beginPath(); ctx.ellipse(X, Y, r, r * .75, R() * 3, 0, 6.3); ctx.fill();
    });
  }
  return cv;
}
function rock(size) {
  const n = tileFbm(size, 4, 6, 31), m = tileFbm(size, 16, 3, 32), R = mulberry32(33);
  const { cv, ctx } = canvasFrom(size, d => {
    for (let i = 0; i < size * size; i++) {
      const ridge = 1 - Math.abs(2 * m[i] - 1);
      let c = mixc([82, 80, 76], [156, 152, 144], n[i] * .7 + ridge * .3);
      const j = (R() - .5) * 14; d[i * 4] = c[0] + j; d[i * 4 + 1] = c[1] + j; d[i * 4 + 2] = c[2] + j; d[i * 4 + 3] = 255;
    }
  });
  const s = size / 512;
  ctx.lineCap = 'round';
  for (let k = 0; k < 70 * s * s; k++) { // cracks
    let x = R() * size, y = R() * size, a = R() * 6.3; ctx.strokeStyle = `rgba(40,38,36,${.35 + R() * .35})`; ctx.lineWidth = (.6 + R() * 1.4) * s;
    for (let i = 0; i < 14; i++) { const nx = x + Math.cos(a) * 6 * s, ny = y + Math.sin(a) * 6 * s; wrapDraw(size, x, y, 10, (X, Y) => { ctx.beginPath(); ctx.moveTo(X, Y); ctx.lineTo(X + nx - x, Y + ny - y); ctx.stroke(); }); x = nx; y = ny; a += (R() - .5) * 1.2; }
  }
  for (let k = 0; k < 260 * s * s; k++) { const x = R() * size, y = R() * size, r = (1 + R() * 4) * s; ctx.fillStyle = R() < .6 ? 'rgba(110,122,70,.35)' : 'rgba(170,160,110,.3)'; wrapDraw(size, x, y, r, (X, Y) => { ctx.beginPath(); ctx.arc(X, Y, r, 0, 6.3); ctx.fill(); }); }
  return cv;
}
function sand(size) {
  const n = tileFbm(size, 6, 5, 41), R = mulberry32(43);
  const { cv } = canvasFrom(size, d => {
    for (let i = 0; i < size * size; i++) { const c = mixc([160, 144, 108], [208, 192, 152], n[i]), j = (R() - .5) * 26; d[i * 4] = c[0] + j; d[i * 4 + 1] = c[1] + j; d[i * 4 + 2] = c[2] + j * .8; d[i * 4 + 3] = 255; }
  });
  return cv;
}

export function groundTextures(size, maxAniso) {
  const make = cv => { const t = new THREE.CanvasTexture(cv); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = Math.min(8, maxAniso); return t; };
  return { grass: make(grass(size)), dirt: make(dirt(size)), rock: make(rock(size)), sand: make(sand(size)) };
}

// ---------------- extra painted textures (ships, sails, detail, foam, clouds) ----------------
const cvTex = (cv, repeat = true, srgb = true) => { const t = new THREE.CanvasTexture(cv); if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping; if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t; };
/** Weathered ship planking: horizontal boards with grain, seams and nail heads. */
export function planksTexture(size = 256) {
  const n = tileFbm(size, 4, 5, 51), R = mulberry32(52);
  const { cv, ctx } = canvasFrom(size, d => {
    for (let y = 0; y < size; y++) {
      const board = Math.floor(y / (size / 8)), tone = .85 + ((board * 37) % 7) / 30;
      for (let x = 0; x < size; x++) {
        const i = y * size + x, grain = Math.sin((x * .09 + n[i] * 6 + board * 3)) * .5 + .5;
        const c = mixc([70, 46, 28], [128, 90, 56], (n[i] * .6 + grain * .4)).map(v => v * tone);
        d[i * 4] = c[0]; d[i * 4 + 1] = c[1]; d[i * 4 + 2] = c[2]; d[i * 4 + 3] = 255;
      }
    }
  });
  for (let b = 0; b <= 8; b++) { const y = b * size / 8; ctx.fillStyle = 'rgba(20,12,6,.75)'; ctx.fillRect(0, y - 1, size, 2); const off = (b * 53) % size; ctx.fillRect(off, y, 2, size / 8); for (let k = 0; k < 6; k++) { ctx.fillStyle = 'rgba(30,24,20,.8)'; ctx.fillRect((off + 10 + k * size / 6) % size, y + 4, 2, 2); } }
  for (let i = 0; i < 40; i++) { ctx.fillStyle = `rgba(20,14,8,${.1 + R() * .15})`; ctx.beginPath(); ctx.ellipse(R() * size, R() * size, 6 + R() * 20, 2 + R() * 4, 0, 0, 6.3); ctx.fill(); }
  return cvTex(cv);
}
/** Sail cloth in team colours: weave, seams, wear; style 'emblem' | 'stripes' | 'plain'. */
export function sailTexture(teamHex, team, style) {
  const S = 256, cv = document.createElement('canvas'); cv.width = cv.height = S; const ctx = cv.getContext('2d'), R = mulberry32(60 + team * 7 + style.length);
  const tc = new THREE.Color(teamHex).convertLinearToSRGB(), css = (c, k = 1) => `rgb(${c.r * 255 * k | 0},${c.g * 255 * k | 0},${c.b * 255 * k | 0})`;
  ctx.fillStyle = style === 'plain' ? '#d8ccb0' : css(tc); ctx.fillRect(0, 0, S, S);
  if (style === 'stripes') for (let i = 0; i < 6; i++) if (i % 2) { ctx.fillStyle = '#e6dcc4'; ctx.fillRect(i * S / 6, 0, S / 6, S); }
  if (style === 'emblem') {
    ctx.fillStyle = '#e6dcc4'; ctx.beginPath(); ctx.arc(S / 2, S / 2, S * .27, 0, 6.3); ctx.fill();
    ctx.fillStyle = team === 0 ? '#c8962e' : '#8a1a12';
    if (team === 0) { ctx.fillRect(S / 2 - 12, S / 2 - 50, 24, 100); ctx.fillRect(S / 2 - 40, S / 2 - 22, 80, 22); }
    else { ctx.save(); ctx.translate(S / 2, S / 2 + 10); ctx.lineWidth = 22; ctx.strokeStyle = '#8a1a12'; ctx.beginPath(); ctx.moveTo(-48, 28); ctx.lineTo(0, -26); ctx.lineTo(48, 28); ctx.stroke(); ctx.restore(); }
  }
  if (style === 'plain') for (let i = 0; i < 3; i++) { ctx.fillStyle = `rgba(150,120,80,.35)`; ctx.fillRect(R() * S * .7, R() * S * .7, 30 + R() * 40, 30 + R() * 40); }
  const img = ctx.getImageData(0, 0, S, S), d = img.data;
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) { const i = (y * S + x) * 4, w = ((x + y) % 2 ? 6 : -6) + (R() - .5) * 14; d[i] += w; d[i + 1] += w; d[i + 2] += w; }
  ctx.putImageData(img, 0, 0);
  ctx.fillStyle = 'rgba(40,30,20,.35)'; for (let x = S / 5; x < S; x += S / 5) ctx.fillRect(x, 0, 2, S); // panel seams
  const g = ctx.createLinearGradient(0, 0, 0, S); g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(60,40,20,.35)'); ctx.fillStyle = g; ctx.fillRect(0, 0, S, S); // grime at the foot
  return cvTex(cv, false);
}
/** Tiny repeating detail used to give cloth a weave and metal scratches (grey, centred on mid-grey). */
export function detailTexture(kind, size = 128) {
  const R = mulberry32(kind === 'cloth' ? 71 : 72), n = tileFbm(size, 8, 4, kind === 'cloth' ? 73 : 74);
  const { cv, ctx } = canvasFrom(size, d => {
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const i = y * size + x; let v;
      if (kind === 'cloth') v = 128 + ((x >> 1) + (y >> 1)) % 2 * 18 - 9 + (n[i] - .5) * 60 + (R() - .5) * 16;
      else v = 128 + (n[i] - .5) * 70 + (R() - .5) * 10;
      d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = v; d[i * 4 + 3] = 255;
    }
  });
  if (kind !== 'cloth') { ctx.strokeStyle = 'rgba(220,220,220,.35)'; ctx.lineWidth = .6; for (let k = 0; k < 60; k++) { const x = R() * size, y = R() * size, a = R() * 6.3, l = 3 + R() * 12; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); ctx.stroke(); } }
  return cvTex(cv, true, false);
}
/** Soft foam for ship wakes. */
export function foamTexture() {
  const S = 128, n = tileFbm(S, 8, 4, 81);
  const { cv } = canvasFrom(S, d => {
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const i = y * S + x, u = x / S - .5, v = y / S, edge = Math.max(0, 1 - Math.abs(u) * 2 / (.35 + v * .65)), fade = (1 - v) * edge;
      d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = 255; d[i * 4 + 3] = Math.max(0, Math.min(255, (n[i] * 1.4 - .25) * fade * 255));
    }
  });
  return cvTex(cv, false, false);
}
/** Large soft noise used for drifting clouds and their shadows on the ground. */
export function cloudTexture() { const S = 256, n = tileFbm(S, 4, 6, 91); const { cv } = canvasFrom(S, d => { for (let i = 0; i < S * S; i++) { d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = n[i] * 255; d[i * 4 + 3] = 255; } }); return cvTex(cv, true, false); }
