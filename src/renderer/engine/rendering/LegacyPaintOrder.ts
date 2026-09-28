import { DrawCommand, TextCommand } from '../draw';

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
 * Everything it builds is reused from domain to domain: the ordered list, the
 * colour table and the per-colour run lists. So the returned list is only
 * valid until the next `apply`.
 */
export class LegacyPaintOrder {
	private readonly ordered: DrawCommand[] = [];
	/** Distinct faded colours of the current layer, four floats each. */
	private readonly colours: number[] = [];
	private readonly runsByColour: TextCommand[][] = [];

	apply(commands: readonly DrawCommand[]): readonly DrawCommand[] {
		const out = this.ordered;
		out.length = 0;

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
}
