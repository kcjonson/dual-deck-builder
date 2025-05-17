declare module '*.glsl' {
  const content: string;
  export default content;
}

// Also include direct paths to shader files
declare module './assets/shaders/vertex.glsl' {
  const content: string;
  export default content;
}

declare module './assets/shaders/fragment.glsl' {
  const content: string;
  export default content;
}

declare module '*.vert' {
  const content: string;
  export default content;
}

declare module '*.frag' {
  const content: string;
  export default content;
}
