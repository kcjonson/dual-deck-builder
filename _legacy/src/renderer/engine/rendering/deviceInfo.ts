/**
 * R15.3's feature detection, once at init, and the identity R13.20 and R15.31
 * want in the perf snapshot. Nothing here is required for rendering: each
 * feature's consumer (the GPU timer of chapter 13, parallel compile) checks
 * the flag and degrades.
 */
export interface DeviceInfo {
	/** R15.31: which backend drew the frame. */
	backend: 'webgl2';
	/** `UNMASKED_VENDOR_WEBGL` where `WEBGL_debug_renderer_info` exposes it, else the masked `VENDOR`. */
	vendor: string | null;
	/** `UNMASKED_RENDERER_WEBGL`, e.g. "ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device ...))". */
	renderer: string | null;
	features: {
		/** `EXT_disjoint_timer_query_webgl2`: the GPU timer (chapter 13). */
		timerQuery: boolean;
		/** `KHR_parallel_shader_compile`: non-blocking compile status. */
		parallelShaderCompile: boolean;
		/** `WEBGL_debug_renderer_info`: whether `vendor` and `renderer` are the unmasked strings. */
		debugRendererInfo: boolean;
	};
}

/**
 * `getExtension` enables what it returns, which is harmless for all three.
 * The two `getParameter` reads are synchronous, which is why they happen here
 * and never in the frame loop (R15.22).
 */
export function detectDevice(gl: WebGL2RenderingContext): DeviceInfo {
	const timerQuery = gl.getExtension('EXT_disjoint_timer_query_webgl2') !== null;
	const parallelShaderCompile = gl.getExtension('KHR_parallel_shader_compile') !== null;
	const debug = gl.getExtension('WEBGL_debug_renderer_info') as WEBGL_debug_renderer_info | null;

	const read = (parameter: number): string | null => {
		const value: unknown = gl.getParameter(parameter);
		return typeof value === 'string' && value.length > 0 ? value : null;
	};

	return {
		backend: 'webgl2',
		vendor: read(debug ? debug.UNMASKED_VENDOR_WEBGL : gl.VENDOR),
		renderer: read(debug ? debug.UNMASKED_RENDERER_WEBGL : gl.RENDERER),
		features: { timerQuery, parallelShaderCompile, debugRendererInfo: debug !== null },
	};
}
