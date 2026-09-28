import { IndexBufferPool } from './IndexBufferPool';

const KB = 1024;

describe('IndexBufferPool', () => {
	it('starts with its initial slots, all at the minimum size', () => {
		expect(new IndexBufferPool({ initialSlots: 3, minCapacity: 16 * KB }).capacities).toEqual([16 * KB, 16 * KB, 16 * KB]);
	});

	it('hands each upload in a frame its own slot', () => {
		const pool = new IndexBufferPool({ initialSlots: 6, minCapacity: 16 * KB });
		pool.beginFrame(0);
		const slots = [pool.acquire(100), pool.acquire(100), pool.acquire(100)];
		expect(new Set(slots).size).toBe(3);
		expect(pool.created).toBe(false);
	});

	it('reuses a slot only once the frame that wrote it is two frames old (R5.27)', () => {
		const pool = new IndexBufferPool({ initialSlots: 2, minCapacity: 16 * KB });
		pool.beginFrame(0);
		const first = pool.acquire(100);
		pool.beginFrame(1);
		const second = pool.acquire(100);
		expect(second).not.toBe(first);
		pool.beginFrame(2);
		expect(pool.acquire(100)).toBe(first);
		expect(pool.created).toBe(false);
	});

	it('creates a slot when every free one is too young, rather than rewriting a live one', () => {
		const pool = new IndexBufferPool({ initialSlots: 1, minCapacity: 16 * KB });
		pool.beginFrame(0);
		pool.acquire(100);
		expect(pool.created).toBe(false);
		expect(pool.acquire(100)).toBe(1);
		expect(pool.created).toBe(true);
		expect(pool.capacityOf(1)).toBe(16 * KB);
	});

	it('sizes a new slot to the upload, as the next power of two above the minimum', () => {
		const pool = new IndexBufferPool({ initialSlots: 2, minCapacity: 16 * KB });
		pool.beginFrame(0);
		expect(pool.acquire(40 * KB)).toBe(2);
		expect(pool.created).toBe(true);
		expect(pool.capacityOf(2)).toBe(64 * KB);
	});

	it('picks the smallest free slot that fits, so a large slot is not dirtied by a small upload', () => {
		const pool = new IndexBufferPool({ initialSlots: 1, minCapacity: 16 * KB });
		pool.beginFrame(0);
		const large = pool.acquire(100 * KB);
		pool.beginFrame(2);
		// Both slots are free; the small one fits the small upload.
		expect(pool.acquire(1 * KB)).toBe(0);
		// The large one is the only free slot that fits the large upload.
		expect(pool.acquire(100 * KB)).toBe(large);
	});

	it('stops creating once a steady frame has been seen three times', () => {
		const pool = new IndexBufferPool({ initialSlots: 0, minCapacity: 16 * KB });
		const uploads = [4 * KB, 12 * KB, 40 * KB, 2 * KB, 90 * KB, 8 * KB];
		const created: number[] = [];
		for (let frame = 0; frame < 10; frame++) {
			pool.beginFrame(frame);
			created.push(uploads.filter((bytes) => {
				pool.acquire(bytes);
				return pool.created;
			}).length);
		}
		expect(created.slice(0, 2)).toEqual([6, 6]);
		expect(created.slice(2)).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
	});

	it('goes back to its initial slots, all free, on reset', () => {
		const pool = new IndexBufferPool({ initialSlots: 2, minCapacity: 16 * KB });
		pool.beginFrame(0);
		pool.acquire(100 * KB);
		pool.acquire(100);
		pool.reset();
		expect(pool.capacities).toEqual([16 * KB, 16 * KB]);
		pool.beginFrame(1);
		for (let upload = 0; upload < 2; upload++) {
			pool.acquire(100);
			expect(pool.created).toBe(false);
		}
	});

	it('refuses frames that do not move forward', () => {
		const pool = new IndexBufferPool();
		pool.beginFrame(3);
		expect(() => pool.beginFrame(3)).toThrow();
	});
});
