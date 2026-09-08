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
