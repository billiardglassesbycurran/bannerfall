// Procedurally painted, seamlessly tiling ground textures (no image files to download).
import * as THREE from 'three';
import { mulberry32 } from './util.js';

/** Tileable fractal value noise: returns Float32Array size*size in 0..1. */
function tileFbm(size, basePeriod, octaves, seed) {
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
