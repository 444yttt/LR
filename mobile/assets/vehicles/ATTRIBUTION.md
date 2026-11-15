# Vehicle images — sources, licenses, and edits

The Range Rover and BMW X7 side profiles are **owner-supplied**. The app owner provided them, along with their source and licence
(listed in `ownerSuppliedImages` in `src/credits.ts`). They are not credited in the app.

The Ferrari 296 is a photograph from Wikimedia Commons, used under the license stated on its file page
(checked through the Commons API on 2026-11-14; the SHA-1 of the downloaded original matched the API).
The modified file keeps the same license. It is credited in the app under **＋ (Add vehicle) → Image credits**,
which links to the source page (`src/credits.ts`).

The pipeline scripts are in `pipeline/` (see its README). Every image also went through a final **edge pass** (`pipeline/edges.py`). Anti-aliased fringe pixels with alpha < 160 take the colour of the nearest opaque car pixels, and alpha 160–254 blends toward it. Background colour therefore cannot survive in the fringe.

Shared conventions (same as the earlier generated assets): car faces left, pure side view, RGBA PNG with true alpha,
tightly cropped to the car (no padding), with the tyre contact line on the bottom edge. No floor, ground shadow, or
reflection is baked in. The app draws the floor ellipse and contact shadow as separate layers (`src/ui/stage.tsx`).

| File | Vehicle / colour | Size (px) |
|---|---|---|
| `range-rover-l460.png` | Range Rover (L460), black, dark wheels (owner-supplied) | 1570 × 618 |
| `ferrari-296.png` | Ferrari 296, recoloured white (target: **Bianco Avus**) | 1779 × 542 |
| `bmw-x7.png` | BMW X7 (G07), black, dark wheels (owner-supplied) | 1629 × 641 |

## range-rover-l460.png

- **Source:** owner-supplied. The app owner provided the image, its source, and its licence. File: `range-rover-black-owner.png`, 1672 × 941 RGBA, transparent background, facing left.
- **Edits** (`pipeline/owner.py`, then `pipeline/edges.py`):
  - Removed the near-transparent haze (alpha 1–15) spread across the canvas, including a faint ground shadow. Only the car's own blob and a 2 px anti-aliased ring are kept.
  - Body alpha snapped from 249–254 to 255, so the floor no longer shows through the paint.
  - Trimmed the ground haze under the tyres and cropped to the alpha bounding box (no padding). Both tyres already touched the same row, so no levelling was needed. Not mirrored, not resampled.
  - Edge pass: the fringe was already dark (no white halo). It now takes the car's own colour.

## bmw-x7.png

- **Source:** owner-supplied. The app owner provided the image, its source, and its licence. File: `bmw-x7-black-owner.png`, 1672 × 941 RGBA, transparent background, facing left.
- **Edits** (`pipeline/owner.py`, then `pipeline/edges.py`):
  - The same haze removal, body-alpha snap, ground trim, and tight crop as the Range Rover. Already level; not mirrored, not resampled.
  - The cut-out had see-through openings between the spokes of both wheels (1 270 px), where the floor would show through. These were made opaque and inpainted from the surrounding wheel, so the tyres stay solid hulls. The gap between the roof rail and the roof is a real opening and stays transparent.
  - Edge pass as above. No white halo was found.

## ferrari-296.png

- **Source:** https://commons.wikimedia.org/wiki/File:Red_Ferrari_Brickell,_Miami_Florida_March_2026.jpg
- **Original:** https://upload.wikimedia.org/wikipedia/commons/3/3d/Red_Ferrari_Brickell%2C_Miami_Florida_March_2026.jpg (5199 × 3899, SHA-1 `cd6c8ae1e3c518fbc41326944fc37fcecf62cfe2`)
- **Author:** Phillip Pessar (via Flickr, https://www.flickr.com/photos/southbeachcars/55161385527/)
- **License:** CC BY 4.0 — https://creativecommons.org/licenses/by/4.0/
- **Edits:**
  - Background removed (BiRefNet) and edges decontaminated as above. Floor and ground shadow below the sill removed.
  - **Recoloured red → white.** No suitably licensed side photo of a white 296 was found. In linear light the red paint's diffuse shading (R − min(G, B)) was scaled ×1.5 and mapped onto a neutral, very slightly warm white (sRGB ≈ `#FFFEF9`). The specular / reflection component (min(G, B)) was kept, so reflections and highlights stay photographic. The Scuderia shield badge, yellow calipers, lights, glass, tyres, wheels, and carbon trim were left untouched.
  - Target white: **Bianco Avus**, Ferrari's standard solid white. The owner wrote 「ビアンコバードゲージ」, which does not match a Ferrari paint name we could identify. **Needs owner confirmation.** If it should be Bianco Cervino, Bianco Italia (tri-coat), or another white, the recolour target is the `white` constant in `pipeline/build.py`.
  - Rotated −0.33° to level the contact points. Cropped and resampled ×0.411. Not mirrored (already facing left).

## Verification

`test/vehicleAssets.test.ts` decodes each PNG and checks the following:

- it is 8-bit RGBA at the size recorded in `src/vehicleGeometry.ts`;
- all four corners are fully transparent;
- the crop is tight (every edge touches the car);
- there are no detached alpha islands;
- there is no light halo (semi-transparent edge pixels are not brighter than the opaque pixels next to them).

`/workspace/nostos/shots/polish/assets-verify.txt` has the full numbers.
