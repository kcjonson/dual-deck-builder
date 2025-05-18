// Jest setup file
global.requestAnimationFrame = callback => setTimeout(callback, 0);
global.cancelAnimationFrame = id => clearTimeout(id);

// Mock WebGL context
global.WebGLRenderingContext = {
  VERTEX_SHADER: 'VERTEX_SHADER',
  FRAGMENT_SHADER: 'FRAGMENT_SHADER',
  COMPILE_STATUS: 'COMPILE_STATUS',
  LINK_STATUS: 'LINK_STATUS',
};

// Add any additional Jest setup code here
