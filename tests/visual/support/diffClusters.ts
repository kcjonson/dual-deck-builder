import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';

/**
 * The cluster rule of DDB-197: the area budget's blind spot, closed.
 *
 * `maxDiffPixels` counts differing pixels wherever they are, so any change
 * whose whole footprint is under the budget passes, and a changed number is
 * the canonical one: an intent badge going from 5 to 15 is under 110 pixels,
 * which main's combat golden carried under a budget of 200 without anyone
 * noticing. What separates that from runner noise is shape rather than count.
 * Noise is scattered, a pixel here and there along glyph edges; a glyph change
 * is a dense blob. So the differing pixels are grouped into clusters, and a
 * capture fails when any one cluster is larger than the cluster budget, even
 * while the total stays under the area budget.
 *
 * "Differing" means exactly what Playwright's comparator counts: pixelmatch at
 * the suite's threshold, anti-aliased pixels excluded. The two checks then
 * agree on which pixels changed and differ only in how they add them up.
 */

export interface DiffRect {
	x: number;
	y: number;
	w: number;
	h: number;
}

export interface DiffCluster {
	/** Differing pixels in the cluster, not the area of its bounds. */
	size: number;
	bounds: DiffRect;
}

export interface DiffReport {
	width: number;
	height: number;
	/** Total differing pixels, the number `maxDiffPixels` is compared against. */
	differing: number;
	clusters: number;
	/** Null when nothing differs. */
	largest: DiffCluster | null;
}

export interface DiffMask {
	width: number;
	height: number;
	/** One byte per pixel, 1 where the pixel differs. */
	mask: Uint8Array;
}

export interface CompareOptions {
	expected: Buffer;
	actual: Buffer;
	/** pixelmatch's per-pixel YIQ threshold; the suite's `threshold`. */
	threshold: number;
	/** See `clusterMask`. */
	joinRadius: number;
}

/**
 * The differing-pixel mask pixelmatch would count, from two encoded PNGs of
 * the same size. A size mismatch throws: `toHaveScreenshot` has already failed
 * on it by the time this runs, and padding would invent differing pixels.
 */
export function diffMask({ expected, actual, threshold }: Omit<CompareOptions, 'joinRadius'>): DiffMask {
	const before = PNG.sync.read(expected);
	const after = PNG.sync.read(actual);
	if (before.width !== after.width || before.height !== after.height) {
		throw new Error(`Image sizes differ: expected ${before.width}x${before.height}, actual ${after.width}x${after.height}`);
	}
	const { width, height } = before;
	const output = new PNG({ width, height });
	// diffMask leaves unchanged and anti-aliased pixels transparent, so the
	// alpha channel is the mask.
	pixelmatch(before.data, after.data, output.data, width, height, { threshold, diffMask: true });
	const mask = new Uint8Array(width * height);
	for (let index = 0; index < mask.length; index += 1) {
		if (output.data[index * 4 + 3] !== 0) mask[index] = 1;
	}
	return { width, height, mask };
}

/**
 * Groups the differing pixels of a mask into clusters.
 *
 * Two differing pixels belong to the same cluster when they are within
 * `joinRadius` of each other on both axes, so a radius of 1 is plain
 * 8-connectivity and a larger one bridges small gaps. The bridging is the
 * point: a changed glyph does not light up as one solid region, since its
 * counters and the gaps between strokes match, and neither does a digit
 * that pushes its neighbour sideways. A radius of 2 joins the strokes of a
 * glyph and adjacent glyphs of a number into one cluster while leaving
 * scattered noise as the one- and two-pixel clusters it is.
 *
 * Union-find over the pixels in scan order, looking back only at the
 * neighbourhood already visited, so it is linear in the pixel count times the
 * neighbourhood size and costs nothing on an identical capture.
 */
export function clusterMask({ width, height, mask }: DiffMask, joinRadius: number): DiffReport {
	if (!Number.isInteger(joinRadius) || joinRadius < 1) {
		throw new Error(`joinRadius must be a positive integer, got ${joinRadius}`);
	}
	const parent = new Int32Array(width * height).fill(-1);
	const find = (index: number): number => {
		let root = index;
		while (parent[root] !== root) root = parent[root];
		// Path compression, so a long run of joins stays flat.
		let node = index;
		while (parent[node] !== root) {
			const next = parent[node];
			parent[node] = root;
			node = next;
		}
		return root;
	};
	const union = (a: number, b: number): void => {
		const rootA = find(a);
		const rootB = find(b);
		if (rootA !== rootB) parent[rootB] = rootA;
	};

	let differing = 0;
	for (let y = 0; y < height; y += 1) {
		for (let x = 0; x < width; x += 1) {
			const index = y * width + x;
			if (!mask[index]) continue;
			differing += 1;
			parent[index] = index;
			// Rows above within the radius, then this row to the left.
			for (let dy = -joinRadius; dy <= 0; dy += 1) {
				const ny = y + dy;
				if (ny < 0) continue;
				const maxDx = dy === 0 ? -1 : joinRadius;
				for (let dx = -joinRadius; dx <= maxDx; dx += 1) {
					const nx = x + dx;
					if (nx < 0 || nx >= width) continue;
					const neighbour = ny * width + nx;
					if (mask[neighbour]) union(index, neighbour);
				}
			}
		}
	}

	if (differing === 0) return { width, height, differing, clusters: 0, largest: null };

	const clusters = new Map<number, { size: number; minX: number; minY: number; maxX: number; maxY: number }>();
	for (let index = 0; index < mask.length; index += 1) {
		if (!mask[index]) continue;
		const root = find(index);
		const x = index % width;
		const y = (index - x) / width;
		const cluster = clusters.get(root);
		if (cluster) {
			cluster.size += 1;
			if (x < cluster.minX) cluster.minX = x;
			if (x > cluster.maxX) cluster.maxX = x;
			if (y > cluster.maxY) cluster.maxY = y;
		} else {
			clusters.set(root, { size: 1, minX: x, minY: y, maxX: x, maxY: y });
		}
	}

	let largest: DiffCluster | null = null;
	for (const cluster of clusters.values()) {
		if (largest && cluster.size <= largest.size) continue;
		largest = {
			size: cluster.size,
			bounds: { x: cluster.minX, y: cluster.minY, w: cluster.maxX - cluster.minX + 1, h: cluster.maxY - cluster.minY + 1 },
		};
	}
	return { width, height, differing, clusters: clusters.size, largest };
}

/** Both steps, from two encoded PNGs. */
export function compareClusters(options: CompareOptions): DiffReport {
	return clusterMask(diffMask(options), options.joinRadius);
}

/**
 * pixelmatch's ordinary diff picture (changes red, anti-aliasing yellow, the
 * rest faded), for the report when the rule fails.
 */
export function diffImage({ expected, actual, threshold }: Omit<CompareOptions, 'joinRadius'>): Buffer {
	const before = PNG.sync.read(expected);
	const after = PNG.sync.read(actual);
	const output = new PNG({ width: before.width, height: before.height });
	pixelmatch(before.data, after.data, output.data, before.width, before.height, { threshold });
	return PNG.sync.write(output);
}
