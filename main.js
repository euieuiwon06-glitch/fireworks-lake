// 불꽃 호수 — 좌클릭(터치)한 곳에 폭죽. 폭죽은 산 뒤에서 솟아올라 하늘에서 피고, 호수에 비친다.
// 모든 그림은 280×350 픽셀 격자(원본 4px = 1칸)에 찍고 CSS로 확대(pixelated).

const CONFIG = {
  reflectK: 0.5,        // 물 반사 세로 압축(하늘 높이 × K 만큼 아래로)
  reflectSat: 0.8,      // 반사 채도 배율(바탕 그림과 같음)
  reflectPinkSat: 0.96, // 분홍 반사 채도(0.8 × 1.2)
  reflectDim: 0.85,     // 반사 밝기 배율(딤)
  minAboveRidge: 14,    // 산·구름 선보다 최소 이만큼 위에서 터짐(칸)
  rocketTime: [0.85, 1.15],
  maxParticles: 12000,
  followChance: 0.45,   // 큰 폭죽 뒤 주변에 작은 폭죽이 연달아 터질 확률
  glowTime: 0.22,       // 터질 때 주변 하늘이 밝아지는 시간(초)
  flowSpeed: [3, 10],   // 떨림 토막이 왼쪽으로 흐르는 속도(칸/초): 물가 → 화면 아래
  jitterRate: 4,        // 토막마다 떨림이 바뀌는 횟수(초당)
  glint: 0.04,          // 밝은 물 칸이 반짝일 확률(프레임당 1/8초 단위)
};
const SKY_TOP = '#101738', SKY_LOW = '#142568', SKY_GLOW = '#1f2a59';
const GLINT = '#f3e8da';

// 원본 그림 팔레트(어두움 → 밝음)
const PAL = {
  pink:  ['#6e4d6c', '#a06482', '#e1738b', '#faa0b0', '#f3e8da'],
  cream: ['#403456', '#7c7abb', '#e4d0d4', '#f3e8da'],
};
const PINKISH = new Set(['#6e4d6c', '#a06482', '#e1738b', '#faa0b0']);

const cvs = document.getElementById('c');
const ctx = cvs.getContext('2d');
const W = 280, H = 350;

let base, baseLum, visible, meta, waterY, skyline;
const frame = ctx.createImageData(W, H);
const buf32 = new Uint32Array(frame.data.buffer);
const fw = new Uint32Array(W * H);      // 이번 프레임 폭죽 색(0 = 없음)
const fwLv = new Uint8Array(W * H);     // 밝기 단계(밝은 게 이김)

// ---------- 색 ----------
function hexToRgb(h) { return [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16)); }
function pack([r, g, b]) { return (255 << 24) | (b << 16) | (g << 8) | r; }  // little-endian RGBA
function reflectRgb(hex) {
  let [r, g, b] = hexToRgb(hex).map(v => v / 255);
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let h = 0;
  if (d) h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h = (h * 60 + 360) % 360;
  let s = mx ? d / mx : 0, v = mx;
  s *= PINKISH.has(hex) ? CONFIG.reflectPinkSat : CONFIG.reflectSat;
  v *= CONFIG.reflectDim;
  const c = v * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = v - c;
  const [R, G, B] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [R + m, G + m, B + m].map(v => Math.round(v * 255));
}
const COLOR = {}, REFL = {};
const C_TOP = pack(hexToRgb(SKY_TOP)), C_LOW = pack(hexToRgb(SKY_LOW)), C_GLOW = pack(hexToRgb(SKY_GLOW));
const C_GLINT = pack(hexToRgb(GLINT));
for (const p of Object.values(PAL)) for (const h of p) { COLOR[h] = pack(hexToRgb(h)); REFL[pack(hexToRgb(h))] = pack(reflectRgb(h)); }

// ---------- 불러오기 ----------
function loadImg(src) {
  return new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = no; i.src = src; });
}
function pixels(img) {
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const x = c.getContext('2d'); x.drawImage(img, 0, 0);
  return x.getImageData(0, 0, W, H).data;
}

// ---------- 폭죽 ----------
const rockets = [], parts = [], flashes = [], glows = [], sparks = [], later = [];
const rand = (a, b) => a + Math.random() * (b - a);

const TYPES = [
  // 큰 분홍 국화 + 안쪽 크림 층
  { w: 4, n: 150, R: [58, 74], drag: 2.9, g: 9, life: [2.1, 2.7], trail: 80, pal: 'pink', tip: 0.18,
    inner: { k: 0.5, n: 0.45, pal: 'cream' }, crackle: 0.5, big: true },
  // 흰 버들(늘어지는 긴 꼬리) + 끝에서 반짝임
  { w: 3, n: 120, R: [48, 62], drag: 2.3, g: 24, life: [3.0, 3.7], trail: 110, pal: 'cream', tip: 0,
    crackle: 0.9, big: true },
  // 분홍 모란 + 안쪽 분홍 층
  { w: 3, n: 110, R: [40, 50], drag: 3.0, g: 10, life: [1.8, 2.2], trail: 56, pal: 'pink', tip: 0.3,
    inner: { k: 0.45, n: 0.5, pal: 'pink' }, crackle: 0.3, big: true },
  // 작은 분홍·흰(연달아 터지는 용)
  { w: 0, n: 64, R: [20, 28], drag: 3.2, g: 8, life: [1.2, 1.6], trail: 34, pal: 'pink', tip: 0.4, crackle: 0.2 },
];
const SMALL = TYPES[3];
function pickType() {
  const tot = TYPES.reduce((s, t) => s + t.w, 0);
  let r = Math.random() * tot;
  for (const t of TYPES) if ((r -= t.w) < 0) return t;
  return TYPES[0];
}

function launch(tx, ty) {
  const T = rand(...CONFIG.rocketTime);
  rockets.push({ x0: tx + rand(-3, 3), y0: waterY - 1, tx, ty, t: 0, T, trail: [], wob: rand(0, 6) });
}

function ring(x, y, t, R, n, palName, tip, lifeK) {
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + rand(-0.06, 0.06);
    const sp = R * t.drag * rand(0.82, 1.0);
    const pal = tip && Math.random() < tip ? PAL.cream : PAL[palName];
    parts.push({
      x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, drag: t.drag, g: t.g, age: 0, acc: 0,
      life: rand(...t.life) * lifeK, pal, tl: Math.round(t.trail * lifeK), trail: [[x, y]], crackle: t.crackle || 0,
    });
  }
}

function burst(x, y, t = pickType()) {
  const R = rand(...t.R) * rand(0.9, 1.1);
  if (parts.length > CONFIG.maxParticles) parts.splice(0, parts.length - CONFIG.maxParticles);
  ring(x, y, t, R, t.n, t.pal, t.tip, 1);
  if (t.inner) ring(x, y, t, R * t.inner.k, Math.round(t.n * t.inner.n), t.inner.pal, 0, 0.8);
  flashes.push({ x: Math.round(x), y: Math.round(y), age: 0 });
  glows.push({ x, y, r: R * 1.25, age: 0 });
  // 큰 폭죽은 가끔 주변에 작은 폭죽이 연달아
  if (t.big && Math.random() < CONFIG.followChance) {
    const k = 2 + (Math.random() * 3 | 0);
    for (let i = 0; i < k; i++) {
      const a = rand(0, Math.PI * 2), d = R * rand(0.5, 0.95);
      const fx = Math.max(4, Math.min(W - 5, x + Math.cos(a) * d));
      const fy = Math.max(10, Math.min(y + Math.sin(a) * d, skyline[Math.round(fx)] - 6));
      later.push({ at: rand(0.35, 0.9), x: fx, y: fy });
    }
  }
}

// ---------- 그리기 ----------
function put(x, y, hex, lv) {
  x = Math.round(x); y = Math.round(y);
  if (x < 0 || y < 0 || x >= W || y >= waterY) return;
  const i = y * W + x;
  if (!visible[i]) return;              // 산·구름·땅 뒤 = 안 보임
  if (lv >= fwLv[i]) { fw[i] = COLOR[hex]; fwLv[i] = lv + 1; }
}

function line(x0, y0, x1, y1, hex, lv, dot) {
  x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
  const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let e = dx + dy;
  for (;;) {
    if (!dot || ((x0 + y0) & 1) === 0) put(x0, y0, hex, lv);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * e;
    if (e2 >= dy) { e += dy; x0 += sx; }
    if (e2 <= dx) { e += dx; y0 += sy; }
  }
}

function step(dt) {
  for (let k = rockets.length - 1; k >= 0; k--) {
    const r = rockets[k];
    r.t += dt;
    const p = Math.min(1, r.t / r.T), e = 1 - (1 - p) * (1 - p);
    const x = r.x0 + (r.tx - r.x0) * e + Math.sin(r.t * 14 + r.wob) * 0.4;
    const y = r.y0 + (r.ty - r.y0) * e;
    r.trail.push([x, y]); if (r.trail.length > 9) r.trail.shift();
    r.x = x; r.y = y;
    if (p >= 1) { rockets.splice(k, 1); burst(r.tx, r.ty); }
  }
  for (let k = parts.length - 1; k >= 0; k--) {
    const q = parts[k];
    q.age += dt;
    if (q.age >= q.life) { parts.splice(k, 1); continue; }
    const d = Math.exp(-q.drag * dt);
    q.vx *= d; q.vy = q.vy * d + q.g * dt;
    q.x += q.vx * dt; q.y += q.vy * dt;
    q.acc += dt;
    while (q.acc >= 1 / 60) { q.acc -= 1 / 60; q.trail.push([q.x, q.y]); if (q.trail.length > q.tl) q.trail.shift(); }
  }
  for (let k = flashes.length - 1; k >= 0; k--) if ((flashes[k].age += dt) > 0.3) flashes.splice(k, 1);
  for (let k = glows.length - 1; k >= 0; k--) if ((glows[k].age += dt) > CONFIG.glowTime) glows.splice(k, 1);
  for (let k = later.length - 1; k >= 0; k--) if ((later[k].at -= dt) <= 0) { const l = later.splice(k, 1)[0]; burst(l.x, l.y, SMALL); }
  for (let k = sparks.length - 1; k >= 0; k--) if ((sparks[k].age += dt) > sparks[k].life) sparks.splice(k, 1);
  // 꼬리 끝무렵 반짝이는 작은 불티(크래클)
  for (const q of parts) {
    const f = q.age / q.life;
    if (q.crackle && f > 0.5 && Math.random() < q.crackle * dt * 6)
      sparks.push({ x: q.x + rand(-2, 2), y: q.y + rand(-2, 2), age: 0, life: rand(0.12, 0.3) });
  }
}

function drawFireworks() {
  fw.fill(0); fwLv.fill(0);
  for (const r of rockets) {
    const n = r.trail.length;
    for (let i = 1; i < n; i++) {
      const lv = Math.min(3, Math.round((i / (n - 1)) * 3));
      line(r.trail[i - 1][0], r.trail[i - 1][1], r.trail[i][0], r.trail[i][1], PAL.cream[lv], lv);
    }
  }
  for (const q of parts) {
    const f = q.age / q.life, top = q.pal.length - 1;
    const head = Math.max(0, Math.round(top - f * f * top * 1.05));
    // 끝무렵엔 반짝이며 사라짐
    if (f > 0.65 && Math.random() < (f - 0.65) * 2.2) continue;
    const pts = q.trail, n = pts.length;
    for (let i = 1; i < n; i++) {
      const fr = i / n;                                  // 0 꼬리 → 1 머리
      // 꼬리는 시간이 갈수록 어두워짐, 안쪽 절반은 점선(원본 디더 느낌)
      const lv = Math.max(0, Math.round(head * (0.3 + 0.7 * fr) - f * 1.2 * (1 - fr)));
      line(pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1], q.pal[lv], lv, fr < 0.5);
    }
    line(pts[n - 1][0], pts[n - 1][1], q.x, q.y, q.pal[head], head);
    put(q.x, q.y, q.pal[head], head);
  }
  for (const sp of sparks) {
    if (Math.random() < 0.35) continue;            // 깜빡임
    put(sp.x, sp.y, Math.random() < 0.5 ? '#f3e8da' : '#faa0b0', 7);
  }
  for (const f of flashes) {
    const c = '#f3e8da';
    put(f.x, f.y, c, 9);
    if (f.age < 0.12) for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) if (Math.abs(dx) + Math.abs(dy) <= 3) put(f.x + dx, f.y + dy, c, 9);
    if (f.age < 0.06) for (const [dx, dy] of [[4, 0], [-4, 0], [0, 4], [0, -4], [3, 3], [-3, 3], [3, -3], [-3, -3]]) put(f.x + dx, f.y + dy, '#faa0b0', 8);
    if (f.age < 0.18) for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) put(f.x + dx, f.y + dy, c, 9);
    if (f.age < 0.08) for (const [dx, dy] of [[2, 0], [-2, 0], [0, 2], [0, -2], [1, 1], [-1, 1], [1, -1], [-1, -1]]) put(f.x + dx, f.y + dy, '#faa0b0', 8);
  }
}

function hash(a, b) { let h = (a * 374761393 + b * 668265263) | 0; h = (h ^ (h >>> 13)) * 1274126177; return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }

function compose(time) {
  buf32.set(base);
  // 터질 때 주변 하늘이 잠깐 한 톤 밝아짐(무늬 없이 면 색만 바꿈)
  for (const g of glows) {
    const r = g.r * (1 - (g.age / CONFIG.glowTime) * 0.4), r2 = r * r;
    const x0 = Math.max(0, (g.x - r) | 0), x1 = Math.min(W - 1, (g.x + r) | 0);
    const y0 = Math.max(0, (g.y - r) | 0), y1 = Math.min(waterY - 1, (g.y + r) | 0);
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const dx = x - g.x, dy = y - g.y, d2 = dx * dx + dy * dy;
      if (d2 > r2) continue;
      const i = y * W + x, c = base[i];
      if (c === C_TOP) buf32[i] = C_LOW;
      else if (c === C_LOW && d2 < r2 * 0.4) buf32[i] = C_GLOW;
    }
  }
  for (let i = 0; i < W * waterY; i++) if (fw[i]) buf32[i] = fw[i];
  // 물: 새 픽셀 없이 기존 픽셀이 짧은 토막 단위로 좌우(가끔 위아래)로 1~2칸 떨림.
  //     토막 무늬는 천천히 오른쪽→왼쪽으로 흘러감. 밝은 칸(비친 산·불빛)은 가끔 반짝(윤슬).
  //     폭죽 반사도 같은 떨림을 따름.
  const K = CONFIG.reflectK, tick = Math.floor(time * 8);
  const [v0, v1] = CONFIG.flowSpeed;
  for (let y = waterY; y < H; y++) {
    const k = (y - waterY) / (H - waterY);              // 0 물가 → 1 화면 아래
    const L = 4 + ((k * 10) | 0);                       // 토막 길이(가까울수록 김)
    const v = v0 + (v1 - v0) * k;
    const amp = k > 0.45 ? 2 : 1;
    const d = (y - waterY) / K;
    const sy0 = Math.round(waterY - d), sy1 = Math.round(waterY - d - 1 / K + 1);
    for (let x = 0; x < W; x++) {
      const seg = Math.floor((x + v * time) / L);
      const tk = Math.floor(time * CONFIG.jitterRate + hash(seg, y * 7 + 3) * 7);
      const r = hash(seg * 13 + tk, y * 29 + 1);
      const dx = Math.max(-amp, Math.min(amp, Math.round((r - 0.5) * 2.6 * amp)));
      const r2 = hash(seg * 5 + tk, y * 11 + 7);
      const sy = Math.max(waterY, Math.min(H - 1, y + (r2 < 0.07 ? -1 : r2 > 0.93 ? 1 : 0)));
      const sx = Math.max(0, Math.min(W - 1, x + dx));
      const si = sy * W + sx;
      let c = base[si];
      if (baseLum[si] > 140 && hash(x * 3 + tick * 17, y * 31) < CONFIG.glint) c = C_GLINT;
      // 폭죽 반사
      let f = 0;
      for (const ry of [sy0, sy1]) {
        if (ry < 0 || ry >= waterY) continue;
        for (const ex of [0, -1, 1]) {
          const rx = sx + ex;
          if (rx < 0 || rx >= W) continue;
          const vv = fw[ry * W + rx];
          if (vv) { f = vv; break; }
        }
        if (f) break;
      }
      if (f && hash(seg, y * 31 + tick) >= 0.22) c = REFL[f] || f;   // 토막 사이로 끊김
      buf32[y * W + x] = c;
    }
  }
  ctx.putImageData(frame, 0, 0);
}

// ---------- 입력 ----------
function onDown(e) {
  if (e.button !== 0) return;              // 좌클릭(터치 포함)만
  const r = cvs.getBoundingClientRect();
  let x = ((e.clientX - r.left) / r.width) * W;
  let y = ((e.clientY - r.top) / r.height) * H;
  if (y >= waterY) y = waterY - (y - waterY) / CONFIG.reflectK;   // 물을 누르면 비친 하늘 자리
  x = Math.max(8, Math.min(W - 9, x));
  const top = skyline[Math.round(x)] - CONFIG.minAboveRidge;
  y = Math.max(20, Math.min(top, y));
  launch(x, y);
}

// ---------- 시작 ----------
(async function init() {
  const [bImg, fImg, m] = await Promise.all([
    loadImg('assets/base.png?v=20261124f'), loadImg('assets/fg.png?v=20261124f'),
    fetch('assets/meta.json?v=20261124f').then(r => r.json()),
  ]);
  meta = m; waterY = m.waterY; skyline = m.skyline;
  base = new Uint32Array(pixels(bImg).buffer.slice(0));
  const fg = pixels(fImg);
  visible = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) visible[i] = fg[i * 4] < 128 && (i / W | 0) < waterY ? 1 : 0;
  baseLum = new Uint8Array(W * H);
  const bd = new Uint8Array(base.buffer);
  for (let i = 0; i < W * H; i++) baseLum[i] = bd[i * 4] * 0.299 + bd[i * 4 + 1] * 0.587 + bd[i * 4 + 2] * 0.114;
  cvs.addEventListener('pointerdown', onDown);
  cvs.addEventListener('contextmenu', e => e.preventDefault());
  let last = performance.now();
  function loop(now) {
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    step(dt); drawFireworks(); compose(now / 1000);
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);
})();
