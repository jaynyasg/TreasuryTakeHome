"""Assemble .demo-frames/*.png into docs/demo.gif (README demo reel).

Run after scripts/demo-gif.mjs:  python scripts/make_gif.py
"""

import glob
import os

from PIL import Image

FRAMES_DIR = os.path.join(os.path.dirname(__file__), "..", ".demo-frames")
OUT = os.path.join(os.path.dirname(__file__), "..", "docs", "demo.gif")
WIDTH = 880

# Per-frame hold in ms — linger on results, move quickly through transitions.
DURATIONS = {
    "01": 1400,
    "02": 1800,
    "03": 1600,
    "04": 3200,
    "05": 3200,
    "06": 2200,
    "07": 1800,
    "08": 3600,
}

paths = sorted(glob.glob(os.path.join(FRAMES_DIR, "*.png")))
assert paths, "no frames captured"

frames = []
durations = []
for p in paths:
    img = Image.open(p).convert("RGB")
    h = int(img.height * WIDTH / img.width)
    img = img.resize((WIDTH, h), Image.Resampling.LANCZOS)
    frames.append(img.quantize(colors=128, method=Image.Quantize.MEDIANCUT))
    durations.append(DURATIONS.get(os.path.basename(p)[:2], 2000))

os.makedirs(os.path.dirname(OUT), exist_ok=True)
frames[0].save(
    OUT,
    save_all=True,
    append_images=frames[1:],
    duration=durations,
    loop=0,
    optimize=True,
)
print(f"wrote {OUT} ({os.path.getsize(OUT) // 1024} KB, {len(frames)} frames)")
