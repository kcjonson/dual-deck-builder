#version 300 es
// highp because R15.6 requires it: GLSL ES 3.00 has no default fragment float
// precision, and mediump is 16-bit on mobile.
precision highp float;

// Mode 0 is a flat or bordered shape, mode 1 a glyph sampled from unit 0. Both
// branches are the WebGL1 shader's arithmetic, reading varyings that are
// constant across each quad where it read uniforms.
uniform sampler2D uTexture;

in vec2 vTexCoord;
in vec4 vColor;
in vec4 vStrokeColor;
in vec2 vShapeSize; // Size of the shape in pixels for proper stroke scaling
in vec2 vStroke;    // border width in pixels (0 means none), mode

out vec4 fragColor;

void main() {
  if (vStroke.y > 0.5) {
    vec4 texColor = texture(uTexture, vTexCoord);
    // For font atlas, use the texture's alpha channel for smooth anti-aliasing
    fragColor = vec4(vColor.rgb, texColor.r * vColor.a);
  } else {
    // Check if we have a stroke
    if (vStroke.x > 0.0) {
      // Calculate distance from edge in UV space
      vec2 edgeDist = min(vTexCoord, vec2(1.0) - vTexCoord);
      float minDist = min(edgeDist.x, edgeDist.y);

      // Convert stroke width from pixels to UV space
      vec2 pixelToUV = vec2(1.0) / vShapeSize;
      float strokeInUV = vStroke.x * min(pixelToUV.x, pixelToUV.y);

      // Smooth transition for anti-aliasing
      float halfPixel = 0.5 * min(pixelToUV.x, pixelToUV.y);

      if (minDist < strokeInUV) {
        // We're in the stroke region
        // Add anti-aliasing at the inner edge of the stroke
        float innerEdge = strokeInUV - halfPixel;
        float strokeAlpha = smoothstep(innerEdge - halfPixel, innerEdge + halfPixel, minDist);
        fragColor = mix(vStrokeColor, vColor, strokeAlpha);
      } else {
        fragColor = vColor;
      }
    } else {
      fragColor = vColor;
    }
  }
}
