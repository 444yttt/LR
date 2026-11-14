# Vehicle images — sources, licenses, and edits

All three side profiles are photographs from Wikimedia Commons, used under the license stated on each file page
(checked through the Commons API on 2026-11-14; the SHA-1 of each downloaded original matched the API).
The modified files keep the same license. They are credited in the app under **＋ (Add vehicle) → Image credits**,
which links to each source page (`src/credits.ts`).

The pipeline scripts are in `pipeline/` (see its README). Every image also went through a final **edge pass** (`pipeline/edges.py`). Anti-aliased fringe pixels with alpha < 160 take the colour of the nearest opaque car pixels, and alpha 160–254 blends toward it. Background colour therefore cannot survive in the fringe.

Shared conventions (same as the earlier generated assets): car faces left, pure side view, RGBA PNG with true alpha,
tightly cropped to the car (no padding), with the tyre contact line on the bottom edge. No floor, ground shadow, or
reflection is baked in. The app draws the floor ellipse and contact shadow as separate layers (`src/ui/stage.tsx`).

| File | Vehicle / colour | Size (px) |
|---|---|---|
| `range-rover-l460.png` | Land Rover Range Rover (L460, LWB), Santorini Black, dark trim and wheels | 1760 × 675 |
| `ferrari-296.png` | Ferrari 296, recoloured white (target: **Bianco Avus**) | 1779 × 542 |
| `bmw-x7.png` | BMW X7 (G07 LCI), black, dark wheels | 1759 × 649 |

## range-rover-l460.png

- **Source:** https://commons.wikimedia.org/wiki/File:Land_Rover_Range_Rover_P530_Autobiography_LWB_L460_Santorini_Black_(10).jpg
- **Original:** https://upload.wikimedia.org/wikipedia/commons/c/cc/Land_Rover_Range_Rover_P530_Autobiography_LWB_L460_Santorini_Black_%2810%29.jpg (3918 × 2939, SHA-1 `b2cf9be39b743277335b4bd127a68e2ba3c488de`)
- **Author:** Damian B Oh (own work)
- **License:** CC BY-SA 4.0 — https://creativecommons.org/licenses/by-sa/4.0/. This modified image is shared under CC BY-SA 4.0 as well.
- **Edits:**
  - Background removed with BiRefNet (general) segmentation. Edge pixels were colour-decontaminated (closed-form unmix against the propagated background), with no light halo.
  - Floor, ground shadow, and cables below the sill line removed. Tyres kept as solid hulls.
  - Rotated −0.14° so both tyre contact points sit on one line, then mirrored horizontally so the car faces left like the other assets.
  - Side glass given a privacy tint (highlights compressed, 40 % desaturated). This hides the showroom, trees, and window stickers seen through the glass.
  - Satin-silver side vent blade and its script darkened to gloss black; machined alloy wheel faces darkened to dark gunmetal; raised tyre-sidewall lettering softened, so the mirrored text is unreadable.
  - Cropped to the alpha bounding box and resampled (premultiplied, area filter) ×0.584.
  - The paint was already black (Santorini Black), so no body recolouring was needed.

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

## bmw-x7.png

- **Source:** https://commons.wikimedia.org/wiki/File:Moscow,_BMW_SUV,_Moskovsky-117_dredger,_May_2026_02.jpg
- **Original:** https://upload.wikimedia.org/wikipedia/commons/6/6f/Moscow%2C_BMW_SUV%2C_Moskovsky-117_dredger%2C_May_2026_02.jpg (5190 × 3306, SHA-1 `ecd14ec63d0d303a3292f63fc54a4927ef1e2216`)
- **Author:** Retired electrician (own work)
- **License:** CC0 1.0 (public domain dedication) — http://creativecommons.org/publicdomain/zero/1.0/. No attribution is required; it is credited anyway.
- **Vehicle check:** the file is titled "BMW SUV". The car is a BMW X7 G07 LCI (2022+): split headlights, large kidney grille, three side windows, and an X7 roofline.
- **Edits:**
  - Background removed (BiRefNet) and edges decontaminated as above. Floor and ground shadow removed; 104 px of enclosed mask holes filled.
  - Blue cast of the dark paint reduced by 75 %, giving neutral black. The M badge was left untouched.
  - Green foliage seen through the top of the windscreen desaturated, so it reads as glass.
  - Alloy wheel faces darkened to dark gunmetal / black. Centre roundels kept.
  - Rotated +0.74° to level the contact points. Cropped and resampled ×0.390. Not mirrored (already facing left).

## Verification

`test/vehicleAssets.test.ts` decodes each PNG and checks the following:

- it is 8-bit RGBA at the size recorded in `src/vehicleGeometry.ts`;
- all four corners are fully transparent;
- the crop is tight (every edge touches the car);
- there are no detached alpha islands;
- there is no light halo (semi-transparent edge pixels are not brighter than the opaque pixels next to them).

`/workspace/nostos/shots/polish/assets-verify.txt` has the full numbers.
