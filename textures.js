/* CHUDCRAFT — original procedural textures. 16x16 pixel tiles drawn to a
   64x64 atlas. Every tile is generated from code; nothing is ripped. */

export const TILE = 16;
export const ATLAS = 64; // 4x4 tiles

// deterministic tiny rng per tile so artwork is stable
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeTile(painter, seed) {
  const c = document.createElement("canvas");
  c.width = TILE; c.height = TILE;
  const g = c.getContext("2d");
  const img = g.createImageData(TILE, TILE);
  const d = img.data;
  const rnd = rng(seed * 2654435761 + 97);
  const px = (x, y, col) => {
    if (x < 0 || y < 0 || x >= TILE || y >= TILE) return;
    const i = (y * TILE + x) * 4;
    d[i] = (col >> 16) & 255; d[i + 1] = (col >> 8) & 255; d[i + 2] = col & 255; d[i + 3] = 255;
  };
  const speckle = (col, n) => { for (let i = 0; i < n; i++) px((rnd() * TILE) | 0, (rnd() * TILE) | 0, col); };
  painter({ px, speckle, rnd });
  g.putImageData(img, 0, 0);
  return c;
}

const C = {
  dirtA: 0x8a5f3c, dirtB: 0x7d5635, dirtC: 0x956a45, pebble: 0x5e4026,
  grassA: 0x7ec850, grassB: 0x66b53f, grassC: 0x93d95f, grassD: 0x57a036,
  stoneA: 0x8b8b8b, stoneB: 0x7a7a7a, stoneC: 0x989898, stoneD: 0x6e6e6e, crack: 0x565656,
  sandA: 0xe4daa0, sandB: 0xd3c98c, sandC: 0xefe7b6, sandD: 0xb3a878,
  woodA: 0xa58d4b, woodB: 0x8f7a3c, woodC: 0x6f5b2e, woodD: 0x9c8145, seam: 0x5e4a24,
  leafA: 0x58a047, leafB: 0x4b8b3e, leafC: 0x67af53, leafD: 0x3e7a35,
  rockA: 0x5c5c5e, rockB: 0x4b4b4d, rockC: 0x6b6b6d, rockD: 0x38383a,
  cbA: 0x878787, cbB: 0x707070, cbC: 0x969696, cbD: 0x555555,
  plankA: 0xa1884f, plankB: 0x967f46, plankC: 0xa98f55, plankD: 0x8f7a40, plankHi: 0xc9a95f,
};

const TILES = {
  grass_top: makeTile(({ px, speckle, rnd }) => {
    for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) px(x, y, C.grassA);
    speckle(C.grassB, 40); speckle(C.grassC, 22); speckle(C.grassD, 14);
  }, 1),
  grass_side: makeTile(({ px, speckle, rnd }) => {
    for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) px(x, y, (y & 1) ? C.dirtA : C.dirtB);
    speckle(C.dirtC, 16); speckle(C.pebble, 5);
    for (let x = 0; x < TILE; x++) {                    // ragged grass top strip
      px(x, 0, C.grassA); px(x, 1, C.grassA);
      if (rnd() < 0.85) px(x, 2, C.grassA);
      if (rnd() < 0.4) px(x, 3, C.grassA);
      if (rnd() < 0.18) px(x, 4, C.grassA);             // dangling bits
      if (rnd() < 0.35) px(x, 2, C.grassB); else if (rnd() < 0.4) px(x, 1, C.grassC);
    }
  }, 2),
  dirt: makeTile(({ px, speckle, rnd }) => {
    for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) px(x, y, (y + x) & 1 ? C.dirtA : C.dirtB);
    speckle(C.dirtC, 18); speckle(C.pebble, 6);
  }, 3),
  stone: makeTile(({ px, speckle, rnd }) => {
    for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) px(x, y, C.stoneA);
    speckle(C.stoneB, 40); speckle(C.stoneC, 22); speckle(C.stoneD, 16);
    for (let i = 0; i < 5; i++) {                       // short cracks
      let x = (rnd() * TILE) | 0, y = (rnd() * TILE) | 0;
      for (let s = 0; s < 3; s++) { px(x, y, C.crack); x += rnd() < 0.5 ? 1 : 0; y += rnd() < 0.5 ? 1 : 0; if (x > 15 || y > 15) break; }
    }
  }, 4),
  sand: makeTile(({ px, speckle }) => {
    for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) px(x, y, C.sandA);
    speckle(C.sandB, 36); speckle(C.sandC, 20); speckle(C.sandD, 8);
  }, 5),
  wood_side: makeTile(({ px, speckle, rnd }) => {
    for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) {
      const m = x % 4;
      let col = m === 0 ? C.woodC : m === 1 ? C.woodA : m === 3 ? C.woodD : C.woodB;
      if (m !== 0 && rnd() < 0.12) col = C.woodC;
      px(x, y, col);
    }
  }, 6),
  wood_top: makeTile(({ px, rnd }) => {
    for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) {
      const cx = x - 7.5, cy = y - 7.5, r = Math.sqrt(cx * cx + cy * cy);
      const band = Math.floor(r / 2.2) % 2;
      let col = band ? C.woodD : C.woodB;
      if (r > 6.9) col = C.woodC;
      if (rnd() < 0.08) col = C.woodC;
      px(x, y, col);
    }
  }, 7),
  planks: makeTile(({ px, rnd }) => {
    const board = [C.plankC, C.plankA, C.plankB, C.plankD];
    const seamX = [6, 11, 3, 13];
    for (let y = 0; y < TILE; y++) {
      const row = (y / 4) | 0, sy = seamX[row];
      for (let x = 0; x < TILE; x++) {
        let col = board[row];
        if (y % 4 === 0 && rnd() < 0.5) col = C.plankHi;        // bevel light
        if (y % 4 === 3) col = board[(row + 1) % 4] === C.plankC ? C.plankB : C.plankD;
        if (x === sy || x === sy + 1) col = C.seam;             // vertical seams
        if (y % 4 === 3) col = C.seam;                          // board line
        if (rnd() < 0.06) col = C.seam;
        px(x, y, col);
      }
    }
  }, 8),
  leaves: makeTile(({ px, speckle, rnd }) => {
    for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) px(x, y, C.leafA);
    speckle(C.leafB, 40); speckle(C.leafC, 18); speckle(C.leafD, 20);
  }, 9),
  bedrock: makeTile(({ px, speckle, rnd }) => {
    for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) px(x, y, C.rockA);
    speckle(C.rockB, 44); speckle(C.rockC, 20); speckle(C.rockD, 30);
  }, 10),
  cobble: makeTile(({ px, rnd }) => {
    for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) px(x, y, C.cbD);
    const stones = [];
    for (let i = 0; i < 9; i++) {
      const sx = (i % 3) * 5 + 1.5 + (rnd() - 0.5), sy = ((i / 3) | 0) * 5 + 1.5 + (rnd() - 0.5);
      const rw = 2.4 + rnd(), rh = 2.2 + rnd();
      const col = i % 2 ? C.cbA : (i % 3 ? C.cbB : C.cbC);
      stones.push([sx, sy, rw, rh, col]);
    }
    for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) {
      for (const [sx, sy, rw, rh, col] of stones) {
        const dx = (x - sx) / rw, dy = (y - sy) / rh;
        if (dx * dx + dy * dy <= 1) { px(x, y, col); break; }
      }
    }
    for (let i = 0; i < 14; i++) px((rnd() * TILE) | 0, (rnd() * TILE) | 0, C.cbD);
  }, 11),
  water: makeTile(({ px, rnd }) => {
    for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) {
      const wave = Math.sin(x * 1.3 + y * 0.5) * 0.5 + Math.sin(x * 0.4 - y * 0.9) * 0.5;
      let col = wave > 0.35 ? 0x3f7fdd : wave < -0.35 ? 0x2f66c4 : 0x3773d2;
      if (rnd() < 0.05) col = 0x4d8de8;
      px(x, y, col);
    }
  }, 12),
  lava: makeTile(({ px, rnd }) => {
    for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) px(x, y, 0xd84216);
    for (let i = 0; i < 30; i++) px((rnd() * TILE) | 0, (rnd() * TILE) | 0, 0xff7a1f);
    for (let i = 0; i < 16; i++) px((rnd() * TILE) | 0, (rnd() * TILE) | 0, 0xffc23d);
    for (let i = 0; i < 6; i++) px((rnd() * TILE) | 0, (rnd() * TILE) | 0, 0xffe98a);
  }, 13),
  glow: makeTile(({ px, rnd }) => {
    for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) px(x, y, 0xd8c05a);
    for (let i = 0; i < 22; i++) px((rnd() * TILE) | 0, (rnd() * TILE) | 0, 0xffed9a);
    for (let i = 0; i < 10; i++) px((rnd() * TILE) | 0, (rnd() * TILE) | 0, 0xb89a38);
    for (let i = 0; i < 8; i++) px((rnd() * TILE) | 0, (rnd() * TILE) | 0, 0xfff8d6);
  }, 14),
};

const names = Object.keys(TILES);
export const tileIndex = {};
names.forEach((n, i) => (tileIndex[n] = i));

/* accepts a tile NAME or numeric INDEX */
export function tileCanvas(key) {
  return typeof key === "string" ? TILES[key] : TILES[names[key]];
}

export function buildAtlas() {
  const cv = document.createElement("canvas");
  cv.width = ATLAS; cv.height = ATLAS;
  const g = cv.getContext("2d");
  names.forEach((n, i) => {
    const col = i % 4, row = (i / 4) | 0;
    g.drawImage(TILES[n], col * TILE, row * TILE);
  });
  // DEBUG: mark unused cells magenta to reveal UV bugs
  g.fillStyle = "#7a5230";   // unused cells: harmless dirt fill
  for (let i = names.length; i < 16; i++) {
    g.fillRect((i % 4) * TILE, ((i / 4) | 0) * TILE, TILE, TILE);
  }
  return cv;
}

