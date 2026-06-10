"""One-shot generator for degraded label fixtures (AC-1, amendment D8.2).

Produces realistic photo-style degradations of the real COLA label scans:
blur, glare, rotation, perspective, shadow, phone-photo (noise+dim+tilt).
Outputs are committed under eval/images/degraded/ and graded by scripts/eval.ts.

Run once:  python scripts/make_degraded.py
"""

import math
import os
import random

from PIL import Image, ImageDraw, ImageEnhance, ImageFilter

SRC = os.path.join(os.path.dirname(__file__), "..", "eval", "images")
DST = os.path.join(SRC, "degraded")
random.seed(42)


def load(name: str) -> Image.Image:
    return Image.open(os.path.join(SRC, name)).convert("RGB")


def save(img: Image.Image, name: str) -> None:
    os.makedirs(DST, exist_ok=True)
    img.save(os.path.join(DST, name), quality=82)
    print(f"wrote degraded/{name} ({img.width}x{img.height})")


def blur(img: Image.Image) -> Image.Image:
    return img.filter(ImageFilter.GaussianBlur(radius=2.2))


def glare(img: Image.Image) -> Image.Image:
    overlay = Image.new("L", img.size, 0)
    d = ImageDraw.Draw(overlay)
    cx, cy = int(img.width * 0.62), int(img.height * 0.3)
    r = int(min(img.size) * 0.55)
    for i in range(r, 0, -2):
        alpha = int(195 * (1 - i / r) ** 2)
        d.ellipse([cx - i, cy - i, cx + i, cy + i], fill=alpha)
    white = Image.new("RGB", img.size, (255, 255, 255))
    return Image.composite(white, img, overlay)


def rotation(img: Image.Image) -> Image.Image:
    return img.rotate(8, expand=True, fillcolor=(120, 110, 100))


def perspective(img: Image.Image) -> Image.Image:
    w, h = img.size
    # Skew: right edge pushed back, like a label shot from the left.
    coeffs = find_coeffs(
        [(0, 0), (w, int(h * 0.08)), (w, int(h * 0.92)), (0, h)],
        [(0, 0), (w, 0), (w, h), (0, h)],
    )
    return img.transform((w, h), Image.Transform.PERSPECTIVE, coeffs, Image.Resampling.BICUBIC)


def find_coeffs(target, source):
    import numpy as np

    matrix = []
    for t, s in zip(target, source):
        matrix.append([s[0], s[1], 1, 0, 0, 0, -t[0] * s[0], -t[0] * s[1]])
        matrix.append([0, 0, 0, s[0], s[1], 1, -t[1] * s[0], -t[1] * s[1]])
    a = np.array(matrix, dtype=float)
    b = np.array(target, dtype=float).reshape(8)
    return np.linalg.solve(a, b).tolist()


def shadow(img: Image.Image) -> Image.Image:
    overlay = Image.new("L", img.size, 0)
    d = ImageDraw.Draw(overlay)
    # Diagonal shadow band across the lower-left half.
    for y in range(img.height):
        alpha = int(130 * max(0.0, min(1.0, (y / img.height - 0.25) * 1.6)))
        d.line([(0, y), (int(img.width * (0.85 - 0.3 * y / img.height)), y)], fill=alpha)
    black = Image.new("RGB", img.size, (15, 12, 10))
    return Image.composite(black, img, overlay.filter(ImageFilter.GaussianBlur(24)))


def phone_photo(img: Image.Image) -> Image.Image:
    out = img.rotate(-3, expand=True, fillcolor=(60, 55, 50))
    out = ImageEnhance.Brightness(out).enhance(0.7)
    out = ImageEnhance.Contrast(out).enhance(0.85)
    px = out.load()
    for _ in range(out.width * out.height // 18):
        x, y = random.randrange(out.width), random.randrange(out.height)
        r, g, b = px[x, y]
        n = random.randint(-26, 26)
        px[x, y] = (max(0, min(255, r + n)), max(0, min(255, g + n)), max(0, min(255, b + n)))
    return out.filter(ImageFilter.GaussianBlur(0.6))


CASES = [
    ("blur-otium-front.jpg", "labelexample1_p2_0.jpg", blur),
    ("blur-otium-back.jpg", "labelexample1_p3_1.jpg", blur),
    ("glare-santa-fe.jpg", "labelexample2_p2_0.jpg", glare),
    ("rotation-eight-chains.jpg", "labelexample3_p2_0.jpg", rotation),
    ("perspective-otium-front.jpg", "labelexample1_p2_0.jpg", perspective),
    ("perspective-otium-back.jpg", "labelexample1_p3_1.jpg", perspective),
    ("shadow-santa-fe.jpg", "labelexample2_p2_0.jpg", shadow),
    ("phone-eight-chains.jpg", "labelexample3_p2_0.jpg", phone_photo),
]

for out_name, src_name, fn in CASES:
    save(fn(load(src_name)), out_name)
