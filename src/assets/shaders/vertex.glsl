// The legacy WebGL1 program, batched: every value that used to be a per-draw
// uniform is a per-vertex attribute, so many draws share one drawElements.
// The model matrix is rebuilt from the six entries a 2D model can hold and
// multiplied in the same order as before (P * V * M * p), so the GPU does the
// float work the per-draw uniform did. Replaced by the uber shader (DDB-64).
attribute vec2 aPosition;
attribute vec2 aTexCoord;
attribute vec4 aModelLinear;    // model[0], model[1], model[4], model[5]
attribute vec4 aModelTranslate; // model[12], model[13], border width, mode
attribute vec4 aColor;
attribute vec4 aStrokeColor;
attribute vec2 aShapeSize;

uniform mat4 uViewMatrix;
uniform mat4 uProjectionMatrix;

varying vec2 vTexCoord;
varying vec4 vColor;
varying vec4 vStrokeColor;
varying vec2 vShapeSize;
varying vec2 vStroke; // border width, mode

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
