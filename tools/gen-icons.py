#!/usr/bin/env python3
# tools/gen-icons.py
# WHAT: generates the PWA home-screen icons (icons/icon-192.png, icon-512.png)
# as pixel art, using only the Python standard library (zlib + struct for
# raw PNG encoding) — no Pillow/ImageMagick/node-canvas dependency, matching
# the project's own "no runtime dependencies" philosophy for its one-off
# build tooling. Re-run after changing the design: python3 tools/gen-icons.py

import struct
import zlib
import os

BG = (5, 5, 10, 255)       # #05050a — matches the game's background
FG = (110, 231, 255, 255)  # #6ee7ff — matches the game's cyan accent
BORDER = (35, 48, 58, 255) # #23303a — matches the viewport frame border


def make_pixels(size):
    px = [[BG for _ in range(size)] for _ in range(size)]
    cx = cy = (size - 1) / 2
    r_outer = size * 0.40
    r_tick = size * 0.10
    thickness = max(1, size // 24)

    def set_px(x, y, color):
        if 0 <= x < size and 0 <= y < size:
            px[y][x] = color

    def draw_thick_line(x0, y0, x1, y1, color, t):
        steps = int(max(abs(x1 - x0), abs(y1 - y0))) + 1
        for i in range(steps + 1):
            t_frac = i / steps if steps else 0
            x = x0 + (x1 - x0) * t_frac
            y = y0 + (y1 - y0) * t_frac
            for ox in range(-t // 2, t // 2 + 1):
                for oy in range(-t // 2, t // 2 + 1):
                    set_px(int(round(x)) + ox, int(round(y)) + oy, color)

    # Six-spoke snowflake: three full diameters through the center, each
    # spoke ending in a small V-shaped tick (a recognizable ice/frost mark).
    import math
    for spoke in range(3):
        angle = math.pi * spoke / 3
        dx, dy = math.cos(angle), math.sin(angle)
        x0, y0 = cx - dx * r_outer, cy - dy * r_outer
        x1, y1 = cx + dx * r_outer, cy + dy * r_outer
        draw_thick_line(x0, y0, x1, y1, FG, thickness)
        for sign in (1, -1):
            tx, ty = cx + dx * sign * r_outer, cy + dy * sign * r_outer
            perp = angle + math.pi / 2
            px_, py_ = math.cos(perp), math.sin(perp)
            draw_thick_line(tx, ty, tx + (dx * -0.35 + px_ * 0.35) * r_tick * 2,
                             ty + (dy * -0.35 + py_ * 0.35) * r_tick * 2, FG, thickness)
            draw_thick_line(tx, ty, tx + (dx * -0.35 - px_ * 0.35) * r_tick * 2,
                             ty + (dy * -0.35 - py_ * 0.35) * r_tick * 2, FG, thickness)

    # border frame
    b = max(1, size // 32)
    for i in range(b):
        for x in range(size):
            set_px(x, i, BORDER)
            set_px(x, size - 1 - i, BORDER)
        for y in range(size):
            set_px(i, y, BORDER)
            set_px(size - 1 - i, y, BORDER)

    return px


def write_png(path, size):
    px = make_pixels(size)
    raw = bytearray()
    for row in px:
        raw.append(0)  # filter type 0 (none) per scanline
        for (r, g, b, a) in row:
            raw += bytes((r, g, b, a))

    def chunk(tag, data):
        c = tag + data
        return struct.pack('>I', len(data)) + c + struct.pack('>I', zlib.crc32(c) & 0xffffffff)

    sig = b'\x89PNG\r\n\x1a\n'
    ihdr = struct.pack('>IIBBBBB', size, size, 8, 6, 0, 0, 0)  # 8-bit RGBA
    idat = zlib.compress(bytes(raw), 9)
    with open(path, 'wb') as f:
        f.write(sig)
        f.write(chunk(b'IHDR', ihdr))
        f.write(chunk(b'IDAT', idat))
        f.write(chunk(b'IEND', b''))


if __name__ == '__main__':
    out_dir = os.path.join(os.path.dirname(__file__), '..', 'icons')
    os.makedirs(out_dir, exist_ok=True)
    for size in (192, 512):
        path = os.path.join(out_dir, f'icon-{size}.png')
        write_png(path, size)
        print(f'Wrote {path}')
