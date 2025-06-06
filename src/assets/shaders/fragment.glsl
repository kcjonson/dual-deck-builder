precision mediump float;

uniform sampler2D uTexture;
uniform vec4 uColor;
uniform bool uUseTexture;
uniform vec4 uStrokeColor;
uniform float uStrokeWidth; // In UV space (0-1), 0 means no stroke
uniform vec2 uShapeSize; // Size of the shape in pixels for proper stroke scaling

varying vec2 vTexCoord;

void main() {
  if (uUseTexture) {
    vec4 texColor = texture2D(uTexture, vTexCoord);
    // For font atlas, use the texture's alpha channel for smooth anti-aliasing
    gl_FragColor = vec4(uColor.rgb, texColor.r * uColor.a);
  } else {
    // Check if we have a stroke
    if (uStrokeWidth > 0.0) {
      // Calculate distance from edge in UV space
      vec2 edgeDist = min(vTexCoord, vec2(1.0) - vTexCoord);
      float minDist = min(edgeDist.x, edgeDist.y);
      
      // Convert stroke width from pixels to UV space
      vec2 pixelToUV = vec2(1.0) / uShapeSize;
      float strokeInUV = uStrokeWidth * min(pixelToUV.x, pixelToUV.y);
      
      // Smooth transition for anti-aliasing
      float halfPixel = 0.5 * min(pixelToUV.x, pixelToUV.y);
      
      if (minDist < strokeInUV) {
        // We're in the stroke region
        // Add anti-aliasing at the inner edge of the stroke
        float innerEdge = strokeInUV - halfPixel;
        float strokeAlpha = smoothstep(innerEdge - halfPixel, innerEdge + halfPixel, minDist);
        gl_FragColor = mix(uStrokeColor, uColor, strokeAlpha);
      } else {
        gl_FragColor = uColor;
      }
    } else {
      gl_FragColor = uColor;
    }
  }
}
