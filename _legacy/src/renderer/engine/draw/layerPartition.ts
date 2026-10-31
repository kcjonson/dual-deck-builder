import { LAYER_NAMES, LayerName, layerIndex } from './layers';

/**
 * R3.10's per-layer partition, generic over what is being ordered.
 *
 * This is NOT the batcher. It merges no geometry, drops nothing as occluded,
 * uploads nothing, and knows nothing about what it holds. It is the ordering
 * mechanism R3.10 specifies and nothing else: "append each group's index (or
 * instance) range to a pre-sized per-layer list at submission and concatenate
 * the non-empty lists at flush: linear in the number of groups, stable by
 * construction, no allocation in steady state."
 *
 * It lands with the draw API rather than with the batcher because R2.22 says
 * the recording backend returns "the sorted draw list", and every one of
 * chapter 3.12's required order tests reads that list. Without the partition
 * those tests pass on submission order and stay green when a sort is wrong,
 * which is a worse outcome than a rule landing one PR early. It sits upstream
 * of the backend seam so a backend never orders anything: one implementation,
 * one place to test it, and no backend can disagree with another about what
 * order a frame was in.
 *
 * A stable partition also satisfies R3.16 and R3.17 for free. A shadow and its
 * owner are consecutive submissions in one layer, so they land in one bucket in
 * that order and no other group can be inserted between them.
 *
 * R3.10's fast path is a required test in 3.12: a domain whose groups all carry
 * one layer "uploads its submission sequence unchanged (no concatenation copy)".
 * `drain` hands back that bucket's own array, and `concatenated` says which path
 * ran so a test can assert it rather than infer it.
 */
export class LayerPartition<T> {
	private readonly buckets: T[][] = LAYER_NAMES.map(() => []);
	private usedLayers = 0;
	private firstUsedIndex = -1;
	private count = 0;
	private didConcatenate = false;

	push(layer: LayerName, item: T): void {
		const index = layerIndex(layer);
		const bucket = this.buckets[index];
		if (bucket.length === 0) {
			this.usedLayers += 1;
			if (this.firstUsedIndex === -1 || index < this.firstUsedIndex) this.firstUsedIndex = index;
		}
		bucket.push(item);
		this.count += 1;
	}

	get size(): number {
		return this.count;
	}

	/** True when the last `drain` had to build a new array; false on R3.10's fast path. */
	get concatenated(): boolean {
		return this.didConcatenate;
	}

	/**
	 * Layer order, submission order preserved inside each layer. Empty layers
	 * cost nothing and no comparison sort runs, so equal keys cannot be
	 * transposed by a comparator that is not stable, which is R3.10's warning
	 * about JavaScript sorts.
	 *
	 * Draining consumes. On the fast path the caller is handed the bucket
	 * itself and the partition takes a fresh array, so the returned list is not
	 * emptied underneath a caller that keeps it. That is one array per domain
	 * rather than one copy per group, which is the allocation the fast path is
	 * about.
	 */
	drain(): T[] {
		if (this.count === 0) {
			this.didConcatenate = false;
			return [];
		}

		if (this.usedLayers === 1) {
			this.didConcatenate = false;
			const index = this.firstUsedIndex;
			const bucket = this.buckets[index];
			this.buckets[index] = [];
			this.resetCounters();
			return bucket;
		}

		this.didConcatenate = true;
		const ordered: T[] = [];
		for (const bucket of this.buckets) {
			for (const item of bucket) ordered.push(item);
			bucket.length = 0;
		}
		this.resetCounters();
		return ordered;
	}

	clear(): void {
		for (const bucket of this.buckets) bucket.length = 0;
		this.resetCounters();
	}

	private resetCounters(): void {
		this.usedLayers = 0;
		this.firstUsedIndex = -1;
		this.count = 0;
	}
}
