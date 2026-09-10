import { mat4 } from 'gl-matrix';
import {
	BeginFrameOptions,
	CircleCommand,
	ClipRect,
	DrawApi,
	DrawBackend,
	DrawBatch,
	DrawCommand,
	DrawCommandKind,
	FrameDescription,
	Mat2D,
	PolygonCommand,
	PolylineCommand,
	RGBA,
	RectCommand,
	ResolvedClip,
	TextCommand,
	clipRectOf,
	transformPoint,
} from '../draw';
import { FrameTimer } from './FrameTimer';
import { Renderer } from './Renderer';
import { TextRenderer } from './TextRenderer';
import { DEFAULT_FONT } from './fonts';

/**
 * Phase 1's shim: the whole of the pre-spec WebGL drawing path, behind
 * `DrawBackend`.
 *
 * Every GL body here was moved out of `Renderer` rather than rewritten, so the
 * uniforms, the buffer traffic and the draw calls are the ones the 26 committed
 * screenshot goldens were minted from. `Renderer` keeps what makes it a device
 * (the canvas, the context, the resize handler, the projection and view
 * matrices, the font atlas) and has no drawing methods left, which is how
 * "nothing outside the backend calls `Renderer.draw*`" is enforced by there
 * being nothing to call.
 *
 * It dies with the WebGL2 backend of chapter 15. Deleting this file deletes the
 * legacy path.
 *
 * WHAT THIS BACKEND DOES THAT NO OTHER BACKEND DOES, stated here because it is
 * the one place a reader could be misled. R2.2: "there are no modes to enter
 * (no separate text batch to begin and end). The sibling TypeScript engine had
 * a text batch that opened in the frame loop and flushed on scissor changes,
 * which reordered text above every shape drawn in the same clip scope." That
 * engine is this one. `TextRenderer` still holds runs until `flushText` at the
 * end of a batch, so every text run in a domain paints above every shape in it,
 * and the 26 committed goldens are pictures of that.
 *
 * `RecordingBackend` reports the submitted order, which is the true one, so for
 * the life of one PR two backends disagree about what a frame looked like. The
 * warning lives here rather than in `RecordingBackend.ts` because this is the
 * file that gets deleted; a caveat in a permanent file is a caveat somebody has
 * to remember to remove.
 */

export interface LegacyGLBackendOptions {
	renderer: Renderer;
	frameTimer: FrameTimer;
}

const NO_CLIP: ResolvedClip = { kind: 'none' };
const WHITE: RGBA = [1, 1, 1, 1];
const BLACK: RGBA = [0, 0, 0, 1];

/**
 * A screen-space clip rect as a WebGL scissor box, in device pixels from the
 * bottom left.
 *
 * Lifted expression for expression out of the block being deleted from
 * `Layer.ts`, which read `screenX`, `screenY + height` and `canvas.height / dpr`
 * where this reads `minX`, `maxY` and `canvasHeightDevicePx / ratio`. It takes
 * the canvas height rather than `FrameDescription.viewport.height` on purpose:
 * that is what the old code measured against, so it reflects the last
 * `Renderer.resize` rather than this frame's `window.innerHeight`. The two
 * agree in every captured state; taking the one that already exists removes a
 * class of divergence for free. It switches to the frame's viewport when the
 * WebGL2 backend lands.
 */
export function scissorBox(
	rect: ClipRect,
	ratio: number,
	canvasHeightDevicePx: number,
): { x: number; y: number; width: number; height: number } {
	const logicalHeight = canvasHeightDevicePx / ratio;
	return {
		x: Math.floor(rect.minX * ratio),
		y: Math.floor((logicalHeight - rect.maxY) * ratio),
		width: Math.floor((rect.maxX - rect.minX) * ratio),
		height: Math.floor((rect.maxY - rect.minY) * ratio),
	};
}

/**
 * The frame description both entry points open with. One function so the game
 * page and the gallery cannot disagree about the viewport or the ratio; it
 * moves to chapter 7's mount context when that exists.
 */
export function windowFrame(): BeginFrameOptions {
	return {
		viewport: { width: window.innerWidth, height: window.innerHeight },
		ratio: window.devicePixelRatio || 1,
	};
}

/**
 * The seam, built the same way on both pages. Neither bootstrap spells the
 * options itself, so `legacyTextOrder` cannot be on in one and off in the
 * other, which is the failure mode that would show up as a screenshot diff on
 * seven gallery scenes and nowhere else.
 *
 * Diagnostics go to `console.error` in a development build, which turns any
 * R2.1 finding into a red screenshot spec through the harness's
 * `expectCleanConsole`. That is the enforcement: an unbalanced stack or a text
 * run before its atlas fails loudly instead of quietly.
 *
 * `legacyTextOrder` is the one temporary option and this is its only caller;
 * see `DrawApiOptions.legacyTextOrder` for what it does and when it dies.
 */
export function createLegacyDrawApi({ renderer, frameTimer }: LegacyGLBackendOptions): DrawApi {
	return new DrawApi({
		backend: new LegacyGLBackend({ renderer, frameTimer }),
		development: __DEV_TOOLS__,
		legacyTextOrder: true,
		onDiagnostic: (diagnostic) => {
			console.error(`draw: ${diagnostic.code}: ${diagnostic.message}`);
		},
	});
}

export class LegacyGLBackend implements DrawBackend {
	readonly name = 'legacy-gl';

	private readonly renderer: Renderer;
	private readonly frameTimer: FrameTimer;
	private readonly gl: WebGLRenderingContext;
	private readonly textRenderer: TextRenderer;

	private quadVertexBuffer: WebGLBuffer | null = null;
	private quadIndexBuffer: WebGLBuffer | null = null;
	private dynamicVertexBuffer: WebGLBuffer | null = null;
	private dynamicIndexBuffer: WebGLBuffer | null = null;
	private maxDynamicVertices = 1024; // Support up to 1024 vertices

	/**
	 * The clip the scissor box currently holds, or null for "unknown", which is
	 * what `beginFrame` and `invalidateState` set so the next command
	 * force-applies. Compared by reference: the draw API stamps one resolved
	 * clip object on every command in a scope (R2.5), and every clip push and
	 * pop ends a domain, so this fires exactly once per domain, at its first
	 * command, which is where `enableScissor` fired.
	 */
	private appliedClip: ResolvedClip | null = null;
	private frame: FrameDescription | null = null;
	private readonly unpaintable = new Set<DrawCommandKind>();

	constructor({ renderer, frameTimer }: LegacyGLBackendOptions) {
		this.renderer = renderer;
		this.frameTimer = frameTimer;
		this.gl = renderer.getContext();

		const fontAtlas = renderer.getFontAtlas();
		if (!fontAtlas) {
			throw new Error('LegacyGLBackend requires the renderer font atlas');
		}
		this.textRenderer = new TextRenderer(this.gl, fontAtlas, frameTimer);

		this.initializeBuffers();
	}

	/** R2.18's precondition, answered by the atlas the `Renderer` builds in its constructor. */
	get fontAtlasNames(): readonly string[] {
		return [DEFAULT_FONT];
	}

	beginFrame(frame: FrameDescription): void {
		this.frame = frame;
		this.appliedClip = null;
		this.textRenderer.beginBatch();
	}

	/**
	 * Shapes paint in submission order, then the batch's text.
	 *
	 * The reordering is `TextRenderer`'s, not this loop's: a text command queues
	 * a run and `flushText` below draws all of them, so where a text command
	 * sits in `commands` does not reach a pixel. Sorting the array here as well
	 * was tried and removed; with the barrier in place the full chromium suite
	 * passes either way, so it was machinery that changed nothing. What does
	 * reach a pixel is where a batch ends, and that is `DrawApi`'s barrier.
	 *
	 * Returns null rather than a `GpuWork`, and the distinction matters: the
	 * shape draws could be counted, but the text draws happen inside
	 * `TextRenderer.flush` where this class cannot see them, so any number here
	 * would omit most of a text-heavy frame. R13.5 prefers "nobody counted" to a
	 * partial count, and `FrameTimer` still receives every `recordDrawCall` the
	 * moved bodies always made, so no displayed number changes.
	 */
	submit(batch: DrawBatch): null {
		for (const command of batch.commands) this.paint(command);
		this.flushText();
		return null;
	}

	endFrame(): void {
		// The last domain's text has already flushed under the last applied
		// scissor, matching `disableScissor`'s flush-then-disable. This leaves
		// the scissor off so the next frame's `clear()` covers the canvas.
		this.applyClip(NO_CLIP);
		this.textRenderer.endBatch();
		this.frame = null;
	}

	invalidateState(): void {
		// The legacy path re-sets every uniform and re-binds every buffer on
		// each draw, so the only tracked state is the scissor box.
		this.appliedClip = null;
	}

	createTexture(): never {
		throw new Error('LegacyGLBackend: R2.17 textures arrive with the WebGL2 backend');
	}

	destroyTexture(): never {
		throw new Error('LegacyGLBackend: R2.17 textures arrive with the WebGL2 backend');
	}

	loadFontAtlas(): never {
		throw new Error(
			`LegacyGLBackend: the only atlas is '${DEFAULT_FONT}', built by the Renderer; R11.8's roles arrive in phase 2`,
		);
	}

	// -- painting -----------------------------------------------------------

	private paint(command: DrawCommand): void {
		this.applyClip(command.clip);
		switch (command.kind) {
			case 'rect':
				this.paintRect(command);
				return;
			case 'circle':
				this.paintCircle(command);
				return;
			case 'polygon':
				this.paintPolygon(command);
				return;
			case 'polyline':
				this.paintPolyline(command);
				return;
			case 'text':
				this.paintText(command);
				return;
			default:
				this.reportUnpaintable(command.kind, `no legacy body for '${command.kind}' commands`);
		}
	}

	/**
	 * Once per kind per backend. A silent drop is what R2.1 and R2.18 keep
	 * banning, and a message per command would be a flood; nothing in this
	 * codebase submits a shadow, a line or an image, so this is the report that
	 * says so when someone starts.
	 */
	private reportUnpaintable(kind: DrawCommandKind, detail: string): void {
		if (this.unpaintable.has(kind)) return;
		this.unpaintable.add(kind);
		console.error(`LegacyGLBackend: ${detail}; nothing was drawn`);
	}

	private applyClip(clip: ResolvedClip): void {
		if (this.appliedClip === clip) return;
		this.appliedClip = clip;

		if (clip.kind === 'none') {
			this.gl.disable(this.gl.SCISSOR_TEST);
			return;
		}

		const canvas = this.gl.canvas as HTMLCanvasElement;
		const box = scissorBox(clipRectOf(clip), this.frame?.ratio ?? 1, canvas.height);
		this.gl.enable(this.gl.SCISSOR_TEST);
		this.gl.scissor(box.x, box.y, box.width, box.height);
	}

	private paintRect(command: RectCommand): void {
		const { rect, border } = command;
		const model = modelMatrix(
			command.transform,
			rect.x + rect.width / 2,
			rect.y + rect.height / 2,
			rect.width / 2,
			rect.height / 2,
		);
		this.drawQuad(
			model,
			rect.width,
			rect.height,
			fade(command.fill ?? WHITE, command.opacity),
			border ? fade(border.color, command.opacity) : undefined,
			border ? border.width : 0,
		);
	}

	/**
	 * `Renderer.drawQuad`, with the texture and custom-texture-coordinate
	 * branches dropped: `drawRectangle` was its only caller and passed neither,
	 * so both were unreachable before the move.
	 *
	 * `radius` is not read. The fragment shader has no rounded-rect SDF (R5.5
	 * arrives with the uber shader), and the border corners it draws are square
	 * today; honouring the radius here would be a visual change, which this PR
	 * does not make.
	 */
	private drawQuad(
		model: mat4,
		width: number,
		height: number,
		color: RGBA,
		strokeColor: RGBA | undefined,
		strokeWidth: number,
	): void {
		const shader = this.renderer.shader;
		if (!shader) {
			console.error('No shader selected');
			return;
		}

		shader.setMatrix4('uModelMatrix', model);
		shader.setVector4('uColor', color);

		// A width with no colour strokes black, which is what `drawQuad` did and
		// what several styles in this codebase rely on without saying so.
		if (strokeWidth > 0) {
			shader.setVector4('uStrokeColor', strokeColor ?? BLACK);
			shader.setFloat('uStrokeWidth', strokeWidth);
			shader.setVector2('uShapeSize', width, height);
		} else {
			shader.setFloat('uStrokeWidth', 0);
		}

		shader.setBool('uUseTexture', false);

		this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.quadVertexBuffer);
		this.gl.bindBuffer(this.gl.ELEMENT_ARRAY_BUFFER, this.quadIndexBuffer);

		const positionAttribLocation = this.gl.getAttribLocation(shader.getProgram(), 'aPosition');
		const texCoordAttribLocation = this.gl.getAttribLocation(shader.getProgram(), 'aTexCoord');

		// Always 16: the quad buffer always carries texture coordinates, and the
		// stroke branch of the fragment shader reads vTexCoord.
		const stride = 16;

		if (positionAttribLocation >= 0) {
			this.gl.enableVertexAttribArray(positionAttribLocation);
			this.gl.vertexAttribPointer(positionAttribLocation, 2, this.gl.FLOAT, false, stride, 0);
		}
		if (texCoordAttribLocation >= 0) {
			this.gl.enableVertexAttribArray(texCoordAttribLocation);
			this.gl.vertexAttribPointer(texCoordAttribLocation, 2, this.gl.FLOAT, false, stride, 8);
		}

		this.gl.drawElements(this.gl.TRIANGLES, 6, this.gl.UNSIGNED_SHORT, 0);
		this.frameTimer.recordDrawCall(4); // 4 vertices for a quad

		if (positionAttribLocation >= 0) {
			this.gl.disableVertexAttribArray(positionAttribLocation);
		}
		if (texCoordAttribLocation >= 0) {
			this.gl.disableVertexAttribArray(texCoordAttribLocation);
		}
	}

	/** `Renderer.drawCircle`, moved. The stroke's `bufferData` is DDB-103 and is preserved. */
	private paintCircle(command: CircleCommand): void {
		const shader = this.renderer.shader;
		if (!shader) {
			console.error('No shader selected');
			return;
		}

		const segments = 32; // Number of segments to approximate the circle
		const angleStep = (2 * Math.PI) / segments;

		const vertices: number[] = [0, 0]; // Center vertex
		for (let i = 0; i <= segments; i++) {
			const angle = i * angleStep;
			vertices.push(Math.cos(angle), Math.sin(angle));
		}

		const indices: number[] = [];
		for (let i = 1; i <= segments; i++) {
			indices.push(0, i, i + 1);
		}
		// Close the circle
		indices[indices.length - 1] = 1;

		const model = modelMatrix(
			command.transform,
			command.center.x,
			command.center.y,
			command.radius,
			command.radius,
		);

		shader.setMatrix4('uModelMatrix', model);
		shader.setVector4('uColor', fade(command.fill ?? WHITE, command.opacity));
		shader.setBool('uUseTexture', false);

		this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.dynamicVertexBuffer);
		this.gl.bufferSubData(this.gl.ARRAY_BUFFER, 0, new Float32Array(vertices));

		this.gl.bindBuffer(this.gl.ELEMENT_ARRAY_BUFFER, this.dynamicIndexBuffer);
		this.gl.bufferSubData(this.gl.ELEMENT_ARRAY_BUFFER, 0, new Uint16Array(indices));

		const positionAttribLocation = this.gl.getAttribLocation(shader.getProgram(), 'aPosition');
		this.gl.enableVertexAttribArray(positionAttribLocation);
		this.gl.vertexAttribPointer(positionAttribLocation, 2, this.gl.FLOAT, false, 0, 0);

		this.gl.drawElements(this.gl.TRIANGLES, indices.length, this.gl.UNSIGNED_SHORT, 0);
		this.frameTimer.recordDrawCall(vertices.length / 2); // Each vertex has 2 components (x,y)

		const border = command.border;
		if (border && border.width > 0) {
			const outlineVertices: number[] = [];
			for (let i = 0; i <= segments; i++) {
				const angle = i * angleStep;
				outlineVertices.push(Math.cos(angle), Math.sin(angle));
			}

			// bufferData, not bufferSubData: this reallocates the shared dynamic
			// buffer mid-frame and is the overrun DDB-103 tracks. Moved as it
			// was, because fixing it here would change what primitive-shapes
			// draws in the same commit that claims to change nothing.
			this.gl.bufferData(this.gl.ARRAY_BUFFER, new Float32Array(outlineVertices), this.gl.STATIC_DRAW);

			shader.setVector4('uColor', fade(border.color, command.opacity));
			shader.setBool('uUseTexture', false);
			this.gl.lineWidth(border.width);
			this.gl.drawArrays(this.gl.LINE_STRIP, 0, outlineVertices.length / 2);
			this.frameTimer.recordDrawCall(outlineVertices.length / 2);
		}

		this.gl.disableVertexAttribArray(positionAttribLocation);
	}

	/**
	 * `Renderer.drawPolygon`'s fill. `triangulatePolygon` did not come with it:
	 * R2.11 puts the triangle list on the command, so `Polygon` sends the same
	 * fan the helper computed and a caller with a real tessellation can send
	 * that instead.
	 */
	private paintPolygon(command: PolygonCommand): void {
		const shader = this.renderer.shader;
		if (!shader || command.points.length < 3) {
			console.error('Invalid polygon parameters');
			return;
		}

		const vertices: number[] = [];
		for (const point of command.points) vertices.push(point.x, point.y);

		const indices = command.indices ?? command.points.map((_, index) => index);

		shader.setMatrix4('uModelMatrix', toMat4(command.transform));
		shader.setVector4('uColor', fade(command.fill ?? WHITE, command.opacity));
		shader.setBool('uUseTexture', false);

		this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.dynamicVertexBuffer);
		this.gl.bufferSubData(this.gl.ARRAY_BUFFER, 0, new Float32Array(vertices));

		this.gl.bindBuffer(this.gl.ELEMENT_ARRAY_BUFFER, this.dynamicIndexBuffer);
		this.gl.bufferSubData(this.gl.ELEMENT_ARRAY_BUFFER, 0, new Uint16Array(indices));

		const positionAttribLocation = this.gl.getAttribLocation(shader.getProgram(), 'aPosition');
		this.gl.enableVertexAttribArray(positionAttribLocation);
		this.gl.vertexAttribPointer(positionAttribLocation, 2, this.gl.FLOAT, false, 0, 0);

		this.gl.drawElements(this.gl.TRIANGLES, indices.length, this.gl.UNSIGNED_SHORT, 0);
		this.frameTimer.recordDrawCall(command.points.length); // Polygon vertices

		this.gl.disableVertexAttribArray(positionAttribLocation);
	}

	/**
	 * The stroke half of `drawPolygon` and `drawTriangle`, which both drew a
	 * `LINE_LOOP` over the fill's own vertices. As its own command it re-uploads
	 * them; the bytes and the draw are the same, and core WebGL clamps
	 * `lineWidth` to 1 either way.
	 */
	private paintPolyline(command: PolylineCommand): void {
		const shader = this.renderer.shader;
		if (!shader || command.points.length < 2) return;

		const vertices: number[] = [];
		for (const point of command.points) vertices.push(point.x, point.y);

		shader.setMatrix4('uModelMatrix', toMat4(command.transform));
		shader.setVector4('uColor', fade(command.color, command.opacity));
		shader.setBool('uUseTexture', false);

		this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.dynamicVertexBuffer);
		this.gl.bufferSubData(this.gl.ARRAY_BUFFER, 0, new Float32Array(vertices));

		const positionAttribLocation = this.gl.getAttribLocation(shader.getProgram(), 'aPosition');
		this.gl.enableVertexAttribArray(positionAttribLocation);
		this.gl.vertexAttribPointer(positionAttribLocation, 2, this.gl.FLOAT, false, 0, 0);

		this.gl.lineWidth(command.width);
		this.gl.drawArrays(command.closed ? this.gl.LINE_LOOP : this.gl.LINE_STRIP, 0, command.points.length);
		this.frameTimer.recordDrawCall(command.points.length);

		this.gl.disableVertexAttribArray(positionAttribLocation);
	}

	/**
	 * `Renderer.drawText`'s alignment arithmetic, moved unchanged: measure at
	 * the atlas's own size, scale, then shift the anchor by half or a whole
	 * extent. `TextRenderer` receives the same pen position it received before,
	 * computed by the same expressions in the same order.
	 *
	 * `blur` is not read. R3.17's shadow run needs a blurred glyph pass the
	 * legacy shader does not have, and nothing in this codebase asks for one.
	 */
	private paintText(command: TextCommand): void {
		const shader = this.renderer.shader;
		if (!shader) {
			console.error('No shader selected for text rendering');
			return;
		}

		const fontAtlas = this.renderer.getFontAtlas();
		if (!fontAtlas) {
			console.warn('FontAtlas not initialized');
			return;
		}

		if (!command.position) {
			// R2.13's alignment box needs chapter 6's line breaking to place a
			// pen inside it; `Text` passes a position and this path is unused.
			this.reportUnpaintable('text', "drawText with a box and no position needs chapter 6's layout");
			return;
		}

		const anchor = transformPoint(command.transform, command.position.x, command.position.y);
		const scale = command.size / fontAtlas.getFontSize();
		const textMetrics = fontAtlas.measureText(command.text);
		const scaledWidth = textMetrics.width * scale;
		const scaledHeight = textMetrics.height * scale;

		let startX = anchor.x;
		if (command.align === 'center') {
			startX = anchor.x - scaledWidth / 2;
		} else if (command.align === 'right') {
			startX = anchor.x - scaledWidth;
		}

		let startY = anchor.y;
		if (command.verticalAlign === 'middle') {
			startY = anchor.y - scaledHeight / 2;
		} else if (command.verticalAlign === 'bottom') {
			startY = anchor.y - scaledHeight;
		}

		this.textRenderer.drawText(
			shader,
			command.text,
			startX,
			startY,
			fade(command.color, command.opacity),
			command.size,
		);
	}

	/**
	 * `Renderer.flushTextBatch`, moved. Once per batch, which is once per sort
	 * domain, which is where `enableScissor` and `disableScissor` flushed.
	 */
	private flushText(): void {
		const shader = this.renderer.shader;
		if (!shader) return;
		this.textRenderer.flush(
			shader,
			mat4.create(), // Identity matrix for model
			this.renderer.view,
			this.renderer.projection,
		);
	}

	/** `Renderer.initializeBuffers`, moved with the geometry that uses it. */
	private initializeBuffers(): void {
		this.quadVertexBuffer = this.gl.createBuffer();
		this.quadIndexBuffer = this.gl.createBuffer();

		const quadVertices = new Float32Array([
			// Position    // TexCoord
			-1.0, -1.0,    0.0, 0.0,  // Bottom left
			 1.0, -1.0,    1.0, 0.0,  // Bottom right
			 1.0,  1.0,    1.0, 1.0,  // Top right
			-1.0,  1.0,    0.0, 1.0   // Top left
		]);

		const quadIndices = new Uint16Array([
			0, 1, 2,  // First triangle
			0, 2, 3   // Second triangle
		]);

		this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.quadVertexBuffer);
		this.gl.bufferData(this.gl.ARRAY_BUFFER, quadVertices, this.gl.STATIC_DRAW);

		this.gl.bindBuffer(this.gl.ELEMENT_ARRAY_BUFFER, this.quadIndexBuffer);
		this.gl.bufferData(this.gl.ELEMENT_ARRAY_BUFFER, quadIndices, this.gl.STATIC_DRAW);

		this.dynamicVertexBuffer = this.gl.createBuffer();
		this.dynamicIndexBuffer = this.gl.createBuffer();

		this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.dynamicVertexBuffer);
		this.gl.bufferData(this.gl.ARRAY_BUFFER, this.maxDynamicVertices * 2 * 4, this.gl.DYNAMIC_DRAW);

		this.gl.bindBuffer(this.gl.ELEMENT_ARRAY_BUFFER, this.dynamicIndexBuffer);
		this.gl.bufferData(this.gl.ELEMENT_ARRAY_BUFFER, this.maxDynamicVertices * 2, this.gl.DYNAMIC_DRAW);

		this.gl.bindBuffer(this.gl.ARRAY_BUFFER, null);
		this.gl.bindBuffer(this.gl.ELEMENT_ARRAY_BUFFER, null);
	}
}

/**
 * R2.4's 2x3 as the shader's 4x4. Identity in, `mat4.create()` out, so the
 * uniform a rectangle uploads is the same bit pattern it uploaded before.
 */
function toMat4(transform: Mat2D): mat4 {
	const out = mat4.create();
	out[0] = transform[0];
	out[1] = transform[1];
	out[4] = transform[2];
	out[5] = transform[3];
	out[12] = transform[4];
	out[13] = transform[5];
	return out;
}

/**
 * The translate-then-scale every legacy draw built by hand, with the resolved
 * transform underneath it. Under an identity transform `mat4.translate` and
 * `mat4.scale` see the same identity they saw when `mat4.create()` produced it,
 * so the arithmetic is unchanged rather than merely equivalent.
 */
function modelMatrix(
	transform: Mat2D,
	centerX: number,
	centerY: number,
	scaleX: number,
	scaleY: number,
): mat4 {
	const out = toMat4(transform);
	mat4.translate(out, out, [centerX, centerY, 0]);
	mat4.scale(out, out, [scaleX, scaleY, 1]);
	return out;
}

/** R2.6 and R3.25: the opacity stack multiplies every alpha, borders included. */
function fade(color: RGBA, opacity: number): RGBA {
	return opacity === 1 ? color : [color[0], color[1], color[2], color[3] * opacity];
}
