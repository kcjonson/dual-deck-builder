#!/usr/bin/env bash
# Regenerates the MSDF font atlases under src/assets/fonts/ (spec section 5,
# R6.2, R6.4a). Run by hand when a face or charset.txt changes, then commit the
# PNG and JSON it writes; CI never runs this. See src/assets/fonts/README.md for
# installing msdf-atlas-gen. Windows: scripts/build-fonts.ps1.
set -euo pipefail

PINNED_VERSION="v1.4.0"
FONTS_DIR="$(cd "$(dirname "$0")/../src/assets/fonts" && pwd)"
TOOL="${MSDF_ATLAS_GEN:-msdf-atlas-gen}"

if ! command -v "$TOOL" >/dev/null 2>&1; then
	echo "msdf-atlas-gen not found. Install it (brew install msdf-atlas-gen) or set MSDF_ATLAS_GEN to its path." >&2
	exit 1
fi

# A different generator version produces different pixels for the same input,
# so the committed atlases would churn for no reason.
VERSION_LINE="$("$TOOL" -version 2>&1 | head -n 1)"
if [[ "$VERSION_LINE" != *"$PINNED_VERSION"* && -z "${MSDF_ATLAS_GEN_ANY_VERSION:-}" ]]; then
	echo "Expected msdf-atlas-gen $PINNED_VERSION, found: $VERSION_LINE" >&2
	echo "Set MSDF_ATLAS_GEN_ANY_VERSION=1 to build anyway, and bump PINNED_VERSION in both build-fonts scripts if you commit the result." >&2
	exit 1
fi

# output basename | source face relative to FONTS_DIR | name written into the JSON
FACES=(
	"open-sans-regular|open-sans/OpenSans-Regular.ttf|Open Sans"
	"jetbrains-mono-regular|jetbrains-mono/JetBrainsMono-Regular.ttf|JetBrains Mono"
)

for face in "${FACES[@]}"; do
	IFS='|' read -r output source name <<<"$face"
	echo "== $output ($source)"
	"$TOOL" \
		-font "$FONTS_DIR/$source" \
		-fontname "$name" \
		-charset "$FONTS_DIR/charset.txt" \
		-type mtsdf \
		-size 48 \
		-pxrange 8 \
		-yorigin top \
		-potr \
		-format png \
		-imageout "$FONTS_DIR/$output.png" \
		-json "$FONTS_DIR/$output.json"
done

echo "Done. Run npm test (fontAtlas tests validate the committed JSON) and commit src/assets/fonts/."
