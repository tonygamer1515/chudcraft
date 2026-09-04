/* CHUDCRAFT — original voxel sandbox.
   Everything here is generated from code: textures, world, a from-scratch
   light engine (skylight columns + flood-fill propagation + glowing blocks),
   and UI. Fan-made, no assets/code from any commercial game, not affiliated
   with Mojang/Minecraft. */
import * as THREE from "./vendor/three.module.js";
import { buildAtlas, tileCanvas, tileIndex, TILE, ATLAS } from "./textures.js?v=5";

/* ============================ constants ============================ */
const CH = 16;          // chunk size (x/z)
const H = 60;           // world height
const R = 3;            // loaded chunk radius
const WL = 32;          // water level

const AIR = 0, GRASS = 1, DIRT = 2, STONE = 3, SAND = 4,
      LOG = 5, PLANKS = 6, LEAVES = 7, COBBLE = 8, BEDROCK = 9,
      WATER = 10, LAVA = 11, GLOW = 12;

const SOLID = new Set([GRASS, DIRT, STONE, SAND, LOG, PLANKS, COBBLE, BEDROCK, GLOW, LEAVES]);
const LIQUID = new Set([WATER, LAVA]);
const TRANSPARENT_LIGHT = (id) => !SOLID.has(id);   // light passes air/water/lava/leaves

// face order: +y, -y, +x, -x, +z, -z
const FACE_DIRS = [[0, 1, 0], [0, -1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]];
// classic flat-shade multipliers combined with dynamic light
const FACE_LIGHT = [1.0, 0.5, 0.6, 0.6, 0.8, 0.8];
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
  { n: "water",  top: T.water,     bot: T.water,    side: T.water },
  { n: "lava",   top: T.lava,      bot: T.lava,     side: T.lava },
  { n: "glow",   top: T.glow,      bot: T.glow,     side: T.glow },
];
const HOTBAR = [GRASS, PLANKS, STONE, SAND, LOG, COBBLE, LEAVES, GLOW];
const REACH = 5.5;

/* ============================ renderer ============================ */
const scene = new THREE.Scene();
const SKY = 0x9fd9ff;
scene.background = new THREE.Color(SKY);
scene.fog = new THREE.Fog(SKY, 45, 140);

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
const waterMat = new THREE.MeshBasicMaterial({
  map: atlasTex, vertexColors: true, side: THREE.DoubleSide,
  transparent: true, opacity: 0.78, depthWrite: false,
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
const SZ = CH * H * CH;

function ensureChunk(cx, cz) {
  const k = key(cx, cz);
  let c = chunks.get(k);
  if (!c) {
    c = { cx, cz, data: new Uint8Array(SZ), light: new Uint8Array(SZ),
          mesh: null, liqMesh: null, meshed: false };
    chunks.set(k, c);
  }
  return c;
}

/* --- noise (all original) --- */
const SEED = (Math.random() * 1e9) | 0;
function hsh(s) {
  const x = Math.sin(s) * 43758.5453123;
  return x - Math.floor(x);
}
function hash2(x, z) { return hsh(x * 127.1 + z * 311.7 + SEED * 74.7); }
function hash3(x, y, z) { return hsh(x * 127.1 + y * 311.7 + z * 74.7 + SEED * 51.3); }
const smooth = (t) => t * t * (3 - 2 * t);
function noise2(x, z) {
  const x0 = Math.floor(x), z0 = Math.floor(z);
  const tx = smooth(x - x0), tz = smooth(z - z0);
  const a = hash2(x0, z0), b = hash2(x0 + 1, z0), c = hash2(x0, z0 + 1), d = hash2(x0 + 1, z0 + 1);
  return a + (b - a) * tx + (c - a) * tz + (a - b - c + d) * tx * tz;
}
function noise3(x, y, z) {
  const x0 = Math.floor(x), y0 = Math.floor(y), z0 = Math.floor(z);
  const tx = smooth(x - x0), ty = smooth(y - y0), tz = smooth(z - z0);
  let acc = 0;
  for (let dx = 0; dx <= 1; dx++) for (let dy = 0; dy <= 1; dy++) for (let dz = 0; dz <= 1; dz++) {
    const w = (dx ? tx : 1 - tx) * (dy ? ty : 1 - ty) * (dz ? tz : 1 - tz);
    acc += w * hash3(x0 + dx, y0 + dy, z0 + dz);
  }
  return acc;
}
function fbm2(x, z, oct) {
  let v = 0, amp = 0.5, f = 1, tot = 0;
  for (let i = 0; i < oct; i++) { v += noise2(x * f, z * f) * amp; tot += amp; amp *= 0.5; f *= 2.05; }
  return v / tot;
}

/* nicer terrain: continents + ridged mountains + detail.
   Base sits ABOVE water level so oceans are rare; lakes only form in
   genuine basins. Mountains grow on high continents near ridge lines. */
function terrainH(gx, gz) {
  const c = fbm2(gx * 0.011, gz * 0.011, 3);                                   // continental 0..1
  const rw = 1 - Math.abs(2 * noise2(gx * 0.021 + 50, gz * 0.021 - 10) - 1);   // ridge 0..1
  const hills = (noise2(gx * 0.055 + 7, gz * 0.055 + 3) - 0.5);
  const det = (noise2(gx * 0.17, gz * 0.17 + 20) - 0.5);
  let h = 38 + (c - 0.5) * 14 + hills * 7 +
           Math.pow(rw, 2.2) * Math.max(0, c - 0.4) * 46 + det * 2;
  return Math.max(26, Math.min(62, Math.round(h)));
}

/* ============================ light engine ============================ */
function lightGet(gx, gy, gz) {
  if (gy >= H) return 15;                 // open sky
  if (gy < 0) return 0;
  const c = chunks.get(key(chunkOf(gx), chunkOf(gz)));
  if (!c) return 15;
  const lx = gx - c.cx * CH, lz = gz - c.cz * CH;
  return c.light[idx(lx, gy, lz)];
}

/* recompute light for a SET of chunks in ONE global pass, so cross-border
   light is never wiped by a later per-chunk recompute */
function recomputeLights(list) {
  const queue = [];
  const push = (ch, i) => queue.push({ ch, i });
  for (const c of list) {
    const L = c.light, d = c.data;
    L.fill(0);
    // 1) skylight columns: walk down until an opaque block
    for (let x = 0; x < CH; x++) {
      for (let z = 0; z < CH; z++) {
        let v = 15;
        for (let y = H - 1; y >= 0; y--) {
          const b = d[idx(x, y, z)];
          if (b === AIR || b === WATER || b === LAVA) { /* transparent */ }
          else if (b === LEAVES) { if (v === 15) v = 11; }
          else break;
          L[idx(x, y, z)] = v;
          push(c, idx(x, y, z));
        }
      }
    }
    // 2) block light sources
    for (let y = 0; y < H; y++) for (let z = 0; z < CH; z++) for (let x = 0; x < CH; x++) {
      const b = d[idx(x, y, z)];
      if (b === LAVA || b === GLOW) { const i = idx(x, y, z); if (L[i] < 15) { L[i] = 15; push(c, i); } }
    }
  }
  // 3) one global flood (breadth first, -1 per step) that crosses chunk borders
  let head = 0;
  while (head < queue.length) {
    const { ch, i } = queue[head++];
    const LV = ch.light;
    const lv = LV[i];
    if (lv <= 1) continue;
    const x = i % CH;
    const z = ((i / CH) | 0) % CH;
    const y = ((i / (CH * CH)) | 0);
    const nxt = lv - 1;
    const wx = ch.cx * CH + x, wz = ch.cz * CH + z;
    for (const [dx, dy, dz] of FACE_DIRS) {
      const ny = y + dy;
      if (ny < 0 || ny >= H) continue;
      const nxx = x + dx, nzz = z + dz;
      let nc = ch, ncx = nxx, ncz = nzz;
      if (nxx < 0 || nxx >= CH || nzz < 0 || nzz >= CH) {
        const gw = wx + dx, gz2 = wz + dz;
        nc = chunks.get(key(chunkOf(gw), chunkOf(gz2)));
        if (!nc) continue;
        ncx = gw - nc.cx * CH;
        ncz = gz2 - nc.cz * CH;
      }
      const ti = idx(ncx, ny, ncz);
      if (!TRANSPARENT_LIGHT(nc.data[ti])) continue;
      if (nc.light[ti] >= nxt) continue;
      nc.light[ti] = nxt;
      push(nc, ti);
    }
  }
}

/* ============================ world gen ============================ */
function worldGet(gx, gy, gz) {
  if (gy < 0) return BEDROCK;
  if (gy >= H) return AIR;
  const c = chunks.get(key(chunkOf(gx), chunkOf(gz)));
  if (!c) return AIR;
  return c.data[idx(gx - c.cx * CH, gy, gz - c.cz * CH)];
}
function worldSet(gx, gy, gz, id) {
  if (gy < 1 || gy >= H) return;
  const c = chunks.get(key(chunkOf(gx), chunkOf(gz)));
  if (!c) return;
  c.data[idx(gx - c.cx * CH, gy, gz - c.cz * CH)] = id;
}

/* writes across chunk borders; returns the chunk key it touched (or null) */
function setInto(gx, gy, gz, id) {
  if (gy < 1 || gy >= H) return null;
  const cx = chunkOf(gx), cz = chunkOf(gz);
  const c = chunks.get(key(cx, cz));
  if (!c) return null;
  c.data[idx(gx - cx * CH, gy, gz - cz * CH)] = id;
  return key(cx, cz);
}

/* phase 1: solid terrain + lakes + caves. Caves are carved on the FULL
   x/z range using world-space noise, so tunnels continue seamlessly into
   neighbouring chunks (no more 16-block wall patterns at borders). */
function genBase(c) {
  const d = c.data;
  const cx0 = c.cx * CH, cz0 = c.cz * CH;
  for (let x = 0; x < CH; x++) {
    for (let z = 0; z < CH; z++) {
      const gx = cx0 + x, gz = cz0 + z;
      const h = terrainH(gx, gz);
      const beach = h <= WL + 1;                       // sand skin only around lakes
      for (let y = 0; y < H; y++) {
        if (y === 0) d[idx(x, y, z)] = BEDROCK;
        else if (y < h - 3) d[idx(x, y, z)] = STONE;
        else if (y < h) d[idx(x, y, z)] = beach ? SAND : DIRT;
        else if (y === h) d[idx(x, y, z)] = beach ? SAND : GRASS;
        else if (y <= WL) d[idx(x, y, z)] = WATER;     // lakes in basins only
        else break;
      }
    }
  }
  carveCaves(c);
}

function carveCaves(c) {
  const d = c.data;
  const cx0 = c.cx * CH, cz0 = c.cz * CH;
  for (let x = 0; x < CH; x++) {
    for (let z = 0; z < CH; z++) {
      const gx = cx0 + x, gz = cz0 + z;
      const h = terrainH(gx, gz);
      const hLim = Math.min(h - 7, WL + 4);            // never break the surface
      for (let y = 5; y < hLim; y++) {
        const n1 = noise3(gx * 0.085, y * 0.11, gz * 0.085);
        if (n1 > 0.62) continue;
        const n2 = noise3(gx * 0.19 + 9, y * 0.23, gz * 0.19 - 4);
        if (n1 < 0.30 && n2 < 0.45) {
          d[idx(x, y, z)] = AIR;
          const below = d[idx(x, y - 1, z)];
          if (SOLID.has(below)) {
            if (y < 20 && Math.random() < 0.004) d[idx(x, y, z)] = LAVA;
            else if (y < 15 && Math.random() < 0.0012) d[idx(x, y, z)] = GLOW;
          }
        }
      }
    }
  }
}

/* phase 2: trees. Runs AFTER every chunk in the radius has base data, so
   trunks & canopies can cross chunk borders and land in real cells.
   Returns the set of chunk keys whose data changed. */
function genTrees(c) {
  const cx0 = c.cx * CH, cz0 = c.cz * CH;
  const dirty = new Set();
  const touch = (k) => { if (k) dirty.add(k); };
  for (let x = 0; x < CH; x++) {
    for (let z = 0; z < CH; z++) {
      const gx = cx0 + x, gz = cz0 + z;
      const h = terrainH(gx, gz);
      if (worldGet(gx, h, gz) !== GRASS) continue;
      const r = hash2(gx * 3.1, gz * 1.7 + 9);
      if (r > 0.0042) continue;
      const n = 1 + ((hash2(gx, gz * 2.3) * 3) | 0);   // clustered companions
      for (let k = 0; k < n; k++) {
        const tx = gx + ((hash2(gx + k * 7, gz + k * 13) * 7) | 0) - 3;
        const tz = gz + ((hash2(gx + k * 11, gz + k * 3) * 7) | 0) - 3;
        const th = terrainH(tx, tz);
        if (worldGet(tx, th, tz) !== GRASS) continue;
        const th2 = 4 + ((hash2(tx, tz * 2.3) * 3) | 0);
        for (let t = 1; t <= th2; t++) touch(setInto(tx, th + t, tz, LOG));
        const topY = th + th2;
        for (let dy = -2; dy <= 0; dy++) {
          const rad = dy === -2 ? 1 : 2;
          for (let dx = -rad; dx <= rad; dx++) for (let dz = -rad; dz <= rad; dz++) {
            if (dy === 0 && dx === 0 && dz === 0) continue;
            if (dx * dx + dz * dz > rad * rad + 1) continue;
            if (dx * dx + dz * dz > rad * rad && (Math.abs(dx) === 2 || Math.abs(dz) === 2)) continue;
            touch(setInto(tx + dx, topY + dy, tz + dz, LEAVES));
          }
        }
        touch(setInto(tx, topY + 1, tz, LEAVES));
      }
    }
  }
  return dirty;
}

/* ============================ meshing ============================ */
const eps = 0.5 / ATLAS;
function tileUV(tile) {
  const tcol = tile % 4, trow = (tile / 4) | 0;
  const u0 = (tcol * TILE + eps) / ATLAS, u1 = ((tcol + 1) * TILE - eps) / ATLAS;
  const v0 = (trow * TILE + eps) / ATLAS, v1 = ((trow + 1) * TILE - eps) / ATLAS;
  return [[u0, v0], [u0, v1], [u1, v1], [u1, v0]];
}
const FACE_UV = [
  [[0, 0], [1, 0], [1, 1], [0, 1]],
  [[0, 0], [1, 0], [1, 1], [0, 1]],
  [[0, 0], [0, 1], [1, 1], [1, 0]],
  [[1, 0], [1, 1], [0, 1], [0, 0]],
  [[0, 0], [1, 0], [1, 1], [0, 1]],
  [[1, 0], [0, 0], [0, 1], [1, 1]],
];
function meshChunk(c) {
  const d = c.data, L = c.light;
  const pos = [], uv = [], col = [], ind = [];
  const lpos = [], luv = [], lcol = [], lind = [];
  const cx0 = c.cx * CH, cz0 = c.cz * CH;

  for (let y = 0; y < H; y++) {
    for (let z = 0; z < CH; z++) {
      for (let x = 0; x < CH; x++) {
        const b = d[idx(x, y, z)];
        if (b === AIR) continue;
        const liq = LIQUID.has(b);
        const gx = cx0 + x, gz = cz0 + z;
        const blk = BLOCKS[b];
        for (let f = 0; f < 6; f++) {
          const dir = FACE_DIRS[f];
          const nx = x + dir[0], ny = y + dir[1], nz = z + dir[2];
          let nb = 0;
          if (nx >= 0 && nx < CH && nz >= 0 && nz < CH && ny >= 0 && ny < H) nb = d[idx(nx, ny, nz)];
          else nb = worldGet(gx + dir[0], ny, gz + dir[2]);
          if (liq) {
            if (SOLID.has(nb)) continue;
            if (nb === b) continue;               // same liquid hides face
            if (LIQUID.has(nb)) continue;         // no water/lava contact faces
          } else {
            if (SOLID.has(nb)) continue;
          }
          const tile = f === 0 ? blk.top : f === 1 ? blk.bot : blk.side;
          const uvs = tileUV(tile);
          // brightness from the light of the cell across the face
          let bright;
          if (liq) {
            bright = b === LAVA ? 1.0 : Math.max(lightGet(gx + dir[0], y + dir[1], gz + dir[2]) / 15, 0.35);
          } else {
            bright = Math.max(lightGet(gx + dir[0], y + dir[1], gz + dir[2]) / 15, 0.05);
          }
          const lt = Math.min(1, bright * FACE_LIGHT[f]);
          const P = liq ? lpos : pos, U = liq ? luv : uv, C = liq ? lcol : col, I = liq ? lind : ind;
          const base = P.length / 3;
          const q = QUAD_CORNERS[f];
          const fu = FACE_UV[f];
          for (let v = 0; v < 4; v++) {
            P.push(q[v][0], q[v][1], q[v][2]);
            U.push(uvs[fu[v][0]][0], uvs[fu[v][0]][1]);
            C.push(lt, lt, lt);
          }
          I.push(base, base + 1, base + 2, base, base + 2, base + 3);
        }
      }
    }
  }
  const out = { solid: null, liq: null };
  if (ind.length) out.solid = makeMesh(pos, uv, col, ind, c, chunkMat);
  if (lind.length) out.liq = makeMesh(lpos, luv, lcol, lind, c, waterMat);
  return out;
}
function makeMesh(pos, uv, col, ind, c, mat) {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(ind);
  const m = new THREE.Mesh(g, mat);
  m.matrixAutoUpdate = false;
  m.frustumCulled = false;               // static chunk meshes: skip culling
  m.position.set(c.cx * CH, 0, c.cz * CH);
  m.updateMatrix();
  return m;
}

function remesh(c) {
  if (c.mesh) { scene.remove(c.mesh); c.mesh.geometry.dispose(); c.mesh = null; }
  if (c.liqMesh) { scene.remove(c.liqMesh); c.liqMesh.geometry.dispose(); c.liqMesh = null; }
  const m = meshChunk(c);
  if (m.solid) scene.add(m.solid);
  if (m.liq) scene.add(m.liq);
  c.mesh = m.solid; c.liqMesh = m.liq;
  c.meshed = true;
}

function updateChunks() {
  const pcx = chunkOf(player.pos.x), pcz = chunkOf(player.pos.z);
  for (const c of [...chunks.values()]) {
    if (Math.abs(c.cx - pcx) > R + 1 || Math.abs(c.cz - pcz) > R + 1) {
      if (c.mesh) { scene.remove(c.mesh); c.mesh.geometry.dispose(); }
      if (c.liqMesh) { scene.remove(c.liqMesh); c.liqMesh.geometry.dispose(); }
      chunks.delete(key(c.cx, c.cz));
    }
  }
  // phase 0: make sure every chunk in the radius EXISTS (data arrays)
  const need = [];
  for (let dx = -R; dx <= R; dx++) for (let dz = -R; dz <= R; dz++) {
    const cx = pcx + dx, cz = pcz + dz;
    if (!chunks.has(key(cx, cz))) need.push(ensureChunk(cx, cz));
  }
  // phase 1: base terrain + lakes + caves for the new chunks
  for (const c of need) genBase(c);
  // phase 2: trees — all neighbours exist now, so nothing gets dropped
  const dirty = new Set(need.map((c) => key(c.cx, c.cz)));
  for (const c of need) for (const k of genTrees(c)) dirty.add(k);
  // phase 3: light (one global pass) + mesh every chunk whose data changed
  const touched = [];
  for (const k of dirty) { const c = chunks.get(k); if (c) touched.push(c); }
  recomputeLights(touched);
  for (const c of touched) remesh(c);
}

function setBlock(gx, gy, gz, id) {
  if (gy < 1 || gy >= H) return;
  const cx = chunkOf(gx), cz = chunkOf(gz);
  const c = chunks.get(key(cx, cz));
  if (!c) return;
  c.data[idx(gx - cx * CH, gy, gz - cz * CH)] = id;
  // block edits can change light (glow/lava) and culling on both sides of a border
  const around = new Set([key(cx, cz)]);
  const lx = gx - cx * CH, lz = gz - cz * CH;
  if (lx === 0) around.add(key(cx - 1, cz));
  if (lx === CH - 1) around.add(key(cx + 1, cz));
  if (lz === 0) around.add(key(cx, cz - 1));
  if (lz === CH - 1) around.add(key(cx, cz + 1));
  const touched = [];
  for (const k of around) {
    const n = chunks.get(k);
    if (n && n.meshed) touched.push(n);
  }
  recomputeLights(touched);
  for (const n of touched) remesh(n);
}

/* ============================ player ============================ */
const player = {
  pos: new THREE.Vector3(8, 40, 8), vel: new THREE.Vector3(),
  yaw: 0, pitch: -0.1, onGround: false, fly: false, swim: false,
};
const keys = new Set();
const HALF = 0.3, EYE = 1.62;

function spawn() {
  let sx = 8, sz = 8;
  outer:
  for (let r = 0; r < 60; r++) {
    for (let a = 0; a < 24; a++) {
      const gx = sx + Math.round(Math.cos(a / 24 * Math.PI * 2) * r);
      const gz = sz + Math.round(Math.sin(a / 24 * Math.PI * 2) * r);
      const h = terrainH(gx, gz);
      if (h < WL + 5 || h > 48) continue;              // grassy, well above water
      let flat = true;
      for (let dx = -6; dx <= 6 && flat; dx += 2) {
        for (let dz = -6; dz <= 6 && flat; dz += 2) {
          if (Math.abs(terrainH(gx + dx, gz + dz) - h) > 3) flat = false;
        }
      }
      if (flat) { sx = gx; sz = gz; break outer; }
    }
  }
  player.pos.set(sx + 0.5, terrainH(sx, sz) + 3, sz + 0.5);
  player.vel.set(0, 0, 0);
}

function cellSolid(x, y, z) {
  if (y < 0) return true;
  if (y >= H) return false;
  const c = chunks.get(key(chunkOf(x), chunkOf(z)));
  if (!c) return false;
  const b = c.data[idx(x - c.cx * CH, y, z - c.cz * CH)];
  return SOLID.has(b);
}
function cellLiquid(x, y, z) {
  if (y < 0 || y >= H) return false;
  const c = chunks.get(key(chunkOf(x), chunkOf(z)));
  if (!c) return false;
  const b = c.data[idx(x - c.cx * CH, y, z - c.cz * CH)];
  return LIQUID.has(b);
}
function inLiquid() {
  const p = player.pos;
  return cellLiquid(Math.floor(p.x), Math.floor(p.y + 0.4), Math.floor(p.z)) ||
         cellLiquid(Math.floor(p.x), Math.floor(p.y + 1.4), Math.floor(p.z));
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
  const wet = inLiquid();
  p.swim = wet;
  const spd = p.fly ? 10 : (wet ? 3.4 : 4.6);
  mx = (mx / ml) * spd; mz = (mz / ml) * spd;

  if (p.fly) {
    p.vel.x = mx; p.vel.z = mz;
    p.vel.y = (keys.has("Space") ? 1 : 0) * spd * 0.9 - ((keys.has("ShiftLeft") || keys.has("ControlLeft")) ? 1 : 0) * spd * 0.9;
  } else if (wet) {
    p.onGround = false;
    p.vel.x = mx; p.vel.z = mz;
    p.vel.y -= 10 * dt;
    if (keys.has("Space")) p.vel.y = Math.min(p.vel.y + 30 * dt, 4.6);
    p.vel.y = Math.max(p.vel.y, -3.6);
  } else {
    p.onGround = false;
    p.vel.x = mx; p.vel.z = mz;
    p.vel.y -= 28 * dt;
    if (keys.has("Space") && p.onGround) p.vel.y = 9.2;
  }
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
    if (t > REACH) return null;
    if (y >= 0 && y < H) {
      const b = worldGet(x, y, z);
      if (SOLID.has(b) && !LIQUID.has(b)) return { x, y, z, face };
    } else if (y < 0) {
      return { x, y, z, face };
    }
    if (tMX < tMY && tMX < tMZ) { x += stepX; t = tMX; tMX += tDX; face = d.x > 0 ? 2 : 3; }
    else if (tMY < tMZ) { y += stepY; t = tMY; tMY += tDY; face = d.y > 0 ? 0 : 1; }
    else { z += stepZ; t = tMZ; tMZ += tDZ; face = d.z > 0 ? 4 : 5; }
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
  toast("left: mine · right: place · F: fly · 1-8: blocks · glow rock lights caves!");
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
  if (cellSolid(tx, ty, tz) || LIQUID.has(worldGet(tx, ty, tz))) return;
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
let touchLookOn = false, touchLookX = 0, touchLookY = 0, touchLookId = -1, tapX = 0, tapY = 0;
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
  ui2.tap.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    e.stopPropagation();
    touchLookId = -1; touchLookOn = false;
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
  set: (x, y, z, id) => setBlock(x, y, z, id),
  lightAt: (x, y, z) => lightGet(x, y, z),
  seed: SEED,
  triangles: () => renderer.info.render.triangles,
  calls: () => renderer.info.render.calls,
  sceneKids: () => scene.children.map(m => m.geometry ? m.geometry.attributes.position.count : m.type),
  firstGeo: () => { const m = scene.children.find(c => c.geometry && c.geometry.attributes.position); if (!m) return null; return { count: m.geometry.attributes.position.count, mat: m.material.type, fog: m.material.fog }; },
  stats: () => {
    const counts = {};
    for (const c of chunks.values()) {
      for (let i = 0; i < SZ; i++) {
        const b = c.data[i];
        counts[b] = (counts[b] || 0) + 1;
      }
    }
    return counts;
  },
};
