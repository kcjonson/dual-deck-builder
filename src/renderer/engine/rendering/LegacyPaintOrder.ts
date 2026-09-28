import { CircleCommand, DrawCommand, PolylineCommand, TextCommand, Vec2 } from '../draw';

type MutablePolyline = { -readonly [K in keyof PolylineCommand]: PolylineCommand[K] };

/**
 * A domain in the order the pre-batch path painted it, so the batcher can
 * merge it without moving a pixel. Within each run of one layer (the domain
 * arrives already partitioned by R3.10, so a layer's groups are contiguous):
 * the layer's shapes in submission order, then its text grouped by colour,
 * colours in order of first appearance and runs in submission order within a
 * colour. Layers stay in ladder order, so a `base` label never paints above a
 * `popup` panel, which is chapter 3's first incident.
 *
 * Both halves are `TextRenderer`'s, which queued runs per colour and drew the
 * queues at the end of a batch. The colour grouping was measured rather than
 * assumed: with plain submission order the driver selection screen differs by
 * one level on a handful of glyph-edge pixels where differently coloured runs
 * overlap, below the golden tolerance but not byte-identical. With it, all six
 * reachable screens and all seven baselined gallery scenes are. Doing it per
 * layer rather than per domain is where this departs from `TextRenderer`, which
 * ignored layers; it moves no pixel today because every domain in the app is a
 * single layer.
 *
 * A bordered circle becomes its fill and then its outline, because the legacy
 * outline is a GL line strip and cannot share a group with the fan.
 *
 * Everything it builds is reused from domain to domain: the ordered list, the
 * colour table, the per-colour run lists and the outline commands. So the
 * returned list and any outline in it are only valid until the next `apply`.
 */
export class LegacyPaintOrder {
	private readonly ordered: DrawCommand[] = [];
	/** Distinct faded colours of the current layer, four floats each. */
	private readonly colours: number[] = [];
	private readonly runsByColour: TextCommand[][] = [];
	private readonly outlines: MutablePolyline[] = [];
	private outlinesUsed = 0;

	apply(commands: readonly DrawCommand[]): readonly DrawCommand[] {
		const out = this.ordered;
		out.length = 0;
		this.outlinesUsed = 0;

		let start = 0;
		while (start < commands.length) {
			const ordinal = commands[start].layerOrdinal;
			let end = start + 1;
			while (end < commands.length && commands[end].layerOrdinal === ordinal) end++;
			this.orderLayer(commands, start, end);
			start = end;
		}
		return out;
	}

	private orderLayer(commands: readonly DrawCommand[], start: number, end: number): void {
		const out = this.ordered;
		for (let index = start; index < end; index++) {
			const command = commands[index];
			if (command.kind === 'text') continue;
			out.push(command);
			if (command.kind === 'circle' && command.border && command.border.width > 0) {
				out.push(this.circleOutline(command));
			}
		}

		const colours = this.colours;
		colours.length = 0;
		let distinct = 0;
		for (let index = start; index < end; index++) {
			const command = commands[index];
			if (command.kind !== 'text') continue;
			// The key `TextRenderer` built: the faded colour.
			const { color, opacity } = command;
			const alpha = opacity === 1 ? color[3] : color[3] * opacity;
			let slot = 0;
			while (slot < distinct) {
				const base = slot * 4;
				if (colours[base] === color[0] && colours[base + 1] === color[1]
					&& colours[base + 2] === color[2] && colours[base + 3] === alpha) break;
				slot++;
			}
			if (slot === distinct) {
				colours.push(color[0], color[1], color[2], alpha);
				if (!this.runsByColour[slot]) this.runsByColour[slot] = [];
				this.runsByColour[slot].length = 0;
				distinct++;
			}
			this.runsByColour[slot].push(command);
		}
		for (let slot = 0; slot < distinct; slot++) {
			const runs = this.runsByColour[slot];
			for (let index = 0; index < runs.length; index++) out.push(runs[index]);
			runs.length = 0;
		}
	}

	/**
	 * A circle's border as the open line strip the old path drew over the unit
	 * rim, under the circle's model (transform, then centre, then radius), in a
	 * pooled command.
	 */
	private circleOutline(circle: CircleCommand): PolylineCommand {
		const border = circle.border as NonNullable<CircleCommand['border']>;
		let outline = this.outlines[this.outlinesUsed];
		if (!outline) {
			outline = {
				id: null,
				sequence: 0,
				layer: circle.layer,
				layerOrdinal: 0,
				transform: [1, 0, 0, 1, 0, 0],
				translateOnly: false,
				clip: circle.clip,
				opacity: 1,
				blend: 'over',
				group: 'primary',
				kind: 'polyline',
				points: UNIT_CIRCLE_RIM,
				color: border.color,
				width: border.width,
				closed: false,
				cap: 'butt',
			};
			this.outlines.push(outline);
		}
		this.outlinesUsed += 1;

		// `concat(circle.transform, [r, 0, 0, r, cx, cy])`, into the pooled matrix.
		const m = circle.transform;
		const r = circle.radius;
		const cx = circle.center.x;
		const cy = circle.center.y;
		const model = outline.transform as unknown as number[];
		model[0] = m[0] * r;
		model[1] = m[1] * r;
		model[2] = m[2] * r;
		model[3] = m[3] * r;
		model[4] = m[0] * cx + m[2] * cy + m[4];
		model[5] = m[1] * cx + m[3] * cy + m[5];

		outline.id = circle.id;
		outline.sequence = circle.sequence;
		outline.layer = circle.layer;
		outline.layerOrdinal = circle.layerOrdinal;
		outline.clip = circle.clip;
		outline.opacity = circle.opacity;
		outline.blend = circle.blend;
		outline.group = circle.group;
		outline.color = border.color;
		outline.width = border.width;
		return outline;
	}
}

const CIRCLE_OUTLINE_SEGMENTS = 32;

/** `Renderer.drawCircle`'s outline: 33 rim points, the first repeated, on the unit circle. */
const UNIT_CIRCLE_RIM: readonly Vec2[] = Array.from({ length: CIRCLE_OUTLINE_SEGMENTS + 1 }, (_, i) => {
	const angle = (i * 2 * Math.PI) / CIRCLE_OUTLINE_SEGMENTS;
	return { x: Math.cos(angle), y: Math.sin(angle) };
});
