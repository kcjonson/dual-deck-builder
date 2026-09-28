#version 300 es
// The legacy program in GLSL ES 3.00 (R15.6), batched: every value that used
// to be a per-draw uniform is a per-vertex attribute, so many draws share one
// drawElements. The model matrix is rebuilt from the six entries a 2D model can
// hold and multiplied in the same order as the WebGL1 program (P * V * M * p),
// so the GPU does the same float work. The projection and view come from the
// per-frame uniform block (R15.15) instead of two uniforms. Replaced by the
// uber shader (DDB-64).
layout(location = 0) in vec2 aPosition;
layout(location = 1) in vec2 aTexCoord;
layout(location = 2) in vec4 aModelLinear;    // model[0], model[1], model[4], model[5]
layout(location = 3) in vec4 aModelTranslate; // model[12], model[13], border width, mode
layout(location = 4) in vec4 aColor;
layout(location = 5) in vec4 aStrokeColor;
layout(location = 6) in vec2 aShapeSize;

layout(std140) uniform Frame {
  mat4 uProjectionMatrix;
  mat4 uViewMatrix;
};

out vec2 vTexCoord;
out vec4 vColor;
out vec4 vStrokeColor;
out vec2 vShapeSize;
out vec2 vStroke; // border width, mode

void main() {
  mat4 model = mat4(
    aModelLinear.x, aModelLinear.y, 0.0, 0.0,
    aModelLinear.z, aModelLinear.w, 0.0, 0.0,
    0.0, 0.0, 1.0, 0.0,
    aModelTranslate.x, aModelTranslate.y, 0.0, 1.0
  );
  gl_Position = uProjectionMatrix * uViewMatrix * model * vec4(aPosition, 0.0, 1.0);
  vTexCoord = aTexCoord;
  vColor = aColor;
  vStrokeColor = aStrokeColor;
  vShapeSize = aShapeSize;
  vStroke = aModelTranslate.zw;
}
