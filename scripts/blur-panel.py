# Heavy mosaic (pixelation) over private regions — guaranteed unreadable.
# Usage: python scripts/blur-panel.py <in.png> <out.png>
import sys
from PIL import Image

src, dst = sys.argv[1], sys.argv[2]
img = Image.open(src).convert('RGB')
w, h = img.size

BADGES = [(34, 197, 94), (59, 130, 246), (148, 163, 184), (217, 119, 6)]

def is_badge(r, g, b):
    return any(abs(r - br) < 45 and abs(g - bg) < 45 and abs(b - bb) < 45 for br, bg, bb in BADGES)

px = img.load()
mask = Image.new('L', (w, h), 0)
mpx = mask.load()

# per-row: from badge+12 to x830 (title + workspace) — same coverage as before
for y in range(240, h - 20):
    badge_x = None
    for x in range(110, 620):
        r, g, b = px[x, y]
        if is_badge(r, g, b):
            badge_x = x
            break
    if badge_x is not None:
        for dy in (-4, -3, -2, -1, 0, 1, 2, 3, 4):
            yy = y + dy
            if 240 <= yy < h - 20:
                for x in range(badge_x + 8, min(835, w)):
                    mpx[x, yy] = 255
for y in range(180, 250):
    for x in range(120, 850):
        mpx[x, y] = 255

# heavy mosaic: shrink to tiny, then upscale (blocky pixelation)
cell = 16
small_w, small_h = max(1, w // cell), max(1, h // cell)
mosaic = img.resize((small_w, small_h), Image.BILINEAR).resize((w, h), Image.NEAREST)
out = Image.composite(mosaic, img, mask)
out.save(dst)
print(f'ok: {dst}')
