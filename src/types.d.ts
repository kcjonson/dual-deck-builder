declare module '*.glsl' {
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

// Build-time flag from webpack DefinePlugin; false in production builds.
declare const __DEV_TOOLS__: boolean;

// Build-time stamp from webpack DefinePlugin; null outside production builds.
declare const __BUILD_SHA__: string | null;
declare const __BUILD_NUMBER__: string | null;

// Bundler asset modules (R15.34): a URL in the web build, a data URI in the
// Electron renderer.
declare module '*.png' {
	const url: string;
	export default url;
}
