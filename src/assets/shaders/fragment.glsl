precision mediump float;

uniform sampler2D uTexture;
uniform vec4 uColor;
uniform bool uUseTexture;

varying vec2 vTexCoord;

void main() {
  if (uUseTexture) {
    vec4 texColor = texture2D(uTexture, vTexCoord);
    // For font atlas, use the texture's red/white intensity as alpha
    // Since we render white text on black background, use any color channel
    float textAlpha = texColor.r; // or texColor.g or texColor.b, they should be the same for grayscale
    gl_FragColor = vec4(uColor.rgb, textAlpha * uColor.a);
  } else {
    gl_FragColor = uColor;
  }
}
