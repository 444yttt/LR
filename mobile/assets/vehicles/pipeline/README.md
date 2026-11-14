# Vehicle asset pipeline

Reproduces `../*.png` from the Wikimedia Commons originals listed in `../ATTRIBUTION.md`.
Requires Python 3 with numpy, opencv-python-headless, Pillow, and onnxruntime, plus the BiRefNet-general ONNX model.
These scripts are not bundled into the app.

1. `seg.py <model.onnx> <original.jpg> x0 y0 x1 y1 <prefix>`: crop around the car and run background segmentation. Writes `<prefix>_rgb.png` and `<prefix>_mask.npy`.
2. `build.py <rr|fer|x7> <workdir> <outdir>`: ground cut, wheel hulls, colour work, edge decontamination, levelling, mirroring, and crop/scale. The per-car crop coordinates are in `CFG`. The Ferrari white target is the `white` constant (Bianco Avus); change it to match a different Ferrari white.
3. `rr_glass.py <in> <out>`: privacy-tints the Range Rover's side glass.
4. `edges.py <in> <out> [x7]`: final edge pass. Fringe pixels take the car's own colour; with `x7` it also neutralises the green seen through the top of the windscreen.
