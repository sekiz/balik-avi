#!/usr/bin/env bash
# Re-encode the UI art the game loads (assets/ui/*.png → .webp next to it). The PNGs stay as the
# editable sources (and what assets/src/clean_ui.py writes); the game only requests the .webp.
# Opaque backdrops: lossy q82. Art with alpha: q88 with lossless alpha. Needs `cwebp` (brew install webp).
set -euo pipefail
cd "$(dirname "$0")/../assets/ui"
enc() { cwebp -quiet "$@"; }
for f in reef-backdrop-v1 settings-reef-v3 room-reef room-wreck room-deep; do [ -f "$f.png" ] || continue; enc -q 82 -m 6 -sharp_yuv "$f.png" -o "$f.webp"; done
for f in logo logo-en coin wood-heading-v2 pause-frame-v2; do enc -q 88 -alpha_q 100 -m 6 -sharp_yuv "$f.png" -o "$f.webp"; done
for s in clown tang yellow neon angel puffer parrot lion turtle manta shark goldshark dragon seahorse barracuda lantern octopus kraken jelly eel squid giantsquid; do
  for v in "" "-locked"; do enc -q 88 -alpha_q 100 -m 6 -sharp_yuv "fish-$s$v.png" -o "fish-$s$v.webp"; done
done
for s in treasure mine volt frost; do enc -q 88 -alpha_q 100 -m 6 -sharp_yuv "fish-$s.png" -o "fish-$s.webp"; done # special targets: no silhouette
echo "webp: $(ls *.webp | wc -l | tr -d ' ') files, $(du -ch *.webp | tail -1 | cut -f1)"
