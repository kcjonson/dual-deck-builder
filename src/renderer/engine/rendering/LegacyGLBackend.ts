import {
	BeginFrameOptions,
	CircleCommand,
	ClipRect,
	DrawApi,
	DrawBackend,
	DrawBatch,
	DrawCommand,
	DrawCommandKind,
	DrawTextOptions,
	FrameDescription,
	GpuWork,
	Mat2D,
	PolylineCommand,
	Rect,
	ResolvedClip,
	TextCommand,
	Vec2,
	clipRectOf,
	concat,
} from '../draw';
import { Batcher, GeometryUpload, GpuDraw } from '../draw/Batcher';
import { ResidentTextureSet } from '../draw/ResidentTextureSet';
import { FontAtlas } from './FontAtlas';
import { FrameTimer } from './FrameTimer';
import { LEGACY_VERTEX, LegacyGeometryEncoder } from './LegacyGeometryEncoder';
import { Renderer } from './Renderer';
import { Shader } from './Shader';
import { DEFAULT_FONT } from './fonts';

/**
 * Phase 1's shim: the pre-spec WebGL1 program behind `DrawBackend`, now fed by
 * the batcher.
 *
 * Each sort domain goes through `Batcher`: every draw group is written into one
 * shared vertex buffer by `LegacyGeometryEncoder`, and consecutive groups share
 * a `drawElements` until something forces a split. On the screens this game
 * has, that is one GPU draw per domain, where the per-command path issued one
 * per rectangle and one per text colour. The shader is the old one with its
 * per-draw uniforms turned into per-vertex attributes, and the encoder writes
 * the numbers the old uniforms held, which is why the goldens do not move.
 *
 * It dies with the WebGL2 backend of chapter 15. Deleting this file, the
 * encoder, and the two legacy shader files deletes the legacy path; `Batcher`
 * and `ResidentTextureSet` stay and take an instance encoder.
 *
 * WHAT THIS BACKEND DOES THAT NO OTHER BACKEND DOES, stated here because it is
 * the one place a reader could be misled. R2.2: "there are no modes to enter
 * (no separate text batch to begin and end). The sibling TypeScript engine had
 * a text batch that opened in the frame loop and flushed on scissor changes,
 * which reordered text above every shape drawn in the same clip scope." That
 * engine is this one, and the 26 committed goldens are pictures of it. So
 * `submit` reorders each domain with `legacyPaintOrder` before the batcher sees
 * it: every text run in a domain paints above every shape in it, grouped by
 * colour as the old text batch grouped it. `DrawApiOptions.legacyTextOrder` supplies the other half, a domain
 * boundary at every clip push and pop, which is where the old text batch
 * flushed. Both are deleted by the ordering re-baseline PR.
 *
 * `RecordingBackend` reports the submitted order, which is the true one, so
 * until then two backends disagree about what a frame looked like. The warning
 * lives here rather than in `RecordingBackend.ts` because this is the file that
 * gets deleted.
 */

export interface LegacyGLBackendOptions {
	renderer: Renderer;
	frameTimer: FrameTimer;
}

const NO_CLIP: ResolvedClip = { kind: 'none' };

/** The seven attributes of `vertex.glsl`, with their float offset and size. */
const ATTRIBUTES: ReadonlyArray<{ name: string; offset: number; size: number }> = [
	{ name: 'aPosition', offset: LEGACY_VERTEX.position, size: 2 },
	{ name: 'aTexCoord', offset: LEGACY_VERTEX.texCoord, size: 2 },
	{ name: 'aModelLinear', offset: LEGACY_VERTEX.modelLinear, size: 4 },
	{ name: 'aModelTranslate', offset: LEGACY_VERTEX.modelTranslate, size: 4 },
	{ name: 'aColor', offset: LEGACY_VERTEX.color, size: 4 },
	{ name: 'aStrokeColor', offset: LEGACY_VERTEX.strokeColor, size: 4 },
	{ name: 'aShapeSize', offset: LEGACY_VERTEX.shapeSize, size: 2 },
];

const STRIDE_BYTES = LEGACY_VERTEX.floats * 4;

/**
 * A screen-space clip rect as a WebGL scissor box, in device pixels from the
 * bottom left.
 *
 * Lifted expression for expression out of the block deleted from `Layer.ts`,
 * which read `screenX`, `screenY + height` and `canvas.height / dpr` where this
 * reads `minX`, `maxY` and `canvasHeightDevicePx / ratio`. It takes the canvas
 * height rather than `FrameDescription.viewport.height` on purpose: that is
 * what the old code measured against, so it reflects the last `Renderer.resize`
 * rather than this frame's `window.innerHeight`. It switches to the frame's
 * viewport when the WebGL2 backend lands.
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

/**
 * A domain in the order the pre-batch path painted it, so the batcher can
 * merge it without moving a pixel: shapes in submission order, then text
 * grouped by colour, colours in order of first appearance and runs in
 * submission order within a colour. Pure and exported so the reordering the
 * goldens depend on is tested rather than described.
 *
 * Both halves are `TextRenderer`'s, which queued runs per colour and drew the
 * queues at the end of a batch. The colour grouping was measured rather than
 * assumed: with plain submission order the driver selection screen differs by
 * one level on a handful of glyph-edge pixels where differently coloured runs
 * overlap, below the golden tolerance but not byte-identical. With it, all six
 * reachable screens and all seven baselined gallery scenes are.
 *
 * A bordered circle becomes its fill and then its outline, because the legacy
 * outline is a GL line strip and cannot share a group with the fan.
 */
export function legacyPaintOrder(commands: readonly DrawCommand[], out: DrawCommand[] = []): DrawCommand[] {
	out.length = 0;
	for (const command of commands) {
		if (command.kind === 'text') continue;
		out.push(command);
		if (command.kind === 'circle' && command.border && command.border.width > 0) {
			out.push(circleOutline(command));
		}
	}

	const byColour = new Map<string, TextCommand[]>();
	for (const command of commands) {
		if (command.kind !== 'text') continue;
		// The key `TextRenderer` built: the faded colour, joined.
		const { color, opacity } = command;
		const key = `${color[0]},${color[1]},${color[2]},${opacity === 1 ? color[3] : color[3] * opacity}`;
		const runs = byColour.get(key);
		if (runs) runs.push(command);
		else byColour.set(key, [command]);
	}
	for (const runs of byColour.values()) {
		for (const run of runs) out.push(run);
	}
	return out;
}

export class LegacyGLBackend implements DrawBackend {
	readonly name = 'legacy-gl';

	private readonly renderer: Renderer;
	private readonly frameTimer: FrameTimer;
	private readonly gl: WebGLRenderingContext;
	private readonly fontAtlas: FontAtlas;
	private readonly batcher: Batcher;
	private readonly encoder: LegacyGeometryEncoder;
	private readonly ordered: DrawCommand[] = [];

	private readonly vertexBuffer: WebGLBuffer;
	private readonly indexBuffer: WebGLBuffer;
	private attributeProgram: WebGLProgram | null = null;
	private readonly attributeLocations: number[] = [];

	/**
	 * The clip the scissor box currently holds, or null for "unknown", which is
	 * what `beginFrame` and `invalidateState` set so the next draw force-applies.
	 * Compared by reference: the draw API stamps one resolved clip object on
	 * every command in a scope (R2.5), and the batcher splits a GPU draw where
	 * that object changes.
	 */
	private appliedClip: ResolvedClip | null = null;
	/** Whether the resident texture is on its unit for this frame (R5.20). */
	private residentBound = false;
	private frame: FrameDescription | null = null;
	private readonly unpaintable = new Set<DrawCommandKind>();
	private warnedBlend = false;

	constructor({ renderer, frameTimer }: LegacyGLBackendOptions) {
		this.renderer = renderer;
		this.frameTimer = frameTimer;
		this.gl = renderer.getContext();

		const fontAtlas = renderer.getFontAtlas();
		if (!fontAtlas) {
			throw new Error('LegacyGLBackend requires the renderer font atlas');
		}
		this.fontAtlas = fontAtlas;

		const encoder = new LegacyGeometryEncoder({
			glyphs: fontAtlas,
			onUnpaintable: (kind, detail) => this.reportUnpaintable(kind, detail),
		});
		this.encoder = encoder;
		this.batcher = new Batcher({
			encoder,
			// One sampler in the legacy program, holding the one atlas. Nothing
			// submits an image, so there is no dynamic unit to hand out.
			textures: new ResidentTextureSet({ units: 1, resident: [encoder.glyphTexture] }),
			onDrop: (command, reason) => this.reportUnpaintable(command.kind, reason),
		});

		const vertexBuffer = this.gl.createBuffer();
		const indexBuffer = this.gl.createBuffer();
		if (!vertexBuffer || !indexBuffer) throw new Error('LegacyGLBackend: could not create buffers');
		this.vertexBuffer = vertexBuffer;
		this.indexBuffer = indexBuffer;
	}

	/** R2.18's precondition, answered by the atlas the `Renderer` builds in its constructor. */
	get fontAtlasNames(): readonly string[] {
		return [DEFAULT_FONT];
	}

	/** R4.2a per run, from the same glyph walk `encodeText` takes. */
	textInk(options: DrawTextOptions): Rect | null {
		return this.encoder.textInk(options);
	}

	beginFrame(frame: FrameDescription): void {
		this.frame = frame;
		this.appliedClip = null;
		this.residentBound = false;
	}

	submit(batch: DrawBatch): GpuWork {
		const ordered = legacyPaintOrder(batch.commands, this.ordered);
		for (const command of ordered) {
			if (command.kind === 'text') this.frameTimer.recordTextCharacters(command.text.length);
		}

		let residentBinds = 0;
		const work = this.batcher.flush(ordered, (upload) => {
			residentBinds += this.execute(upload);
		});
		work.textureBinds += residentBinds;
		return work;
	}

	endFrame(): void {
		// Leaves the scissor off so the next frame's `clear()` covers the canvas.
		this.applyClip(NO_CLIP);
		this.frame = null;
	}

	invalidateState(): void {
		// Every upload re-binds its buffers and attributes, so the only state
		// carried between uploads is the scissor box and the resident texture.
		this.appliedClip = null;
		this.residentBound = false;
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

	// -- execution ----------------------------------------------------------

	/** Uploads once and issues the upload's draws in order. Returns resident texture binds made. */
	private execute(upload: GeometryUpload): number {
		const shader = this.renderer.shader;
		if (!shader) {
			console.error('No shader selected');
			return 0;
		}
		const gl = this.gl;

		gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer);
		gl.bufferData(gl.ARRAY_BUFFER, upload.vertices.subarray(0, upload.floatCount), gl.DYNAMIC_DRAW);
		gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.indexBuffer);
		gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, upload.indices.subarray(0, upload.indexCount), gl.DYNAMIC_DRAW);

		const locations = this.locations(shader);
		for (let index = 0; index < ATTRIBUTES.length; index++) {
			const location = locations[index];
			if (location < 0) continue;
			gl.enableVertexAttribArray(location);
			gl.vertexAttribPointer(location, ATTRIBUTES[index].size, gl.FLOAT, false, STRIDE_BYTES, ATTRIBUTES[index].offset * 4);
		}

		let binds = 0;
		if (!this.residentBound) {
			gl.activeTexture(gl.TEXTURE0);
			gl.bindTexture(gl.TEXTURE_2D, this.fontAtlas.getTexture());
			shader.setInt('uTexture', 0);
			this.residentBound = true;
			binds = 1;
		}

		for (const draw of upload.draws) this.issue(draw);

		for (const location of locations) {
			if (location >= 0) gl.disableVertexAttribArray(location);
		}
		return binds;
	}

	private issue(draw: GpuDraw): void {
		const gl = this.gl;
		if (draw.blend !== 'over' && !this.warnedBlend) {
			// The legacy program is SRC_ALPHA over; nothing submits another
			// mode, and premultiplied blending arrives with the uber shader.
			this.warnedBlend = true;
			console.error(`LegacyGLBackend: blend '${draw.blend}' is drawn as 'over' by the legacy program`);
		}
		this.applyClip(draw.scissor ?? NO_CLIP);
		if (draw.topology === 'lines') gl.lineWidth(draw.lineWidth);
		gl.drawElements(
			draw.topology === 'lines' ? gl.LINES : gl.TRIANGLES,
			draw.indexCount,
			gl.UNSIGNED_SHORT,
			draw.firstIndex * 2,
		);
		this.frameTimer.recordDrawCall(draw.vertexCount);
	}

	/** Looked up once per program rather than per draw, which the old bodies did. */
	private locations(shader: Shader): number[] {
		const program = shader.getProgram();
		if (this.attributeProgram !== program) {
			this.attributeProgram = program;
			this.attributeLocations.length = 0;
			for (const attribute of ATTRIBUTES) {
				this.attributeLocations.push(this.gl.getAttribLocation(program, attribute.name));
			}
		}
		return this.attributeLocations;
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
}

const CIRCLE_OUTLINE_SEGMENTS = 32;

/** `Renderer.drawCircle`'s outline: 33 rim points, the first repeated, on the unit circle. */
const UNIT_CIRCLE_RIM: readonly Vec2[] = Array.from({ length: CIRCLE_OUTLINE_SEGMENTS + 1 }, (_, i) => {
	const angle = (i * 2 * Math.PI) / CIRCLE_OUTLINE_SEGMENTS;
	return { x: Math.cos(angle), y: Math.sin(angle) };
});

/**
 * A circle's border as the open line strip the old path drew over the unit
 * rim, under the circle's model (transform, then centre, then radius).
 */
function circleOutline(circle: CircleCommand): PolylineCommand {
	const border = circle.border as NonNullable<CircleCommand['border']>;
	const model: Mat2D = concat(circle.transform, [
		circle.radius,
		0,
		0,
		circle.radius,
		circle.center.x,
		circle.center.y,
	]);
	return {
		id: circle.id,
		sequence: circle.sequence,
		layer: circle.layer,
		layerOrdinal: circle.layerOrdinal,
		transform: model,
		translateOnly: false,
		clip: circle.clip,
		opacity: circle.opacity,
		blend: circle.blend,
		group: circle.group,
		kind: 'polyline',
		points: UNIT_CIRCLE_RIM,
		color: border.color,
		width: border.width,
		closed: false,
		cap: 'butt',
	};
}
