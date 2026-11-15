# owner.py in.png out.png : prepares an owner-supplied cut-out (RGBA, straight alpha, car facing left, already level).
# 1. Drops the near-transparent haze around the car: only the largest alpha >= 16 blob plus a 2 px fringe ring stays.
# 2. Makes see-through wheel openings solid (enclosed holes in the lower half; the roof-rail gap stays open) and fills
#    their colour from the surrounding wheel by inpainting, so the floor layer never shows through a wheel.
# 3. Snaps the body to full opacity (the supplied body alpha is 249-254, which would let the floor bleed through).
# 4. Trims the ground haze under the tyres, drops detached specks, and crops to the alpha bounding box with no
#    padding, so the tyre contact line is the bottom edge (one anti-aliased row, like the other assets).
# Run edges.py on the result afterwards.
import sys, numpy as np, cv2
from PIL import Image

src, dst = sys.argv[1:3]
im = np.asarray(Image.open(src).convert('RGBA')).copy()
rgb, a = im[..., :3].copy(), im[..., 3].copy()
H = a.shape[0]

k, lab, st, _ = cv2.connectedComponentsWithStats((a >= 16).astype(np.uint8), connectivity=4)
car = (lab == 1 + np.argmax(st[1:, 4])).astype(np.uint8)
a[cv2.dilate(car, np.ones((5, 5), np.uint8)) == 0] = 0

k, lab, st, c = cv2.connectedComponentsWithStats((a < 128).astype(np.uint8), connectivity=4)
border = set(np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]])))
holes = np.zeros_like(car)
for i in range(1, k):
    if i not in border and c[i][1] > H / 2: holes[lab == i] = 1
if holes.any():
    holes = cv2.dilate(holes, np.ones((5, 5), np.uint8)) & (a < 255)
    rgb = cv2.inpaint(np.ascontiguousarray(rgb), holes, 6, cv2.INPAINT_TELEA)
    a[holes > 0] = 255
print('wheel-opening px filled:', int(holes.sum()))

inner = cv2.erode((a >= 16).astype(np.uint8), np.ones((9, 9), np.uint8)) > 0
lower = np.zeros_like(inner); lower[H // 2:] = True
a[(a >= 245) | (inner & lower)] = 255

# Ground line: keep one anti-aliased row below the lowest solid tyre row; the faint ground haze under it goes.
a[np.nonzero((a >= 128).any(1))[0].max() + 2:] = 0
k, lab, st, _ = cv2.connectedComponentsWithStats((a > 0).astype(np.uint8), connectivity=4)
a[lab != 1 + np.argmax(st[1:, 4])] = 0   # only the car's own blob (4-connected) survives
ys, xs = np.nonzero(a)
y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
rgb[a == 0] = 0
out = np.dstack([rgb, a])[y0:y1, x0:x1]
Image.fromarray(out, 'RGBA').save(dst, optimize=True)
print('crop', (x0, y0, x1, y1), '->', out.shape[1], 'x', out.shape[0])
