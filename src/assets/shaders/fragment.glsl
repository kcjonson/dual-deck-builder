precision mediump float;

uniform sampler2D uTexture;
uniform vec4 uColor;
uniform bool uUseTexture;

varying vec2 vTexCoord;

void main() {
  if (uUseTexture) {
    vec4 texColor = texture2D(uTexture, vTexCoord);
    // For font atlas, use the texture's alpha channel for smooth anti-aliasing
    gl_FragColor = vec4(uColor.rgb, texColor.r * uColor.a);
  } else {
    gl_FragColor = uColor;
  }
}
