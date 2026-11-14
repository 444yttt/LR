# edges.py in.png out.png [x7] : halo-free edges by construction.
# Pixels with alpha < 160 take the colour of the nearest opaque car pixels (normalised-convolution propagation);
# 160..254 blend linearly toward it. Background colour therefore cannot survive in the anti-aliased fringe.
# With "x7": also neutralise the green foliage seen through the top of the windscreen.
import numpy as np, cv2
from PIL import Image
src, dst = sys.argv[1:3]
im = np.asarray(Image.open(src).convert('RGBA')).astype(np.float32) / 255.
rgb, A = im[..., :3].copy(), im[..., 3]
if len(sys.argv) > 3 and sys.argv[3] == 'x7':
    region = np.zeros(A.shape, np.float32); region[15:130, 540:820] = 1
    region = cv2.GaussianBlur(region, (0, 0), 6)
    g = rgb @ np.array([0.2126, 0.7152, 0.0722], np.float32)
    green = np.clip((rgb[..., 1] - np.maximum(rgb[..., 0], rgb[..., 2]) - 0.02) / 0.06, 0, 1) * region
    rgb = rgb * (1 - green[..., None]) + (g * 0.8)[..., None] * green[..., None]
solid = (A >= 0.999).astype(np.float32)
fill = np.where(solid[..., None] > 0, rgb, 0).astype(np.float32)
done = solid > 0
for s in (1, 2, 3, 5, 8, 13, 21, 34):
    num = cv2.GaussianBlur(rgb * solid[..., None], (0, 0), s); den = cv2.GaussianBlur(solid, (0, 0), s)
    take = (~done) & (den > 0.02)
    fill[take] = (num / np.maximum(den, 1e-6)[..., None])[take]; done |= take
t = np.clip((A - 160 / 255) / (1 - 160 / 255), 0, 1)[..., None]   # 0 below alpha 160, 1 at opaque
edge = ((A > 0) & (A < 0.999))[..., None]
rgb = np.where(edge, rgb * t + fill * (1 - t), rgb)
rgb = rgb * (A > 0)[..., None]
out = np.dstack([np.clip(rgb, 0, 1), A])
Image.fromarray(np.round(out * 255).astype(np.uint8), 'RGBA').save(dst, optimize=True)
print('ok', dst)
