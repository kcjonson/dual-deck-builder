#version 300 es
// The uber shader's vertex stage (R5.1). Positions arrive in screen space,
// logical pixels, with the transform already applied on the CPU (R5.3), so the
// only per-frame input is the projection. Everything else is passed through:
// the fragment stage selects its behaviour from `aMode`, never from a program
// switch. Layout is `UBER_VERTEX` in UberGeometryEncoder.ts.
layout(location = 0) in vec2 aPosition;
layout(location = 1) in vec2 aLocal;    // shape-local position, from the shape centre
layout(location = 2) in vec2 aHalfSize;
layout(location = 3) in vec2 aTexCoord;
layout(location = 4) in vec4 aRadii;    // top-left, top-right, bottom-right, bottom-left
layout(location = 5) in vec4 aFill;     // premultiplied; per vertex for R5.9's gradients
layout(location = 6) in vec4 aBorder;   // premultiplied
layout(location = 7) in vec4 aClip;     // minX, minY, maxX, maxY (R4.1)
layout(location = 8) in vec4 aShape;    // border width, border outset, sigma or pixel range, opacity
layout(location = 9) in vec4 aMode;     // mode, texture slot, additive, text shadow blur

layout(std140) uniform Frame {
	mat4 uProjection;
};

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
	gl_Position = uProjection * vec4(aPosition, 0.0, 1.0);
	vPosition = aPosition;
	vLocal = aLocal;
	vTexCoord = aTexCoord;
	vFill = aFill;
	vHalfSize = aHalfSize;
	vRadii = aRadii;
	vBorder = aBorder;
	vClip = aClip;
	vShape = aShape;
	vMode = aMode;
}
