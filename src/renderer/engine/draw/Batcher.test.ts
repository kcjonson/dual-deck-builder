import { Batcher, GeometryEncoder, GeometrySink, GeometryUpload, GroupShape, Topology } from './Batcher';
import { ResidentTextureSet, TextureKey } from './ResidentTextureSet';
import { CLIP_NONE, ResolvedClip } from './clip';
import { BlendMode, DrawCommand, RectCommand } from './commands';
import { IDENTITY } from './geometry';

/**
 * The batcher against a fake encoder, so every assertion is about merging,
 * splitting and counting rather than about any backend's vertex format.
 *
 * Each group is a quad of four vertices and six indices. A vertex is three
 * floats: the group's position in the domain, the vertex's corner, and the
 * texture slot the batcher chose, so a test can read back where every group
 * landed and which unit it was told to sample.
 */

interface Spec {
	id: string;
	blend?: BlendMode;
	clip?: ResolvedClip;
	texture?: TextureKey;
	topology?: Topology;
	lineWidth?: number;
	vertices?: number;
	skip?: boolean;
}

const FLOATS = 3;

function command({ id, blend = 'over', clip = CLIP_NONE as ResolvedClip }: Spec, sequence: number): RectCommand {
	return {
		id,
		sequence,
		layer: 'base',
		layerOrdinal: 0,
		transform: IDENTITY,
		translateOnly: true,
		clip,
		opacity: 1,
		blend,
		group: 'primary',
		kind: 'rect',
		rect: { x: 0, y: 0, width: 1, height: 1 },
		fill: null,
		radius: null,
		border: null,
		gradient: null,
	};
}

class QuadEncoder implements GeometryEncoder {
	readonly floatsPerVertex = FLOATS;
	readonly indexType = 'uint16' as const;
	readonly specs = new Map<string, Spec>();

	constructor(readonly clipIsState: boolean) {}

	shape(command: DrawCommand, out: GroupShape): boolean {
		const spec = this.specs.get(command.id ?? '') as Spec;
		if (spec.skip) return false;
		out.vertices = spec.vertices ?? 4;
		out.indices = 6;
		out.topology = spec.topology ?? 'triangles';
		out.lineWidth = spec.lineWidth ?? 1;
		out.texture = spec.texture ?? null;
		return true;
	}

	encode(command: DrawCommand, sink: GeometrySink, slot: number): void {
		const vertices = this.specs.get(command.id ?? '')?.vertices ?? 4;
		for (let corner = 0; corner < vertices; corner++) {
			const offset = sink.floatOffset + corner * FLOATS;
			sink.vertices[offset] = command.sequence;
			sink.vertices[offset + 1] = corner;
			sink.vertices[offset + 2] = slot;
		}
		const local = [0, 1, 2, 0, 2, 3];
		for (let index = 0; index < 6; index++) {
			sink.indices[sink.indexOffset + index] = sink.baseVertex + local[index];
		}
	}
}

interface Captured {
	floats: number[];
	indices: number[];
	draws: Array<{
		firstIndex: number;
		indexCount: number;
		vertexCount: number;
		split: string | null;
		textures: (TextureKey | null)[];
		blend: BlendMode;
		topology: Topology;
		scissor: ResolvedClip | null;
	}>;
	groups: number;
}

function harness({
	units = 4,
	resident = [] as TextureKey[],
	clipIsState = false,
	maxVertices,
}: { units?: number; resident?: TextureKey[]; clipIsState?: boolean; maxVertices?: number } = {}) {
	const encoder = new QuadEncoder(clipIsState);
	const textures = new ResidentTextureSet({ units, resident });
	const dropped: string[] = [];
	const batcher = new Batcher({
		encoder,
		textures,
		maxVertices,
		onDrop: (dropCommand, reason) => dropped.push(`${dropCommand.id}: ${reason}`),
	});

	function run(specs: Spec[]) {
		const commands = specs.map((spec, index) => {
			encoder.specs.set(spec.id, spec);
			return command(spec, index);
		});
		const uploads: Captured[] = [];
		const work = batcher.flush(commands, (upload: GeometryUpload) => {
			// Copied, because the batcher reuses the arrays for the next upload.
			uploads.push({
				floats: Array.from(upload.vertices.subarray(0, upload.floatCount)),
				indices: Array.from(upload.indices.subarray(0, upload.indexCount)),
				draws: upload.draws.map((draw) => ({ ...draw, textures: [...draw.textures] })),
				groups: upload.groups,
			});
		});
		return { uploads, work };
	}

	return { run, dropped, batcher, encoder };
}

/** The domain position of each vertex's group, in upload order. */
function groupOrder(upload: Captured): number[] {
	const order: number[] = [];
	for (let offset = 0; offset < upload.floats.length; offset += FLOATS * 4) order.push(upload.floats[offset]);
	return order;
}

const ids = (count: number, prefix = 'g'): Spec[] =>
	Array.from({ length: count }, (_, index) => ({ id: `${prefix}${index}` }));

describe('Batcher: geometry merging', () => {
	it('writes one contiguous range per draw call and merges them into one GPU draw', () => {
		const { run } = harness();
		const { uploads, work } = run(ids(5));

		expect(uploads).toHaveLength(1);
		const [upload] = uploads;
		expect(upload.groups).toBe(5);
		expect(upload.draws).toHaveLength(1);
		expect(upload.draws[0]).toMatchObject({ firstIndex: 0, indexCount: 30, vertexCount: 20, split: null });
		expect(groupOrder(upload)).toEqual([0, 1, 2, 3, 4]);
		// Indices are absolute within the upload, so group n addresses 4n..4n+3.
		expect(upload.indices.slice(24, 30)).toEqual([16, 17, 18, 16, 18, 19]);

		expect(work).toMatchObject({
			gpuDraws: 1,
			vertices: 20,
			triangles: 10,
			instances: 0,
			bytesUploaded: 20 * FLOATS * 4 + 30 * 2,
		});
	});

	it('uploads nothing and counts nothing for an empty domain', () => {
		const { run } = harness();
		const { uploads, work } = run([]);
		expect(uploads).toEqual([]);
		expect(work.gpuDraws).toBe(0);
		expect(work.bytesUploaded).toBe(0);
	});

	it('skips a command the encoder cannot draw without disturbing its neighbours', () => {
		const { run } = harness();
		const { uploads } = run([{ id: 'a' }, { id: 'b', skip: true }, { id: 'c' }]);
		expect(groupOrder(uploads[0])).toEqual([0, 2]);
		expect(uploads[0].draws).toHaveLength(1);
	});

	it('grows past its initial capacity without losing what it already wrote', () => {
		const { run } = harness();
		const { uploads } = run(ids(400));
		expect(uploads).toHaveLength(1);
		expect(groupOrder(uploads[0])).toEqual(Array.from({ length: 400 }, (_, index) => index));
		expect(uploads[0].indices[uploads[0].indices.length - 1]).toBe(1599);
	});

	it('reuses its GPU draw records from one domain to the next', () => {
		const { batcher, encoder } = harness();
		const seen: unknown[] = [];
		const capture = (upload: GeometryUpload) => seen.push(upload.draws[0]);
		const commands = ids(2).map((spec, index) => command(spec, index));
		for (const spec of ids(2)) encoder.specs.set(spec.id, spec);
		batcher.flush(commands, capture);
		batcher.flush(commands, capture);
		expect(seen[0]).toBe(seen[1]);
	});
});

describe('Batcher: buffer capacity (bufferFull)', () => {
	it('starts a new upload when the next group does not fit, in order', () => {
		const { run } = harness({ maxVertices: 8 });
		const { uploads, work } = run(ids(5));

		expect(uploads.map(groupOrder)).toEqual([[0, 1], [2, 3], [4]]);
		expect(work.flushes).toEqual({ bufferFull: 2 });
		expect(work.gpuDraws).toBe(3);
		// A new upload is a flush, not a split.
		expect(Object.values(work.splits ?? {}).every((count) => count === 0)).toBe(true);
		expect(uploads[1].draws[0].split).toBeNull();
	});

	it('drops a single group larger than an upload and says why', () => {
		const { run, dropped } = harness({ maxVertices: 8 });
		const { uploads } = run([{ id: 'a' }, { id: 'huge', vertices: 9 }, { id: 'b' }]);
		expect(groupOrder(uploads[0])).toEqual([0, 2]);
		expect(dropped).toEqual(['huge: a rect group of 9 vertices is larger than one upload (8)']);
	});

	it('caps an explicit capacity at what a 16-bit index can address', () => {
		const { run } = harness({ maxVertices: 1_000_000 });
		const { uploads } = run([{ id: 'a', vertices: 65_537 }]);
		expect(uploads).toEqual([]);
	});
});

describe('Batcher: resident texture set (R5.20)', () => {
	const fontBody = { name: 'body' };
	const fontMono = { name: 'mono' };
	const icons = { name: 'icons' };

	it('never splits between resident textures, and hands each group its fixed slot', () => {
		const { run } = harness({ units: 4, resident: [fontBody, fontMono, icons] });
		const { uploads, work } = run([
			{ id: 'icon', texture: icons },
			{ id: 'label', texture: fontBody },
			{ id: 'value', texture: fontMono },
			{ id: 'row', texture: undefined },
			{ id: 'icon2', texture: icons },
		]);

		expect(uploads[0].draws).toHaveLength(1);
		const slots = [];
		for (let offset = 2; offset < uploads[0].floats.length; offset += FLOATS * 4) slots.push(uploads[0].floats[offset]);
		expect(slots).toEqual([2, 0, 1, -1, 2]);
		expect(work.textureBinds).toBe(0);
		expect(uploads[0].draws[0].textures).toEqual([fontBody, fontMono, icons, null]);
	});

	it('puts a non-resident texture on a free dynamic unit without splitting', () => {
		const art = { name: 'art' };
		const { run } = harness({ units: 3, resident: [fontBody] });
		const { uploads, work } = run([
			{ id: 'label', texture: fontBody },
			{ id: 'card', texture: art },
			{ id: 'again', texture: art },
		]);
		expect(uploads[0].draws).toHaveLength(1);
		expect(uploads[0].draws[0].textures).toEqual([fontBody, art, null]);
		expect(work.textureBinds).toBe(1);
	});

	it('splits only when every dynamic unit is taken (textureSlotsExhausted)', () => {
		const art = [{ page: 0 }, { page: 1 }, { page: 2 }];
		const { run } = harness({ units: 3, resident: [fontBody] });
		const { uploads, work } = run([
			{ id: 'a', texture: art[0] },
			{ id: 'b', texture: art[1] },
			{ id: 'label', texture: fontBody },
			{ id: 'c', texture: art[2] },
			{ id: 'd', texture: art[0] },
		]);

		const draws = uploads[0].draws;
		expect(draws.map((draw) => draw.split)).toEqual([null, 'textureSlotsExhausted']);
		expect(draws.map((draw) => draw.indexCount / 6)).toEqual([3, 2]);
		expect(draws[0].textures).toEqual([fontBody, art[0], art[1]]);
		// The dynamic units were released at the split, so page 0 is bound again.
		expect(draws[1].textures).toEqual([fontBody, art[2], art[0]]);
		expect(work.splits?.textureSlotsExhausted).toBe(1);
		expect(work.textureBinds).toBe(4);
	});

	it('drops a non-resident texture when the backend has no dynamic units', () => {
		const art = { name: 'art' };
		const { run, dropped } = harness({ units: 1, resident: [fontBody] });
		const { uploads } = run([{ id: 'label', texture: fontBody }, { id: 'card', texture: art }]);
		expect(groupOrder(uploads[0])).toEqual([0]);
		expect(dropped).toEqual(['card: its texture is not resident and the backend has no dynamic texture units']);
	});
});

describe('Batcher: split reasons (R13.13)', () => {
	it('splits on a blend change and on the change back', () => {
		const { run } = harness();
		const { uploads, work } = run([{ id: 'a' }, { id: 'glow', blend: 'additive' }, { id: 'b' }]);
		expect(uploads[0].draws.map((draw) => [draw.blend, draw.split])).toEqual([
			['over', null],
			['additive', 'blendChange'],
			['over', 'blendChange'],
		]);
		expect(work.splits?.blendChange).toBe(2);
		expect(work.gpuDraws).toBe(3);
	});

	it('splits between triangles and lines, and between line widths', () => {
		const { run } = harness();
		const { uploads, work } = run([
			{ id: 'fill' },
			{ id: 'outline', topology: 'lines', lineWidth: 1 },
			{ id: 'outline2', topology: 'lines', lineWidth: 1 },
			{ id: 'thick', topology: 'lines', lineWidth: 3 },
		]);
		expect(uploads[0].draws.map((draw) => [draw.topology, draw.split])).toEqual([
			['triangles', null],
			['lines', 'topologyChange'],
			['lines', 'topologyChange'],
		]);
		expect(work.splits?.topologyChange).toBe(2);
		// Line draws are not triangles.
		expect(work.triangles).toBe(2);
	});

	it('reports the first reason in a fixed order when several change at once (R3.4)', () => {
		const { run } = harness();
		const { uploads } = run([{ id: 'a' }, { id: 'b', blend: 'additive', topology: 'lines' }]);
		expect(uploads[0].draws[1].split).toBe('blendChange');
	});
});

describe('Batcher: the clip seam', () => {
	const clipA: ResolvedClip = { kind: 'rect', rect: { minX: 0, minY: 0, maxX: 10, maxY: 10 }, rounded: null };
	const clipB: ResolvedClip = { kind: 'rect', rect: { minX: 5, minY: 5, maxX: 10, maxY: 10 }, rounded: null };

	it('never splits on a clip that travels as per-draw data (R4.1)', () => {
		const { run } = harness({ clipIsState: false });
		const { uploads, work } = run([{ id: 'a', clip: clipA }, { id: 'b', clip: clipB }, { id: 'c' }]);
		expect(uploads[0].draws).toHaveLength(1);
		expect(uploads[0].draws[0].scissor).toBeNull();
		expect(work.clipChanges).toBe(0);
	});

	it('splits and counts clipChange while a backend lowers the clip to scissor state', () => {
		const { run } = harness({ clipIsState: true });
		const { uploads, work } = run([{ id: 'a', clip: clipA }, { id: 'a2', clip: clipA }, { id: 'b', clip: clipB }]);
		expect(uploads[0].draws.map((draw) => [draw.scissor, draw.split])).toEqual([
			[clipA, null],
			[clipB, 'clipChange'],
		]);
		expect(work.clipChanges).toBe(1);
		// Not a split reason: R13.13 keeps clipChange as its own must-be-zero counter.
		expect(Object.values(work.splits ?? {}).reduce((sum, count) => sum + count, 0)).toBe(0);
	});
});

describe('Batcher: determinism (R3.4)', () => {
	it('produces identical uploads for identical domains', () => {
		const specs: Spec[] = [
			{ id: 'a' },
			{ id: 'b', blend: 'additive' },
			{ id: 'c', topology: 'lines' },
			{ id: 'd', texture: { any: 1 } },
		];
		const first = harness({ units: 2 }).run(specs);
		const second = harness({ units: 2 }).run(specs);
		expect(second.uploads).toEqual(first.uploads);
		expect(second.work).toEqual(first.work);
	});
});
