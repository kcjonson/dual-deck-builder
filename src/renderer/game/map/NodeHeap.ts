/** A binary min-heap of nodes keyed by a cost (the route tree's hours, a rail search's cost), ties to the lower node, in typed arrays sized for every push a search makes. */
export class NodeHeap {
	private readonly keys: Float64Array;
	private readonly nodes: Int32Array;
	private count = 0;

	constructor(capacity: number) {
		this.keys = new Float64Array(capacity);
		this.nodes = new Int32Array(capacity);
	}

	public get size(): number {
		return this.count;
	}

	public push(node: number, key: number): void {
		let at = this.count;
		this.count += 1;
		while (at > 0) {
			const up = (at - 1) >> 1;
			if (!this.before(key, node, this.keys[up], this.nodes[up])) break;
			this.keys[at] = this.keys[up];
			this.nodes[at] = this.nodes[up];
			at = up;
		}
		this.keys[at] = key;
		this.nodes[at] = node;
	}

	public pop(): number {
		const top = this.nodes[0];
		this.count -= 1;
		const key = this.keys[this.count];
		const node = this.nodes[this.count];
		let at = 0;
		for (;;) {
			let child = 2 * at + 1;
			if (child >= this.count) break;
			if (child + 1 < this.count && this.before(this.keys[child + 1], this.nodes[child + 1], this.keys[child], this.nodes[child])) child += 1;
			if (!this.before(this.keys[child], this.nodes[child], key, node)) break;
			this.keys[at] = this.keys[child];
			this.nodes[at] = this.nodes[child];
			at = child;
		}
		this.keys[at] = key;
		this.nodes[at] = node;
		return top;
	}

	private before(key: number, node: number, otherKey: number, otherNode: number): boolean {
		return key < otherKey || (key === otherKey && node < otherNode);
	}
}
