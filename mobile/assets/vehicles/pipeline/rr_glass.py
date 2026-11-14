# rr_glass.py in.png out.png : privacy-tint the L460 side glass in the final (mirrored, 1760px) asset.
# Luminance above ~0 is compressed toward a dark-glass ceiling, so the showroom background, trees and window
# stickers seen through the glass become dark tinted glass while reflections keep their shape.
import numpy as np, cv2
from PIL import Image
src, dst = sys.argv[1:3]
im = np.asarray(Image.open(src).convert('RGBA')).astype(np.float32) / 255.
H, W = im.shape[:2]
polys = [  # output pixel coordinates (car faces left)
    [(745, 58), (958, 52), (955, 214), (700, 214), (698, 170), (722, 108)],      # front door window
    [(966, 50), (1312, 48), (1312, 206), (966, 208)],                           # rear door window (+ fixed quarter light)
    [(1322, 46), (1562, 46), (1640, 140), (1662, 206), (1322, 206)],            # rear quarter glass
]
m = np.zeros((H, W), np.uint8)
for p in polys: cv2.fillPoly(m, [np.int32(p)], 255)
m = cv2.GaussianBlur(m.astype(np.float32) / 255., (0, 0), 2.0)
rgb = im[..., :3]
L = rgb @ np.array([0.2126, 0.7152, 0.0722], np.float32)
ceiling = 0.16
Lt = ceiling * (1 - np.exp(-L / ceiling))
f = np.where(L > 1e-4, Lt / np.maximum(L, 1e-4), 1)[..., None]
grey = Lt[..., None] * np.ones(3, np.float32)
tinted = (rgb * f) * 0.6 + grey * 0.4          # also desaturate 40%: green trees / yellow stickers read as glass
im[..., :3] = rgb * (1 - m[..., None]) + tinted * m[..., None]
Image.fromarray(np.round(np.clip(im, 0, 1) * 255).astype(np.uint8), 'RGBA').save(dst, optimize=True)
print('ok', W, H)
