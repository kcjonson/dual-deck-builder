# Regenerates the MSDF font atlases under src/assets/fonts/ (spec section 5,
# R6.2, R6.4a). Run by hand when a face or charset.txt changes, then commit the
# PNG and JSON it writes; CI never runs this. See src/assets/fonts/README.md for
# installing msdf-atlas-gen. macOS and Linux: scripts/build-fonts.sh.
$ErrorActionPreference = 'Stop'

$PinnedVersion = 'v1.4.0'
$FontsDir = Resolve-Path (Join-Path $PSScriptRoot '..\src\assets\fonts')
$Tool = if ($env:MSDF_ATLAS_GEN) { $env:MSDF_ATLAS_GEN } else { 'msdf-atlas-gen' }

if (-not (Get-Command $Tool -ErrorAction SilentlyContinue)) {
	Write-Error "msdf-atlas-gen not found. Download the pinned Windows release zip (see src/assets/fonts/README.md) and put it on PATH, or set MSDF_ATLAS_GEN to the exe."
}

# The kerning step reads the face with fontkit (a devDependency) and loads a
# TypeScript module through Node's type stripping: npm ci, Node 22.18 or later.
if (-not (Test-Path (Join-Path $PSScriptRoot '..\node_modules\fontkit'))) {
	Write-Error 'fontkit not installed. Run npm ci first.'
}

# A different generator version produces different pixels for the same input,
# so the committed atlases would churn for no reason.
$VersionLine = (& $Tool -version 2>&1 | Select-Object -First 1) | Out-String
if (-not $VersionLine.Contains($PinnedVersion) -and -not $env:MSDF_ATLAS_GEN_ANY_VERSION) {
	Write-Error "Expected msdf-atlas-gen $PinnedVersion, found: $VersionLine. Set MSDF_ATLAS_GEN_ANY_VERSION=1 to build anyway, and bump the pinned version in both build-fonts scripts if you commit the result."
}

$Faces = @(
	@{ Output = 'barlow-condensed-semibold'; Source = 'barlow-condensed\BarlowCondensed-SemiBold.ttf'; Name = 'Barlow Condensed SemiBold' },
	@{ Output = 'open-sans-regular'; Source = 'open-sans\OpenSans-Regular.ttf'; Name = 'Open Sans' },
	@{ Output = 'jetbrains-mono-regular'; Source = 'jetbrains-mono\JetBrainsMono-Regular.ttf'; Name = 'JetBrains Mono' }
)

foreach ($Face in $Faces) {
	Write-Host "== $($Face.Output) ($($Face.Source))"
	& $Tool `
		-font (Join-Path $FontsDir $Face.Source) `
		-fontname $Face.Name `
		-charset (Join-Path $FontsDir 'charset.txt') `
		-type mtsdf `
		-size 48 `
		-pxrange 8 `
		-yorigin top `
		-potr `
		-format png `
		-imageout (Join-Path $FontsDir "$($Face.Output).png") `
		-json (Join-Path $FontsDir "$($Face.Output).json")
	if ($LASTEXITCODE -ne 0) {
		Write-Error "msdf-atlas-gen failed for $($Face.Output)"
	}
	# msdf-atlas-gen reads only the legacy kern table; these faces kern in GPOS.
	& node --disable-warning=ExperimentalWarning --disable-warning=MODULE_TYPELESS_PACKAGE_JSON `
		(Join-Path $PSScriptRoot 'merge-kerning.mjs') `
		(Join-Path $FontsDir $Face.Source) `
		(Join-Path $FontsDir "$($Face.Output).json")
	if ($LASTEXITCODE -ne 0) {
		Write-Error "merge-kerning failed for $($Face.Output)"
	}
}

Write-Host 'Done. Run npm test (fontAtlas tests validate the committed JSON) and commit src/assets/fonts/.'
