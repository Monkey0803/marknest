#!/usr/bin/env python3
"""Generate Marknest PNG icons with pure stdlib (zlib + struct), supersampled AA."""
import os
import struct
import zlib

OUT = os.path.join(os.path.dirname(__file__), "public", "icons")
os.makedirs(OUT, exist_ok=True)


def lerp(a, b, t):
    return a + (b - a) * t


def make_pixels(size, ss=4):
    s = size * ss
    # brand: warm terracotta background -> slightly deeper bottom (vertical gradient)
    top = (224, 116, 71)      # #e07447
    bottom = (198, 88, 52)    # #c65834
    glyph = (255, 251, 246)   # warm white bookmark

    # rounded rect radius ~22% of size
    radius = 0.22 * s
    px = bytearray()

    def in_rounded(x, y):
        # distance to rounded rect
        cx = min(max(x, radius), s - radius)
        cy = min(max(y, radius), s - radius)
        dx, dy = x - cx, y - cy
        return dx * dx + dy * dy <= radius * radius

    def in_bookmark(x, y):
        # bookmark ribbon: vertical bar with a V notch at bottom
        left, right = 0.36 * s, 0.64 * s
        topy, boty = 0.27 * s, 0.75 * s
        if not (left <= x <= right and topy <= y <= boty):
            return False
        # notch: bottom edge cuts up in the middle
        notch_h = 0.13 * s
        mid = (left + right) / 2
        halfspan = (right - left) / 2
        if y > boty - notch_h:
            t = (y - (boty - notch_h)) / notch_h  # 0 at notch top, 1 at bottom
            # allowed central removal region grows with t
            allow = halfspan * t
            if left + halfspan - allow <= x <= mid + allow:
                return False
        return True

    for y in range(s):
        for x in range(s):
            if not in_rounded(x + 0.5, y + 0.5):
                px += bytes((0, 0, 0, 0))
                continue
            t = y / s
            r = int(lerp(top[0], bottom[0], t))
            g = int(lerp(top[1], bottom[1], t))
            b = int(lerp(top[2], bottom[2], t))
            if in_bookmark(x + 0.5, y + 0.5):
                r, g, b = glyph
            px += bytes((r, g, b, 255))
    return px, s


def downsample(px, s, size, ss=4):
    out = bytearray()
    for y in range(size):
        for x in range(size):
            acc = [0, 0, 0, 0]
            for j in range(ss):
                for i in range(ss):
                    sx = x * ss + i
                    sy = y * ss + j
                    idx = (sy * s + sx) * 4
                    for c in range(4):
                        acc[c] += px[idx + c]
            n = ss * ss
            out += bytes(int(v / n) for v in acc)
    return out


def chunk(tag, data):
    c = struct.pack(">I", len(data)) + tag + data
    c += struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
    return c


def write_png(path, size):
    px, s = make_pixels(size)
    raw = downsample(px, s, size)
    # add filter byte 0 per scanline
    scan = bytearray()
    for y in range(size):
        scan.append(0)
        scan += raw[y * size * 4:(y + 1) * size * 4]
    ihdr = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)  # RGBA
    png = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) + chunk(b"IDAT", zlib.compress(bytes(scan), 9)) + chunk(b"IEND", b"")
    with open(path, "wb") as f:
        f.write(png)
    print("wrote", path, len(png), "bytes")


for sz in (16, 32, 48, 128):
    write_png(os.path.join(OUT, f"icon{sz}.png"), sz)
