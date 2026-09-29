import { Batcher, GeometryEncoder, GeometrySink, GeometryUpload, GroupShape } from './Batcher';
import { ResidentTextureSet, TextureKey } from './ResidentTextureSet';
import { CLIP_NONE, ResolvedClip } from './clip';
import { BlendMode, DrawCommand, RectCommand } from './commands';
import { IDENTITY } from './geometry';

/**
 * The batcher against a fake encoder, so every assertion is about merging,
 * splitting and counting rather than about any backend's instance format.
 *
 * Each group is one instance unless it says otherwise. An instance is three
 * float words and a packed one: the group's position in the domain, the
 * instance's index within its group, the texture slot the batcher chose, and
 * four bytes, so a test can read back where every group landed and which unit
 * it was told to sample.
 */

interface Spec {
	id: string;
	blend?: BlendMode;
	clip?: ResolvedClip;
	texture?: TextureKey;
	instances?: number;
	skip?: boolean;
	/** Break the encoder contract for this group. */
	breaks?: 'overrun' | 'underrun' | 'nan';
}

const WORDS = 4;
const FLOAT_WORDS = 3;

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

class FakeEncoder implements GeometryEncoder {
	readonly instanceWords = WORDS;
	readonly floatWords = FLOAT_WORDS;
	readonly verticesPerInstance = 6;
	readonly specs = new Map<string, Spec>();

	shape(command: DrawCommand, out: GroupShape): boolean {
		const spec = this.specs.get(command.id ?? '') as Spec;
		if (spec.skip) return false;
		out.instances = spec.instances ?? 1;
		out.texture = spec.texture ?? null;
		return true;
	}

	encode(command: DrawCommand, sink: GeometrySink, slot: number): void {
		const spec = this.specs.get(command.id ?? '') as Spec;
		const reported = spec.instances ?? 1;
		const instances = spec.breaks === 'overrun' ? reported + 1 : spec.breaks === 'underrun' ? reported - 1 : reported;
		for (let instance = 0; instance < instances; instance++) {
			const offset = sink.wordOffset + instance * WORDS;
			sink.floats[offset] = command.sequence;
			sink.floats[offset + 1] = spec.breaks === 'nan' ? NaN : instance;
			sink.floats[offset + 2] = slot;
			sink.bytes.fill(7, (offset + 3) * 4, (offset + 4) * 4);
		}
	}
}

interface Captured {
	floats: number[];
	byteCount: number;
	instanceCount: number;
	draws: Array<{
		firstInstance: number;
		instanceCount: number;
		split: string | null;
		textures: (TextureKey | null)[];
		blend: BlendMode;
	}>;
	groups: number;
}

function harness({
	units = 4,
	resident = [] as TextureKey[],
	maxInstances,
	verify = true,
}: { units?: number; resident?: TextureKey[]; maxInstances?: number; verify?: boolean } = {}) {
	const encoder = new FakeEncoder();
	const textures = new ResidentTextureSet({ units, resident });
	const dropped: string[] = [];
	const violations: string[] = [];
	const batcher = new Batcher({
		encoder,
		textures,
		maxInstances,
		onDrop: (dropCommand, reason) => dropped.push(`${dropCommand.id}: ${reason}`),
		verify: verify ? (bad, problem) => violations.push(`${bad.id}: ${problem}`) : undefined,
	});

	function run(specs: Spec[]) {
		const commands = specs.map((spec, index) => {
			encoder.specs.set(spec.id, spec);
			return command(spec, index);
		});
		const uploads: Captured[] = [];
		const work = batcher.flush(commands, (upload: GeometryUpload) => {
			// Copied, because the batcher reuses the buffer for the next upload.
			uploads.push({
				floats: Array.from(new Float32Array(upload.bytes.buffer, 0, upload.byteCount / 4)),
				byteCount: upload.byteCount,
				instanceCount: upload.instanceCount,
				draws: upload.draws.map((draw) => ({ ...draw, textures: [...draw.textures] })),
				groups: upload.groups,
			});
		});
		return { uploads, work };
	}

	return { run, dropped, violations, batcher, encoder };
}

/** The domain position of each instance's group, in upload order. */
function groupOrder(upload: Captured): number[] {
	const order: number[] = [];
	for (let offset = 0; offset < upload.floats.length; offset += WORDS) order.push(upload.floats[offset]);
	return order;
}

const ids = (count: number, prefix = 'g'): Spec[] =>
	Array.from({ length: count }, (_, index) => ({ id: `${prefix}${index}` }));

describe('Batcher: geometry merging', () => {
	it('writes one contiguous range per draw call and merges them into one GPU draw', () => {
		const { run } = harness();
		const { uploads, work } = run([...ids(4), { id: 'wide', instances: 3 }]);

		expect(uploads).toHaveLength(1);
		const [upload] = uploads;
		expect(upload.groups).toBe(5);
		expect(upload.instanceCount).toBe(7);
		expect(upload.byteCount).toBe(7 * WORDS * 4);
		expect(upload.draws).toHaveLength(1);
		expect(upload.draws[0]).toMatchObject({ firstInstance: 0, instanceCount: 7, split: null });
		expect(groupOrder(upload)).toEqual([0, 1, 2, 3, 4, 4, 4]);
		// The last group's three instances, in order, after the first four groups.
		expect([4, 5, 6].map((instance) => upload.floats[instance * WORDS + 1])).toEqual([0, 1, 2]);

		expect(work).toMatchObject({
			gpuDraws: 1,
			instances: 7,
			vertices: 42,
			triangles: 14,
			bytesUploaded: 7 * WORDS * 4,
		});
	});

	it('uploads nothing and counts nothing for an empty domain', () => {
		const { run } = harness();
		const { uploads, work } = run([]);
		expect(uploads).toEqual([]);
		expect(work.gpuDraws).toBe(0);
		expect(work.bytesUploaded).toBe(0);
	});

	it('skips a command the encoder cannot draw, or one with nothing to draw, without disturbing its neighbours', () => {
		const { run } = harness();
		const { uploads } = run([{ id: 'a' }, { id: 'b', skip: true }, { id: 'c', instances: 0 }, { id: 'd' }]);
		expect(groupOrder(uploads[0])).toEqual([0, 3]);
		expect(uploads[0].draws).toHaveLength(1);
		expect(uploads[0].groups).toBe(2);
	});

	it('grows past its initial capacity without losing what it already wrote', () => {
		const { run } = harness();
		const { uploads } = run(ids(1000));
		expect(uploads).toHaveLength(1);
		expect(groupOrder(uploads[0])).toEqual(Array.from({ length: 1000 }, (_, index) => index));
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
		const { run } = harness({ maxInstances: 2 });
		const { uploads, work } = run(ids(5));

		expect(uploads.map(groupOrder)).toEqual([[0, 1], [2, 3], [4]]);
		expect(work.flushes).toEqual({ bufferFull: 2 });
		expect(work.gpuDraws).toBe(3);
		// A new upload is a flush, not a split.
		expect(Object.values(work.splits ?? {}).every((count) => count === 0)).toBe(true);
		expect(uploads[1].draws[0]).toMatchObject({ firstInstance: 0, split: null });
	});

	it('drops a single group larger than an upload and says why', () => {
		const { run, dropped } = harness({ maxInstances: 2 });
		const { uploads } = run([{ id: 'a' }, { id: 'huge', instances: 3 }, { id: 'b' }]);
		expect(groupOrder(uploads[0])).toEqual([0, 2]);
		expect(dropped).toEqual(['huge: a rect group of 3 instances is larger than one upload (2)']);
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
		for (let offset = 2; offset < uploads[0].floats.length; offset += WORDS) slots.push(uploads[0].floats[offset]);
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
		expect(draws.map((draw) => [draw.firstInstance, draw.instanceCount])).toEqual([[0, 3], [3, 2]]);
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
		const { uploads, work } = run([{ id: 'a' }, { id: 'tint', blend: 'multiply' }, { id: 'b' }]);
		expect(uploads[0].draws.map((draw) => [draw.blend, draw.split])).toEqual([
			['over', null],
			['multiply', 'blendChange'],
			['over', 'blendChange'],
		]);
		expect(work.splits?.blendChange).toBe(2);
		expect(work.gpuDraws).toBe(3);
	});

	it('never splits for additive, which shares over\'s blend state (R5.22a)', () => {
		const { run } = harness();
		const { uploads, work } = run([{ id: 'a' }, { id: 'glow', blend: 'additive' }, { id: 'b' }]);
		expect(uploads[0].draws.map((draw) => [draw.blend, draw.split])).toEqual([['over', null]]);
		expect(work.splits?.blendChange).toBe(0);
	});

	it('reports the first reason in a fixed order when several change at once (R3.4)', () => {
		const { run } = harness({ units: 2 });
		const { uploads } = run([
			{ id: 'a', texture: { first: 1 } },
			{ id: 'b', blend: 'screen', texture: { second: 1 } },
		]);
		expect(uploads[0].draws[1].split).toBe('blendChange');
	});

	it('counts every draw\'s instances, and their vertices as triangles', () => {
		const { run } = harness();
		const { work } = run([{ id: 'a' }, { id: 'b', blend: 'screen', instances: 2 }]);
		expect(work.instances).toBe(3);
		expect(work.vertices).toBe(18);
		expect(work.triangles).toBe(6);
	});
});

describe('Batcher: the clip (R4.1)', () => {
	const clipA: ResolvedClip = { kind: 'rect', rect: { minX: 0, minY: 0, maxX: 10, maxY: 10 }, rounded: null };
	const clipB: ResolvedClip = { kind: 'rect', rect: { minX: 5, minY: 5, maxX: 10, maxY: 10 }, rounded: null };

	it('never splits on a clip change, since the clip travels as per-draw data', () => {
		const { run } = harness();
		const { uploads, work } = run([{ id: 'a', clip: clipA }, { id: 'b', clip: clipB }, { id: 'c' }]);
		expect(uploads[0].draws).toHaveLength(1);
		expect(Object.values(work.splits ?? {}).reduce((sum, count) => sum + count, 0)).toBe(0);
	});
});

describe('Batcher: the encoder contract (verify)', () => {
	it('is silent for an encoder that writes exactly what it reported', () => {
		const { run, violations } = harness();
		run(ids(20));
		expect(violations).toEqual([]);
	});

	it.each([
		['overrun', 'b: the encoder wrote past the 2 instances it reported'],
		['underrun', 'b: the encoder left word 4 of 8 unwritten'],
		['nan', 'b: the encoder wrote NaN into word 1 of 8'],
	] as const)('reports an encoder that breaks it (%s)', (breaks, message) => {
		const { run, violations } = harness();
		run([{ id: 'a' }, { id: 'b', instances: 2, breaks }, { id: 'c' }]);
		expect(violations).toEqual([message]);
	});

	it('costs nothing when not asked for', () => {
		const { run, violations } = harness({ verify: false });
		run([{ id: 'a', breaks: 'overrun' }]);
		expect(violations).toEqual([]);
	});
});

describe('Batcher: allocation', () => {
	it('hands back the same upload and work objects every flush', () => {
		const { batcher, encoder } = harness();
		for (const spec of ids(3)) encoder.specs.set(spec.id, spec);
		const commands = ids(3).map((spec, index) => command(spec, index));
		const uploads: GeometryUpload[] = [];
		const first = batcher.flush(commands, (upload) => uploads.push(upload));
		const second = batcher.flush(commands, (upload) => uploads.push(upload));
		expect(second).toBe(first);
		expect(uploads[1]).toBe(uploads[0]);
		// Reset, not accumulated.
		expect(second.gpuDraws).toBe(1);
	});
});

describe('Batcher: determinism (R3.4)', () => {
	it('produces identical uploads for identical domains', () => {
		const specs: Spec[] = [
			{ id: 'a' },
			{ id: 'b', blend: 'additive' },
			{ id: 'c', blend: 'screen' },
			{ id: 'd', texture: { any: 1 } },
		];
		const first = harness({ units: 2 }).run(specs);
		const second = harness({ units: 2 }).run(specs);
		expect(second.uploads).toEqual(first.uploads);
		expect(second.work).toEqual(first.work);
	});
});
