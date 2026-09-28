#version 300 es
// The uber shader's vertex stage (R5.1). One instance is one quad (R5.4): its
// six vertices come from gl_VertexID and every attribute is per instance, so
// there is no index buffer. Positions arrive in screen space, logical pixels,
// with the transform already applied on the CPU (R5.3); the only per-frame
// input is the projection. The fragment stage selects its behaviour from the
// mode, never from a program switch. Layout is `UBER_INSTANCE` in
// UberGeometryEncoder.ts.
layout(location = 0) in vec4 aCorners01;  // top-left xy, top-right xy
layout(location = 1) in vec4 aCorners23;  // bottom-right xy, bottom-left xy
layout(location = 2) in vec4 aGeometry;   // half size, quad extent; or u0 v0 u1 v1 (image, text)
layout(location = 3) in vec4 aClip;       // minX, minY, maxX, maxY (R4.1)
layout(location = 4) in vec4 aRadii;      // half floats: tl, tr, br, bl; the atlas unit range for text
layout(location = 5) in vec4 aColor0;     // premultiplied, per corner (R5.9, R5.17)
layout(location = 6) in vec4 aColor1;
layout(location = 7) in vec4 aColor2;
layout(location = 8) in vec4 aColor3;
layout(location = 9) in vec4 aBorder;     // premultiplied
layout(location = 10) in vec4 aShape;     // border width (text: blur), outset, sigma or range, opacity
layout(location = 11) in uvec4 aMode;     // mode, texture slot, flags, unused

layout(std140) uniform Frame {
	mat4 uProjection;
};

const uint MODE_IMAGE = 4u;
const uint MODE_TEXT = 5u;
const uint FLAG_ADDITIVE = 1u;

// Two triangles over the corners, top-left, top-right, bottom-right,
// bottom-left: (0, 1, 2) and (0, 2, 3), the order the indexed quads used.
const int QUAD_CORNERS[6] = int[6](0, 1, 2, 0, 2, 3);

// R4.4: highp, the untransformed screen-space position the clip is tested on.
out highp vec2 vPosition;
out highp vec2 vLocal;
out vec2 vTexCoord;
out vec4 vFill;
flat out vec2 vHalfSize;
flat out vec4 vRadii;
flat out vec4 vBorder;
flat out vec4 vClip;
flat out vec4 vShape;
flat out vec4 vMode;

void main() {
	int corner = QUAD_CORNERS[gl_VertexID];
	bool right = corner == 1 || corner == 2;
	bool bottom = corner >= 2;

	vec2 position;
	if (corner == 0) {
		position = aCorners01.xy;
		vFill = aColor0;
	} else if (corner == 1) {
		position = aCorners01.zw;
		vFill = aColor1;
	} else if (corner == 2) {
		position = aCorners23.xy;
		vFill = aColor2;
	} else {
		position = aCorners23.zw;
		vFill = aColor3;
	}

	gl_Position = uProjection * vec4(position, 0.0, 1.0);
	vPosition = position;
	vBorder = aBorder;
	vClip = aClip;

	bool text = aMode.x == MODE_TEXT;
	if (aMode.x == MODE_IMAGE || text) {
		vTexCoord = vec2(right ? aGeometry.z : aGeometry.x, bottom ? aGeometry.w : aGeometry.y);
		vLocal = vec2(0.0);
		vHalfSize = text ? aRadii.xy : vec2(0.0);
		vRadii = vec4(0.0);
	} else {
		vTexCoord = vec2(0.0);
		vLocal = vec2(right ? 1.0 : -1.0, bottom ? 1.0 : -1.0) * aGeometry.zw;
		vHalfSize = aGeometry.xy;
		vRadii = aRadii;
	}

	// The fragment stage's view: shape is (border width, outset, sigma or
	// range, opacity) and mode is (mode, slot, additive, text shadow blur).
	vShape = vec4(text ? 0.0 : aShape.x, aShape.yzw);
	vMode = vec4(float(aMode.x), float(aMode.y), (aMode.z & FLAG_ADDITIVE) != 0u ? 1.0 : 0.0, text ? aShape.x : 0.0);
}
