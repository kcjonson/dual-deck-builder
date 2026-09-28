#version 300 es
// The uber shader's fragment stage (R5.1, R5.2). One program for every UI
// primitive; the mode is data. Output is premultiplied (R5.22), blended with
// ONE, ONE_MINUS_SRC_ALPHA.
precision highp float;

const int MODE_FLAT = 0;
const int MODE_RECT = 1;
const int MODE_SHADOW = 2;
const int MODE_CIRCLE = 3;
const int MODE_IMAGE = 4;
const int MODE_TEXT = 5;

// R5.20: a fixed set of units, selected per draw by slot. GLSL ES 3.00 cannot
// index a sampler array dynamically, hence the switch in `sampleSlot`.
const int TEXTURE_UNITS = 8;
uniform sampler2D uTextures[TEXTURE_UNITS];

in highp vec2 vPosition;
in highp vec2 vLocal;
in vec2 vTexCoord;
in vec4 vFill;
flat in vec2 vHalfSize;
flat in vec4 vRadii;
flat in vec4 vBorder;
flat in vec4 vClip;
flat in vec4 vShape;
flat in vec4 vMode;

out vec4 fragColor;

// Explicit gradients, taken in uniform control flow, so a mipmapped texture
// sampled inside the mode branch still selects the right level.
vec4 sampleSlot(int slot, vec2 uv, vec2 dx, vec2 dy) {
	switch (slot) {
		case 0: return textureGrad(uTextures[0], uv, dx, dy);
		case 1: return textureGrad(uTextures[1], uv, dx, dy);
		case 2: return textureGrad(uTextures[2], uv, dx, dy);
		case 3: return textureGrad(uTextures[3], uv, dx, dy);
		case 4: return textureGrad(uTextures[4], uv, dx, dy);
		case 5: return textureGrad(uTextures[5], uv, dx, dy);
		case 6: return textureGrad(uTextures[6], uv, dx, dy);
		case 7: return textureGrad(uTextures[7], uv, dx, dy);
	}
	return vec4(0.0);
}

// R5.7a: the radius of the quadrant `p` is in, y down.
float cornerRadius(vec2 p, vec4 radii) {
	vec2 side = p.x > 0.0 ? radii.yz : radii.xw; // (top, bottom) of this side
	return p.y > 0.0 ? side.y : side.x;
}

// R5.5: Inigo Quilez's sdRoundedBox, radii already clamped to the half extent.
float sdRoundedBox(vec2 p, vec2 halfSize, vec4 radii) {
	float r = cornerRadius(p, radii);
	vec2 q = abs(p) - halfSize + r;
	return min(max(q.x, q.y), 0.0) + length(max(q, 0.0)) - r;
}

// R5.6: the linear one-pixel ramp, the box-filter coverage of a straight edge.
float coverage(float d, float w) {
	return clamp(0.5 - d / w, 0.0, 1.0);
}

// R5.12: Evan Wallace's rounded-box shadow. Closed form (erf) across x, four
// samples of the Gaussian along y, sigma = blur / 2.
vec2 erf2(vec2 x) {
	vec2 s = sign(x);
	vec2 a = abs(x);
	x = 1.0 + (0.278393 + (0.230389 + 0.078108 * (a * a)) * a) * a;
	x *= x;
	return s - s / (x * x);
}

float gaussian(float x, float sigma) {
	const float pi = 3.141592653589793;
	return exp(-(x * x) / (2.0 * sigma * sigma)) / (sqrt(2.0 * pi) * sigma);
}

float shadowX(float x, float y, float sigma, float corner, vec2 halfSize) {
	float delta = min(halfSize.y - corner - abs(y), 0.0);
	float curved = halfSize.x - corner + sqrt(max(0.0, corner * corner - delta * delta));
	vec2 integral = 0.5 + 0.5 * erf2((x + vec2(-curved, curved)) * (sqrt(0.5) / sigma));
	return integral.y - integral.x;
}

float roundedBoxShadow(vec2 p, vec2 halfSize, float sigma, float corner) {
	float low = p.y - halfSize.y;
	float high = p.y + halfSize.y;
	float start = clamp(-3.0 * sigma, low, high);
	float end = clamp(3.0 * sigma, low, high);
	float step = (end - start) / 4.0;
	float y = start + step * 0.5;
	float value = 0.0;
	for (int i = 0; i < 4; i++) {
		value += shadowX(p.x, p.y - y, sigma, corner, halfSize) * gaussian(y, sigma) * step;
		y += step;
	}
	return value;
}

float median3(vec3 v) {
	return max(min(v.r, v.g), min(max(v.r, v.g), v.b));
}

void main() {
	// Derivatives first, while every fragment of the quad is still running.
	vec2 localDx = dFdx(vLocal);
	vec2 localDy = dFdy(vLocal);
	vec2 uvDx = dFdx(vTexCoord);
	vec2 uvDy = dFdy(vTexCoord);

	// R4.4: half-open, on the interpolated logical position.
	if (vPosition.x < vClip.x || vPosition.x >= vClip.z || vPosition.y < vClip.y || vPosition.y >= vClip.w) {
		discard;
	}

	int mode = int(vMode.x + 0.5);
	int slot = int(vMode.y + 0.5);
	// R5.6: the device-pixel footprint of one local unit. Exact under
	// translation, rotation and uniform scale; the mean of the two axes under
	// a non-uniform scale.
	float w = sqrt(0.5 * (dot(localDx, localDx) + dot(localDy, localDy)));

	vec4 color;
	float covered = 1.0;

	if (mode == MODE_RECT || mode == MODE_CIRCLE) {
		// R5.8: border and fill composited by exact area coverage.
		float width = vShape.x;
		float outset = vShape.y;
		float inset = width - outset;
		bool circle = mode == MODE_CIRCLE;
		float dShape = circle ? length(vLocal) - vHalfSize.x : sdRoundedBox(vLocal, vHalfSize, vRadii);
		float co = coverage(dShape - outset, w);
		float ci = co;
		if (width > 0.0) {
			vec2 innerHalf = vHalfSize - inset;
			if (innerHalf.x <= 0.0 || innerHalf.y <= 0.0) {
				ci = 0.0;
			} else {
				float dInner = circle
					? length(vLocal) - innerHalf.x
					: sdRoundedBox(vLocal, innerHalf, max(vRadii - inset, 0.0));
				ci = min(coverage(dInner, w), co);
			}
		}
		vec4 borderRegion = vBorder + vFill * (1.0 - vBorder.a);
		color = ci * vFill + (co - ci) * borderRegion;
		covered = co;
	} else if (mode == MODE_SHADOW) {
		float sigma = vShape.z;
		float alpha = sigma < 0.5 * w
			? coverage(sdRoundedBox(vLocal, vHalfSize, vRadii), w)
			: roundedBoxShadow(vLocal, vHalfSize, sigma, cornerRadius(vLocal, vRadii));
		color = vFill * alpha;
		covered = alpha;
	} else if (mode == MODE_IMAGE) {
		// R5.18: premultiplied texels times a premultiplied tint.
		color = sampleSlot(slot, vTexCoord, uvDx, uvDy) * vFill;
	} else if (mode == MODE_TEXT) {
		// R6.5: median-of-three MSDF coverage with the linear one-pixel ramp.
		// vShape.z is the screen-space distance range in device pixels,
		// computed at submission under a translate-only transform; zero
		// means derive it here from the texture coordinate's footprint, with
		// the atlas's unit range (range over atlas size) in vHalfSize, as
		// msdfgen's reference shader does. Either way at least 1 (R6.4a).
		vec4 texel = sampleSlot(slot, vTexCoord, uvDx, uvDy);
		float range = vShape.z;
		if (range <= 0.0) {
			vec2 screenTexSize = vec2(1.0) / max(abs(uvDx) + abs(uvDy), vec2(1e-6));
			range = max(0.5 * dot(vHalfSize, screenTexSize), 1.0);
		}
		float alpha;
		if (vMode.w > 0.0) {
			// R6.6's blurred shadow run: the mtsdf alpha channel is a true
			// distance, so it stays smooth away from the outline, out to half
			// the atlas range; vMode.w is the blur in device pixels.
			float distance = (texel.a - 0.5) * range;
			alpha = smoothstep(-vMode.w, vMode.w, distance);
		} else {
			alpha = clamp(range * (median3(texel.rgb) - 0.5) + 0.5, 0.0, 1.0);
		}
		color = vFill * alpha;
		covered = alpha;
	} else {
		// MODE_FLAT (R5.2): vertex colour only, no SDF.
		color = vFill;
	}

	// R5.23: discard on coverage, never on colour alpha.
	if (covered < 1.0 / 1024.0) discard;

	color *= vShape.w;
	// R5.22a: additive is `over` with the output alpha forced to zero.
	if (vMode.z > 0.5) color.a = 0.0;
	fragColor = color;
}
