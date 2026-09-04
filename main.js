/* CHUDCRAFT — original voxel sandbox.
   Everything here is generated from code: textures, shading (classic
   per-face brightness table), world, UI. Fan-made, no assets from any
   commercial game, not affiliated with Mojang/Minecraft. */
import * as THREE from "./vendor/three.module.js";
import { buildAtlas, tileCanvas, tileIndex, TILE, ATLAS } from "./textures.js";

/* ============================ constants ============================ */
const CH = 16;          // chunk size (x/z)
const H = 56;           // world height
const R = 3;            // loaded chunk radius

const AIR = 0, GRASS = 1, DIRT = 2, STONE = 3, SAND = 4,
      LOG = 5, PLANKS = 6, LEAVES = 7, COBBLE = 8, BEDROCK = 9;

// face order: +y, -y, +x, -x, +z, -z
const FACE_DIRS = [[0, 1, 0], [0, -1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]];
// classic flat shading multipliers (top bright … bottom dark)
const FACE_LIGHT = [1.0, 0.5, 0.6, 0.6, 0.8, 0.8];
// quad corners per face, local offsets, CCW seen from outside
const QUAD_CORNERS = [
  [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]],   // +y
  [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]],   // -y
  [[1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1]],   // +x
  [[0, 0, 1], [0, 1, 1], [0, 1, 0], [0, 0, 0]],   // -x
  [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]],   // +z
  [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]],   // -z
];

const T = tileIndex;
const BLOCKS = [
  null,
  { n: "grass",  top: T.grass_top, bot: T.dirt,     side: T.grass_side },
  { n: "dirt",   top: T.dirt,      bot: T.dirt,     side: T.dirt },
  { n: "stone",  top: T.stone,     bot: T.stone,    side: T.stone },
  { n: "sand",   top: T.sand,      bot: T.sand,     side: T.sand },
  { n: "log",    top: T.wood_top,  bot: T.wood_top, side: T.wood_side },
  { n: "planks", top: T.planks,    bot: T.planks,   side: T.planks },
  { n: "leaves", top: T.leaves,    bot: T.leaves,   side: T.leaves },
  { n: "cobble", top: T.cobble,    bot: T.cobble,   side: T.cobble },
  { n: "bedrock", top: T.bedrock,  bot: T.bedrock,  side: T.bedrock },
];
const HOTBAR = [GRASS, PLANKS, STONE, SAND, LOG, COBBLE, LEAVES];
const REACH = 5.5;

/* ============================ renderer ============================ */
const scene = new THREE.Scene();
const SKY = 0x9fd9ff;
scene.background = new THREE.Color(SKY);
scene.fog = new THREE.Fog(SKY, 40, 130);

const camera = new THREE.PerspectiveCamera(75, innerWidth / innerHeight, 0.1, 400);
camera.rotation.order = "YXZ";

const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true, alpha: false });
renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.domElement.id = "gl";
document.getElementById("game").appendChild(renderer.domElement);

const atlasTex = new THREE.CanvasTexture(buildAtlas());
atlasTex.magFilter = THREE.NearestFilter;
atlasTex.minFilter = THREE.NearestFilter;
atlasTex.generateMipmaps = false;
atlasTex.colorSpace = THREE.SRGBColorSpace;

const chunkMat = new THREE.MeshBasicMaterial({
  map: atlasTex, vertexColors: true, side: THREE.DoubleSide,
});

addEventListener("resize", () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

/* ============================ world ============================ */
const chunks = new Map();
const key = (cx, cz) => cx + "," + cz;
const idx = (x, y, z) => (y * CH + z) * CH + x;
const chunkOf = (gx) => Math.floor(gx / CH);

function ensureChunk(cx, cz) {
  const k = key(cx, cz);
  let c = chunks.get(k);
  if (!c) { c = { cx, cz, data: new Uint8Array(CH * H * CH), mesh: null, meshed: false }; chunks.set(k, c); }
  return c;
}

/* --- terrain --- */
const SEED = (Math.random() * 1e9) | 0;
function hash2(x, z) {
  const s = Math.sin(x * 127.1 + z * 311.7 + SEED * 74.7) * 43758.5453;
  return s - Math.floor(s);
}
const smooth = (t) => t * t * (3 - 2 * t);
function noise2(x, z) {
  const x0 = Math.floor(x), z0 = Math.floor(z);
  const tx = smooth(x - x0), tz = smooth(z - z0);
  const a = hash2(x0, z0), b = hash2(x0 + 1, z0), c = hash2(x0, z0 + 1), d = hash2(x0 + 1, z0 + 1);
  return a + (b - a) * tx + (c - a) * tz + (a - b - c + d) * tx * tz;
}
function terrainH(gx, gz) {
  const n1 = noise2(gx * 0.045, gz * 0.045);
  const n2 = noise2(gx * 0.13 + 40, gz * 0.13 + 40);
  let h = 28 + (n1 - 0.5) * 22 + (n2 - 0.5) * 8;
  return Math.max(14, Math.min(46, Math.round(h)));
}

function solidAt(gx, gy, gz) {
  if (gy < 0) return true;
  if (gy >= H) return false;
  const c = chunks.get(key(chunkOf(gx), chunkOf(gz)));
  if (!c) return true;                 // unloaded: treat as solid
  return c.data[idx(gx - c.cx * CH, gy, gz - c.cz * CH)] !== AIR;
}
function worldGet(gx, gy, gz) {
  if (gy < 0) return BEDROCK;
  if (gy >= H) return AIR;
  const c = chunks.get(key(chunkOf(gx), chunkOf(gz)));
  if (!c) return BEDROCK;
  return c.data[idx(gx - c.cx * CH, gy, gz - c.cz * CH)];
}
function worldSet(gx, gy, gz, id) {
  if (gy < 1 || gy >= H) return;
  const cx = chunkOf(gx), cz = chunkOf(gz);
  const c = chunks.get(key(cx, cz));
  if (!c) return;
  c.data[idx(gx - cx * CH, gy, gz - cz * CH)] = id;
}

function genChunk(c) {
  const d = c.data;
  for (let x = 0; x < CH; x++) {
    for (let z = 0; z < CH; z++) {
      const gx = c.cx * CH + x, gz = c.cz * CH + z;
      const h = terrainH(gx, gz);
      const top = h <= 25 ? SAND : GRASS;
      for (let y = 0; y < H; y++) {
        if (y === 0) d[idx(x, y, z)] = BEDROCK;
        else if (y < h - 3) d[idx(x, y, z)] = STONE;
        else if (y < h) d[idx(x, y, z)] = top === SAND && y === h - 1 ? SAND : DIRT;
        else if (y === h) d[idx(x, y, z)] = top;
      }
    }
  }
  for (let x = 0; x < CH; x++) {
    for (let z = 0; z < CH; z++) {
      const gx = c.cx * CH + x, gz = c.cz * CH + z;
      const h = terrainH(gx, gz);
      if (worldGet(gx, h, gz) !== GRASS) continue;
      const r = hash2(gx * 3.1, gz * 1.7 + 9);
      if (r > 0.006) continue;
      const th = 4 + ((hash2(gx, gz * 2.3) * 3) | 0);
      for (let t = 1; t <= th; t++) worldSet(gx, h + t, gz, LOG);
      const topY = h + th;
      for (let dy = -2; dy <= 0; dy++) {
        const rad = dy === -2 ? 1 : 2;
        for (let dx = -rad; dx <= rad; dx++) for (let dz = -rad; dz <= rad; dz++) {
          if (dy === 0 && dx === 0 && dz === 0) continue;
          if (dx * dx + dz * dz > rad * rad + 1) continue;
          if (dx * dx + dz * dz > rad * rad && (Math.abs(dx) === 2 || Math.abs(dz) === 2)) continue;
          worldSet(gx + dx, topY + dy, gz + dz, LEAVES);
        }
      }
      worldSet(gx, topY + 1, gz, LEAVES);
    }
  }
}

/* --- meshing --- */
function meshChunk(c) {
  const d = c.data;
  const pos = [], uv = [], col = [], ind = [];
  const eps = 0.5 / ATLAS;
  for (let y = 0; y < H; y++) {
    for (let z = 0; z < CH; z++) {
      for (let x = 0; x < CH; x++) {
        const b = d[idx(x, y, z)];
        if (b === AIR) continue;
        const gx = c.cx * CH + x, gz = c.cz * CH + z;
        const blk = BLOCKS[b];
        for (let f = 0; f < 6; f++) {
          const dir = FACE_DIRS[f];
          if (solidAt(gx + dir[0], y + dir[1], gz + dir[2])) continue;
          const tile = f === 0 ? blk.top : f === 1 ? blk.bot : blk.side;
          const tcol = tile % 4, trow = (tile / 4) | 0;
          const u0 = (tcol * TILE + eps) / ATLAS, u1 = ((tcol + 1) * TILE - eps) / ATLAS;
          const v0 = (trow * TILE + eps) / ATLAS, v1 = ((trow + 1) * TILE - eps) / ATLAS;
          const uvQ =
            f === 2 ? [[u0, v0], [u0, v1], [u1, v1], [u1, v0]]
            : f === 3 ? [[u1, v0], [u1, v1], [u0, v1], [u0, v0]]
            : f === 4 ? [[u0, v0], [u1, v0], [u1, v1], [u0, v1]]
            : f === 5 ? [[u1, v0], [u0, v0], [u0, v1], [u1, v1]]
            : [[u0, v0], [u1, v0], [u1, v1], [u0, v1]];
          const lt = FACE_LIGHT[f];          // 0..1 (classic per-face brightness)
          const base = pos.length / 3;
          const q = QUAD_CORNERS[f];
          for (let v = 0; v < 4; v++) {
            pos.push(x + q[v][0], y + q[v][1], z + q[v][2]);   // LOCAL coords; mesh.position offsets the chunk
            uv.push(uvQ[v][0], uvQ[v][1]);
            col.push(lt, lt, lt);
          }
          ind.push(base, base + 1, base + 2, base, base + 2, base + 3);
        }
      }
    }
  }
  if (!ind.length) return null;
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(ind);
  const m = new THREE.Mesh(g, chunkMat);
  m.matrixAutoUpdate = false;
  m.position.set(c.cx * CH, 0, c.cz * CH);
  m.updateMatrix();
  return m;
}

function remesh(c) {
  if (c.mesh) { scene.remove(c.mesh); c.mesh.geometry.dispose(); c.mesh = null; }
  c.mesh = meshChunk(c);
  if (c.mesh) scene.add(c.mesh);
  c.meshed = true;
}

function updateChunks() {
  const pcx = chunkOf(player.pos.x), pcz = chunkOf(player.pos.z);
  for (const c of [...chunks.values()]) {
    if (Math.abs(c.cx - pcx) > R + 1 || Math.abs(c.cz - pcz) > R + 1) {
      if (c.mesh) { scene.remove(c.mesh); c.mesh.geometry.dispose(); }
      chunks.delete(key(c.cx, c.cz));
    }
  }
  // phase 1: make sure data exists for everything in radius (needed for correct edge culling)
  const need = [];
  for (let dx = -R; dx <= R; dx++) for (let dz = -R; dz <= R; dz++) {
    const cx = pcx + dx, cz = pcz + dz;
    const k = key(cx, cz);
    if (!chunks.has(k)) { const c = ensureChunk(cx, cz); genChunk(c); need.push(c); }
  }
  // phase 2: mesh anything new (all neighbours now present)
  for (const c of need) remesh(c);
}

function setBlock(gx, gy, gz, id) {
  if (gy < 1 || gy >= H) return;
  const cx = chunkOf(gx), cz = chunkOf(gz);
  const c = chunks.get(key(cx, cz));
  if (!c) return;
  c.data[idx(gx - cx * CH, gy, gz - cz * CH)] = id;
  remesh(c);
  const lx = gx - cx * CH, lz = gz - cz * CH;
  if (lx === 0) { const n = chunks.get(key(cx - 1, cz)); if (n && n.meshed) remesh(n); }
  if (lx === CH - 1) { const n = chunks.get(key(cx + 1, cz)); if (n && n.meshed) remesh(n); }
  if (lz === 0) { const n = chunks.get(key(cx, cz - 1)); if (n && n.meshed) remesh(n); }
  if (lz === CH - 1) { const n = chunks.get(key(cx, cz + 1)); if (n && n.meshed) remesh(n); }
}

/* ============================ player ============================ */
const player = {
  pos: new THREE.Vector3(8, 40, 8), vel: new THREE.Vector3(),
  yaw: 0, pitch: -0.1, onGround: false, fly: false,
};
const keys = new Set();
const HALF = 0.3, EYE = 1.62;

function spawn() {
  player.pos.set(8.5, terrainH(8, 8) + 3, 8.5);
  player.vel.set(0, 0, 0);
}

function cellSolid(x, y, z) {
  if (y < 0) return true;
  if (y >= H) return false;
  const cx = chunkOf(x), cz = chunkOf(z);
  const c = chunks.get(key(cx, cz));
  if (!c) return false;
  return c.data[idx(x - cx * CH, y, z - cz * CH)] !== AIR;
}

function collideAxis(axis, delta) {
  const p = player.pos;
  p[axis] += delta;
  const minX = Math.floor(p.x - HALF), maxX = Math.floor(p.x + HALF);
  const minY = Math.floor(p.y), maxY = Math.floor(p.y + 1.8);
  const minZ = Math.floor(p.z - HALF), maxZ = Math.floor(p.z + HALF);
  let hit = false;
  for (let y = minY; y <= maxY && !hit; y++)
    for (let z = minZ; z <= maxZ && !hit; z++)
      for (let x = minX; x <= maxX && !hit; x++) {
        if (!cellSolid(x, y, z)) continue;
        if (axis === "x") p.x = delta > 0 ? x - HALF - 0.001 : x + 1 + HALF + 0.001;
        else if (axis === "z") p.z = delta > 0 ? z - HALF - 0.001 : z + 1 + HALF + 0.001;
        else if (delta > 0) p.y = y - 1.8 - 0.001;
        else { p.y = y + 1 + 0.001; player.onGround = true; }
        player.vel[axis] = 0;
        hit = true;
      }
}

function phys(dt) {
  const p = player;
  const fwd = (keys.has("KeyW") ? 1 : 0) - (keys.has("KeyS") ? 1 : 0);
  const str = (keys.has("KeyD") ? 1 : 0) - (keys.has("KeyA") ? 1 : 0);
  const sin = Math.sin(p.yaw), cos = Math.cos(p.yaw);
  let mx = -sin * fwd + cos * str, mz = -cos * fwd - sin * str;
  const ml = Math.hypot(mx, mz) || 1;
  const spd = p.fly ? 10 : 4.6;
  mx = (mx / ml) * spd; mz = (mz / ml) * spd;

  if (p.fly) {
    p.vel.x = mx; p.vel.z = mz;
    p.vel.y = (keys.has("Space") ? 1 : 0) * spd * 0.9 - ((keys.has("ShiftLeft") || keys.has("ControlLeft")) ? 1 : 0) * spd * 0.9;
    collideAxis("x", p.vel.x * dt);
    collideAxis("y", p.vel.y * dt);
    collideAxis("z", p.vel.z * dt);
    p.onGround = false;
    return;
  }
  p.onGround = false;
  p.vel.x = mx; p.vel.z = mz;
  p.vel.y -= 28 * dt;
  if (keys.has("Space") && p.onGround) p.vel.y = 9.2;
  collideAxis("x", p.vel.x * dt);
  collideAxis("y", p.vel.y * dt);
  collideAxis("z", p.vel.z * dt);
}

/* ============================ picking ============================ */
function pickBlock() {
  const o = camera.position, d = new THREE.Vector3();
  camera.getWorldDirection(d);
  let x = Math.floor(o.x), y = Math.floor(o.y), z = Math.floor(o.z);
  const stepX = d.x > 0 ? 1 : -1, stepY = d.y > 0 ? 1 : -1, stepZ = d.z > 0 ? 1 : -1;
  const tDX = Math.abs(1 / (d.x || 1e-9)), tDY = Math.abs(1 / (d.y || 1e-9)), tDZ = Math.abs(1 / (d.z || 1e-9));
  let tMX = d.x > 0 ? (x + 1 - o.x) * tDX : (o.x - x) * tDX;
  let tMY = d.y > 0 ? (y + 1 - o.y) * tDY : (o.y - y) * tDY;
  let tMZ = d.z > 0 ? (z + 1 - o.z) * tDZ : (o.z - z) * tDZ;
  let face = 0, t = 0;
  for (let i = 0; i < 200; i++) {
    const solid = (y >= 0 && y < H) ? cellSolid(x, y, z) : y < 0;
    if (solid && t <= REACH) return { x, y, z, face };
    if (tMX < tMY && tMX < tMZ) { x += stepX; t = tMX; tMX += tDX; face = d.x > 0 ? 2 : 3; }
    else if (tMY < tMZ) { y += stepY; t = tMY; tMY += tDY; face = d.y > 0 ? 0 : 1; }
    else { z += stepZ; t = tMZ; tMZ += tDZ; face = d.z > 0 ? 4 : 5; }
    if (t > REACH) return null;
  }
  return null;
}

function boxOverlaps(bx, by, bz) {
  const p = player.pos;
  return !(bx + 1 <= p.x - HALF || bx >= p.x + HALF ||
           bz + 1 <= p.z - HALF || bz >= p.z + HALF ||
           by + 1 <= p.y || by >= p.y + 1.8);
}

/* ============================ audio ============================ */
let AC = null;
function ac() {
  if (!AC) AC = new (window.AudioContext || window.webkitAudioContext)();
  if (AC.state === "suspended") AC.resume();
  return AC;
}
function tone(f0, f1, dur, type = "triangle", vol = 0.25) {
  const c = ac(), t0 = c.currentTime;
  const o = c.createOscillator(), g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f0, t0);
  o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t0 + dur);
  g.gain.setValueAtTime(vol, t0);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  o.connect(g); g.connect(c.destination);
  o.start(t0); o.stop(t0 + dur + 0.02);
}
const sndPlace = () => tone(140, 60, 0.12, "triangle", 0.3);
const sndBreak = () => tone(400, 120, 0.1, "square", 0.1);
const sndSelect = () => tone(660, 660, 0.05, "square", 0.08);

/* ============================ input & UI ============================ */
const ui = {
  menu: document.getElementById("menu"), pause: document.getElementById("pause"),
  hotbar: document.getElementById("hotbar"), msg: document.getElementById("msg"),
  seed: document.getElementById("seed"), status: document.getElementById("status"),
};
let started = false, selected = 0, msgTimer = 0, dragMode = false;
const gl = renderer.domElement;

function toast(text, ms = 1800) {
  ui.msg.textContent = text;
  clearTimeout(msgTimer);
  msgTimer = setTimeout(() => (ui.msg.textContent = ""), ms);
}

function buildHotbar() {
  HOTBAR.forEach((id, i) => {
    const slot = document.createElement("button");
    slot.className = "slot" + (i === selected ? " on" : "");
    slot.title = BLOCKS[id].n;
    const cv = document.createElement("canvas");
    cv.width = 32; cv.height = 32;
    const g = cv.getContext("2d");
    g.imageSmoothingEnabled = false;
    g.drawImage(tileCanvas(BLOCKS[id].side), 0, 0, 32, 32);
    slot.appendChild(cv);
    slot.addEventListener("pointerdown", (e) => { e.preventDefault(); select(i); });
    ui.hotbar.appendChild(slot);
  });
}
function select(i) {
  selected = i;
  [...ui.hotbar.children].forEach((s, j) => s.classList.toggle("on", j === i));
  if (started) sndSelect();
}

function isLocked() { return document.pointerLockElement === gl; }
function requestLock() {
  if (isLocked() || IS_TOUCH) return;
  try {
    const pr = gl.requestPointerLock();
    if (pr && pr.catch) pr.catch(() => fallbackMode());
  } catch (e) { fallbackMode(); }
}
function fallbackMode() {
  // sandboxed iframe may block pointer lock → drag to look (desktop only)
  if (IS_TOUCH) return;
  dragMode = true;
  ui.status.textContent = "drag to look";
  ui.pause.classList.add("hidden");
}

function syncPause() {
  if (!started) return;
  if (dragMode) { ui.pause.classList.add("hidden"); return; }
  ui.pause.classList.toggle("hidden", isLocked());
}

ui.menu.querySelector("button").addEventListener("pointerdown", (e) => {
  e.preventDefault();
  ac(); started = true;
  ui.menu.classList.add("hidden");
  spawn();
  updateChunks();
  requestLock();
  if (!isLocked() && !dragMode) setTimeout(() => { if (!isLocked()) fallbackMode(); }, 300);
  ui.pause.classList.add("hidden");
  camera.rotation.set(player.pitch, player.yaw, 0);
  toast("left click: mine · right click: place · F: fly · 1-7: blocks");
});
ui.pause.addEventListener("pointerdown", (e) => { e.preventDefault(); requestLock(); });
gl.addEventListener("click", () => { if (started && !IS_TOUCH) requestLock(); });

document.addEventListener("pointerlockchange", syncPause);
document.addEventListener("pointerlockerror", fallbackMode);

document.addEventListener("mousemove", (e) => {
  if (!started) return;
  if (isLocked()) {
    player.yaw -= e.movementX * 0.0023;
    player.pitch -= e.movementY * 0.0023;
  } else if (dragMode && (e.buttons & 1)) {
    player.yaw -= e.movementX * 0.0042;
    player.pitch -= e.movementY * 0.0042;
  }
  player.pitch = Math.max(-1.55, Math.min(1.55, player.pitch));
});

/* click handling (works locked or in drag mode) */
gl.addEventListener("contextmenu", (e) => e.preventDefault());
let downX = 0, downY = 0;
gl.addEventListener("pointerdown", (e) => {
  if (!started) return;
  if (!isLocked() && !dragMode) return;
  downX = e.clientX; downY = e.clientY;
});
gl.addEventListener("pointerup", (e) => {
  if (!started) return;
  if (isLocked()) {
    if (e.button === 0) doBreak();
    else if (e.button === 2) doPlace();
    return;
  }
  if (!dragMode) return;
  const moved = Math.hypot(e.clientX - downX, e.clientY - downY);
  if (e.button === 0 && moved < 6) doBreak();
  else if (e.button === 2 && moved < 6) doPlace();
});
function doBreak() {
  const hit = pickBlock();
  if (hit && hit.y > 0) { setBlock(hit.x, hit.y, hit.z, AIR); sndBreak(); }
}
function doPlace() {
  const hit = pickBlock();
  if (!hit) return;
  const fd = FACE_DIRS[hit.face];
  const tx = hit.x + fd[0], ty = hit.y + fd[1], tz = hit.z + fd[2];
  if (ty < 1 || ty >= H) return;
  if (cellSolid(tx, ty, tz)) return;
  if (boxOverlaps(tx, ty, tz)) return;
  setBlock(tx, ty, tz, HOTBAR[selected]);
  sndPlace();
}

addEventListener("keydown", (e) => {
  if (e.code === "Space") e.preventDefault();
  keys.add(e.code);
  if (e.code === "KeyF" && started) {
    player.fly = !player.fly;
    toast(player.fly ? "flying ✈ (space up / shift down)" : "gravity restored");
  }
  if (e.code.startsWith("Digit") && started) {
    const n = +e.code.slice(5);
    if (n >= 1 && n <= HOTBAR.length) select(n - 1);
  }
});
addEventListener("keyup", (e) => keys.delete(e.code));
addEventListener("blur", () => keys.clear());
addEventListener("wheel", (e) => {
  if (!started) return;
  e.preventDefault();
  select((selected + (e.deltaY > 0 ? 1 : HOTBAR.length - 1)) % HOTBAR.length);
}, { passive: false });

/* ============================ mobile controls ============================ */
const IS_TOUCH = (("ontouchstart" in window) || navigator.maxTouchPoints > 0) && !window.matchMedia("(pointer: fine)").matches;
const joy = { x: 0, y: 0, active: false, id: -1 };
let touchLookOn = false, touchLookX = 0, touchLookY = 0, touchLookId = -1;
let mineMode = true;
const ui2 = {
  wrap: document.getElementById("touchUI"),
  look: document.getElementById("lookZone"),
  joy: document.getElementById("joyZone"),
  knob: document.getElementById("joyKnob"),
  tap: document.getElementById("tapZone"),
  mode: document.getElementById("btnMode"),
  fly: document.getElementById("btnFly"),
  jump: document.getElementById("btnJump"),
};

function setVKey(code, on) { on ? keys.add(code) : keys.delete(code); }
function clampJoy() {
  const dx = joy.x, dy = joy.y;
  const m = Math.hypot(dx, dy);
  const r = 0.75;
  const nx = m > r ? dx / m * r : dx, ny = m > r ? dy / m * r : dy;
  joy.x = nx; joy.y = ny;
  // map joystick to virtual WASD: up (neg y) = forward
  setVKey("KeyW", ny < -0.38);
  setVKey("KeyS", ny > 0.38);
  setVKey("KeyA", nx < -0.38);
  setVKey("KeyD", nx > 0.38);
  ui2.knob.style.transform = `translate(${nx * 40}px, ${ny * 40}px)`;
}

function bindMobile() {
  ui2.wrap.classList.remove("hidden");
  ui.status.textContent = "stick: move · drag right: look";
  ui2.joy.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    joy.active = true; joy.id = e.pointerId;
    ui2.joy.setPointerCapture(e.pointerId);
    joy.x = 0; joy.y = 0; clampJoy();
  });
  ui2.joy.addEventListener("pointermove", (e) => {
    if (!joy.active || e.pointerId !== joy.id) return;
    const rect = ui2.joy.getBoundingClientRect();
    joy.x = (e.clientX - (rect.left + rect.width / 2)) / (rect.width / 2);
    joy.y = (e.clientY - (rect.top + rect.height / 2)) / (rect.height / 2);
    clampJoy();
  });
  const joyEnd = (e) => {
    if (e.pointerId !== joy.id) return;
    joy.active = false; joy.id = -1; joy.x = 0; joy.y = 0;
    setVKey("KeyW", false); setVKey("KeyS", false);
    setVKey("KeyA", false); setVKey("KeyD", false);
    ui2.knob.style.transform = "translate(0,0)";
  };
  ui2.joy.addEventListener("pointerup", joyEnd);
  ui2.joy.addEventListener("pointercancel", joyEnd);

  // look: drag on the right half
  ui2.look.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    touchLookOn = true; touchLookId = e.pointerId;
    touchLookX = e.clientX; touchLookY = e.clientY;
  });
  ui2.look.addEventListener("pointermove", (e) => {
    if (!touchLookOn || e.pointerId !== touchLookId) return;
    const dx = e.clientX - touchLookX, dy = e.clientY - touchLookY;
    touchLookX = e.clientX; touchLookY = e.clientY;
    player.yaw -= dx * 0.0046;
    player.pitch -= dy * 0.0046;
    player.pitch = Math.max(-1.55, Math.min(1.55, player.pitch));
  });
  const lookEnd = (e) => { if (e.pointerId === touchLookId) touchLookOn = false; };
  ui2.look.addEventListener("pointerup", lookEnd);
  ui2.look.addEventListener("pointercancel", lookEnd);

  // tap centre = mine / place
  ui2.tap.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    e.stopPropagation();
    touchLookId = -1; touchLookOn = false;   // never also look-drag
    tapX = e.clientX; tapY = e.clientY;
  });
  ui2.tap.addEventListener("pointerup", (e) => {
    if (Math.hypot(e.clientX - tapX, e.clientY - tapY) > 12) return;
    if (mineMode) doBreak(); else doPlace();
  });

  ui2.mode.addEventListener("pointerdown", (e) => {
    e.preventDefault(); e.stopPropagation();
    mineMode = !mineMode;
    ui2.mode.textContent = mineMode ? "⛏" : "🧱";
    ui2.mode.classList.toggle("on", !mineMode);
    toast(mineMode ? "mode: mine (tap centre)" : "mode: place (tap centre)");
  });
  ui2.fly.addEventListener("pointerdown", (e) => {
    e.preventDefault(); e.stopPropagation();
    player.fly = !player.fly;
    ui2.fly.classList.toggle("on", player.fly);
    toast(player.fly ? "flying ✈ (▲ = up)" : "gravity restored");
  });
  ui2.jump.addEventListener("pointerdown", (e) => {
    e.preventDefault(); e.stopPropagation();
    setVKey("Space", true);
    if (player.fly) toast("▲ flies up");
  });
  ui2.jump.addEventListener("pointerup", () => setVKey("Space", false));
  ui2.jump.addEventListener("pointercancel", () => setVKey("Space", false));
}
let tapX = 0, tapY = 0;
if (IS_TOUCH) bindMobile();

/* ============================ loop ============================ */
const clock = new THREE.Clock();
function frame() {
  requestAnimationFrame(frame);
  const dt = Math.min(clock.getDelta(), 0.05);
  if (started) {
    phys(dt);
    updateChunks();
    camera.position.set(player.pos.x, player.pos.y + EYE, player.pos.z);
    camera.rotation.set(player.pitch, player.yaw, 0);
  }
  renderer.render(scene, camera);
}

document.getElementById("menuSeed").textContent = "world seed " + SEED;
ui.seed.textContent = "seed " + SEED;
buildHotbar();
spawn();
updateChunks();
frame();

// debug/test handle
window.__chud = {
  player,
  chunks: () => chunks.size,
  blockAt: (x, y, z) => worldGet(x, y, z),
  seed: SEED,
  triangles: () => renderer.info.render.triangles,
  calls: () => renderer.info.render.calls,
  mat: chunkMat,
  atlasTex,
};
