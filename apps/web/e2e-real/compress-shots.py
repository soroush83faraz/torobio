#!/usr/bin/env python3
"""Recompress the real-data screenshots in place (palette PNG, 48 colours, no dithering).

The e2e suite rewrites screenshots-real/*.png as full-colour PNGs (~5 MB); run this before committing them:
    python3 apps/web/e2e-real/compress-shots.py
The set must stay under 1.5 MB. Needs Pillow.
"""
import glob
import os

from PIL import Image

here = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'screenshots-real')
before = after = 0
for path in sorted(glob.glob(os.path.join(here, '*.png'))):
    before += os.path.getsize(path)
    im = Image.open(path).convert('RGB')
    im.quantize(colors=48, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE).save(path, optimize=True)
    after += os.path.getsize(path)
print(f'{before / 1e6:.2f} MB -> {after / 1e6:.2f} MB')
