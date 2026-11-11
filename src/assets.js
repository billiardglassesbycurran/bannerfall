// Loads the photo textures in assets/tex (free CC0 textures from Poly Haven and ambientCG, compressed for phones)
// and paints leafy "branch cards" for trees from the leaf photos. If anything fails to load (e.g. offline),
// the game falls back to its procedurally painted textures.
import * as THREE from 'three';
import { mulberry32 } from './util.js';

const V = window.BF_VERSION || 'dev';
const url = n => `assets/tex/${n}.jpg?v=${V}`;
function loadImage(n) {
  return new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => rej(new Error('Could not load ' + n)); im.src = url(n); });
}
function tex(img, aniso, repeat = true) {
  const t = new THREE.Texture(img); t.needsUpdate = true; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = Math.min(8, aniso);
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}
/** Combine a colour photo and its opacity mask into one canvas with transparency. */
function withAlpha(color, alpha) {
  const w = color.width, h = color.height, cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d'); ctx.drawImage(color, 0, 0);
  const a = document.createElement('canvas'); a.width = w; a.height = h; const actx = a.getContext('2d'); actx.drawImage(alpha, 0, 0, w, h);
  const ci = ctx.getImageData(0, 0, w, h), ai = actx.getImageData(0, 0, w, h);
  for (let i = 0; i < ci.data.length; i += 4) ci.data[i + 3] = ai.data[i];
  ctx.putImageData(ci, 0, 0); return cv;
}
/** Paint one leaf sprite (sub-rectangle of the atlas) with a random darkness, rotated about its stem. */
function stamp(ctx, src, rect, x, y, size, rot, dark, tmp) {
  const [sx, sy, sw, sh] = rect, k = size / Math.max(sw, sh);
  tmp.width = Math.ceil(sw * k); tmp.height = Math.ceil(sh * k);
  const t = tmp.getContext('2d'); t.clearRect(0, 0, tmp.width, tmp.height); t.drawImage(src, sx, sy, sw, sh, 0, 0, tmp.width, tmp.height);
  if (dark > 0) { t.globalCompositeOperation = 'source-atop'; t.fillStyle = `rgba(10,24,6,${dark})`; t.fillRect(0, 0, tmp.width, tmp.height); t.globalCompositeOperation = 'source-over'; }
  ctx.save(); ctx.translate(x, y); ctx.rotate(rot); ctx.drawImage(tmp, -tmp.width / 2, -tmp.height); ctx.restore();
}
/** A broadleaf cluster: oak leaves fanning out from a twig at the bottom centre. */
function oakCard(atlas) {
  const S = 512, cv = document.createElement('canvas'); cv.width = cv.height = S;
  const ctx = cv.getContext('2d'), tmp = document.createElement('canvas'), r = mulberry32(17);
  const rects = []; for (let row = 0; row < 2; row++) for (let col = 0; col < 3; col++) rects.push([col * 341 + 10, row * 512 + 20, 320, 470]);
  ctx.strokeStyle = '#4a3a24'; ctx.lineWidth = 5; ctx.beginPath(); ctx.moveTo(S / 2, S); ctx.quadraticCurveTo(S * .48, S * .6, S * .52, S * .25); ctx.stroke();
  for (let i = 0; i < 46; i++) {
    const t = r(), along = .15 + t * .8, side = r() < .5 ? -1 : 1;
    const x = S / 2 + side * (20 + r() * 150) * (1 - t * .5), y = S * (1 - along) + (r() - .5) * 60;
    stamp(ctx, atlas, rects[(r() * 6) | 0], x, y + 40, 95 + r() * 70, side * (.4 + r() * 1.0) + (r() - .5) * .4, r() * .45, tmp);
  }
  return cv;
}
/** A conifer branch: overlapping fir sprigs pointing outward (to the right). */
function firCard(atlas) {
  const W = 512, H = 256, cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d'), tmp = document.createElement('canvas'), r = mulberry32(23);
  const rects = [[280, 60, 460, 220], [70, 310, 860, 320], [30, 650, 940, 350]];
  for (let i = 0; i < 7; i++) {
    const rc = rects[1 + (r() * 2 | 0)], len = 300 + r() * 200;
    ctx.save(); ctx.translate(20 + r() * 60, H / 2 + (r() - .5) * 70); ctx.rotate((r() - .5) * .5);
    const k = len / rc[2]; tmp.width = Math.ceil(rc[2] * k); tmp.height = Math.ceil(rc[3] * k);
    const t = tmp.getContext('2d'); t.clearRect(0, 0, tmp.width, tmp.height); t.drawImage(atlas, rc[0], rc[1], rc[2], rc[3], 0, 0, tmp.width, tmp.height);
    const dark = r() * .5; if (dark) { t.globalCompositeOperation = 'source-atop'; t.fillStyle = `rgba(6,18,8,${dark})`; t.fillRect(0, 0, tmp.width, tmp.height); t.globalCompositeOperation = 'source-over'; }
    ctx.drawImage(tmp, 0, -tmp.height / 2); ctx.restore();
  }
  return cv;
}

export const A = { ok: false };
export async function loadAssets(aniso) {
  try {
    const names = ['aerial_grass_rock', 'stony_dirt_path', 'aerial_rocks_02', 'coast_sand_01', 'bark_brown_02', 'castle_wall_slates', 'clay_plaster', 'clay_roof_tiles', 'reed_roof_04',
      'LeafSet016_color', 'LeafSet016_alpha', 'LeafSet019_color', 'LeafSet019_alpha'];
    const im = Object.fromEntries(await Promise.all(names.map(async n => [n, await loadImage(n)])));
    Object.assign(A, {
      grass: tex(im.aerial_grass_rock, aniso), dirt: tex(im.stony_dirt_path, aniso), rock: tex(im.aerial_rocks_02, aniso), sand: tex(im.coast_sand_01, aniso),
      bark: tex(im.bark_brown_02, aniso), wall: tex(im.castle_wall_slates, aniso), plaster: tex(im.clay_plaster, aniso), tiles: tex(im.clay_roof_tiles, aniso), thatch: tex(im.reed_roof_04, aniso),
    });
    const oakAtlas = withAlpha(im.LeafSet016_color, im.LeafSet016_alpha), firAtlas = withAlpha(im.LeafSet019_color, im.LeafSet019_alpha);
    for (const [k, cv] of [['oakCard', oakCard(oakAtlas)], ['firCard', firCard(firAtlas)]]) { const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = Math.min(4, aniso); A[k] = t; }
    A.ok = true;
  } catch (e) { console.warn('Photo textures unavailable, using painted ones.', e); }
  return A;
}
