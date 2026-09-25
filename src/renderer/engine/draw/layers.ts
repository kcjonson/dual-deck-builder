/**
 * R3.5's layer ladder. The relative order is normative; the ordinals are not,
 * so they are spaced by ten to leave room for R3.5's "MAY add layers between
 * these" without renumbering the ones already stamped on committed test
 * expectations.
 *
 * The ordinal is the only sort key the batcher will ever see (R3.14). Component
 * `zIndex` orders siblings during the tree walk and never reaches here.
 */

export const LAYER_NAMES = [
	'base',
	'raised',
	'overlay',
	'modal',
	'popup',
	'toast',
	'tooltip',
	'drag',
	'transition',
] as const;

export type LayerName = (typeof LAYER_NAMES)[number];

export const LAYER_ORDINALS: Readonly<Record<LayerName, number>> = {
	base: 0,
	raised: 10,
	overlay: 20,
	modal: 30,
	popup: 40,
	toast: 50,
	tooltip: 60,
	drag: 70,
	transition: 80,
};

/** R3.6: the root of a domain is `base`. */
export const ROOT_LAYER: LayerName = 'base';

/** Index into `LAYER_NAMES`, which is also the partition bucket of R3.10. */
export const LAYER_INDEX: Readonly<Record<LayerName, number>> = Object.freeze(
	LAYER_NAMES.reduce<Record<string, number>>((map, name, index) => {
		map[name] = index;
		return map;
	}, {}),
) as Readonly<Record<LayerName, number>>;

export function layerOrdinal(layer: LayerName): number {
	return LAYER_ORDINALS[layer];
}

export function layerIndex(layer: LayerName): number {
	return LAYER_INDEX[layer];
}
