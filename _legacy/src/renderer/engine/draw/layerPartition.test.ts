import { LayerPartition } from './layerPartition';

describe('LayerPartition (R3.10)', () => {
	it('emits layer order and keeps submission order inside each layer', () => {
		const partition = new LayerPartition<string>();
		partition.push('popup', 'menu-bg');
		partition.push('base', 'panel');
		partition.push('popup', 'menu-row');
		partition.push('base', 'label');
		partition.push('modal', 'scrim');

		expect(partition.drain()).toEqual(['panel', 'label', 'scrim', 'menu-bg', 'menu-row']);
	});

	it('hands back the bucket itself when one layer was used, with no concatenation copy', () => {
		const partition = new LayerPartition<string>();
		partition.push('base', 'a');
		partition.push('base', 'b');

		const drained = partition.drain();
		expect(drained).toEqual(['a', 'b']);
		expect(partition.concatenated).toBe(false);
	});

	it('reports that it concatenated when more than one layer was used', () => {
		const partition = new LayerPartition<string>();
		partition.push('base', 'a');
		partition.push('toast', 'b');

		expect(partition.drain()).toEqual(['a', 'b']);
		expect(partition.concatenated).toBe(true);
	});

	it('does not empty a list it already handed out on the fast path', () => {
		const partition = new LayerPartition<string>();
		partition.push('base', 'a');
		const first = partition.drain();

		partition.push('base', 'b');
		expect(partition.drain()).toEqual(['b']);
		expect(first).toEqual(['a']);
	});

	it('is empty after draining and reports zero size', () => {
		const partition = new LayerPartition<string>();
		partition.push('drag', 'ghost');
		partition.drain();

		expect(partition.size).toBe(0);
		expect(partition.drain()).toEqual([]);
	});

	it('clears without emitting', () => {
		const partition = new LayerPartition<string>();
		partition.push('base', 'a');
		partition.clear();

		expect(partition.size).toBe(0);
		expect(partition.drain()).toEqual([]);
	});

	it('preserves the whole R3.5 ladder order across every band', () => {
		const partition = new LayerPartition<string>();
		const submitted = ['transition', 'drag', 'tooltip', 'toast', 'popup', 'modal', 'overlay', 'raised', 'base'] as const;
		for (const layer of submitted) partition.push(layer, layer);

		expect(partition.drain()).toEqual([...submitted].reverse());
	});
});
