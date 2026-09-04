#!/usr/bin/env python3
"""CHUDCRAFT icons — original pixel voxel-cube artwork (grass block style),
drawn with PIL, upscaled with nearest-neighbour for crisp retro edges."""
from PIL import Image
import random

S = 60  # base pixel canvas

# --- deterministic noise ---
random.seed(20260904)

def in_poly(x, y, poly):
    # convex polygon point test
    n = len(poly)
    for i in range(n):
        x1, y1 = poly[i]; x2, y2 = poly[(i + 1) % n]
        if (x2 - x1) * (y - y1) - (y2 - y1) * (x - x1) < 0:
            return False
    return True

def draw_cube(img, ox, oy, s, outline=(24, 20, 16)):
    # faces as rhombi: top, left, right
    top  = [(ox, oy), (ox + s, oy + s * 0.42), (ox, oy + s * 0.84), (ox - s, oy + s * 0.42)]
    left = [(ox - s, oy + s * 0.42), (ox, oy + s * 0.84), (ox, oy + s * 1.84), (ox - s, oy + s * 1.42)]
    rght = [(ox, oy + s * 0.84), (ox + s, oy + s * 0.42), (ox + s, oy + s * 1.42), (ox, oy + s * 1.84)]

    grass = [(121, 200, 86), (92, 166, 62), (142, 219, 102)]   # base, dark, light
    dirt  = [(150, 110, 72), (122, 88, 56)]
    dirk  = [(136, 98, 62), (108, 78, 48)]

    for (poly, cols) in [(top, grass), (left, dirt), (rght, dirk)]:
        # black backing (outline)
        for yy in range(int(min(p[1] for p in poly)) - 2, int(max(p[1] for p in poly)) + 3):
            for xx in range(int(min(p[0] for p in poly)) - 2, int(max(p[0] for p in poly)) + 3):
                if in_poly(xx, yy, poly):
                    img.putpixel((xx, yy), outline)
        # fill with speckle
        for yy in range(int(min(p[1] for p in poly)), int(max(p[1] for p in poly)) + 1):
            for xx in range(int(min(p[0] for p in poly)), int(max(p[0] for p in poly)) + 1):
                if not in_poly(xx, yy, poly):
                    continue
                r = random.random()
                if r < 0.16: col = cols[1]
                elif r < 0.20: col = cols[2] if len(cols) > 2 else cols[1]
                else: col = cols[0]
                img.putpixel((xx, yy), col)

# --- 60x60 base ---
base = Image.new("RGB", (S, S), (159, 217, 255))
draw_cube(base, S // 2, 8, 15)          # main cube
draw_cube(base, S // 2 + 20, 34, 9)     # smaller cube bottom-right (depth)
draw_cube(base, S // 2 - 24, 40, 7)     # tiny cube bottom-left

# --- export ---
for path, size in [("/home/user/chudcraft/apple-touch-icon.png", 180),
                   ("/home/user/chudcraft/favicon.png", 64)]:
    base.resize((size, size), Image.NEAREST).save(path)
    print("wrote", path, size)
