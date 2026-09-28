import { StreamRing } from './StreamRing';

describe('StreamRing (R5.27)', () => {
	it('advances an aligned offset within a frame', () => {
		const ring = new StreamRing({ capacity: 1000 });
		ring.beginFrame(0);
		expect(ring.allocate(10, 4)).toBe(0);
		expect(ring.allocate(10, 4)).toBe(12);
		expect(ring.allocate(8, 16)).toBe(32);
	});

	it('never straddles the end of the buffer', () => {
		const ring = new StreamRing({ capacity: 100 });
		ring.beginFrame(0);
		expect(ring.allocate(30, 4)).toBe(0);
		ring.beginFrame(1);
		ring.beginFrame(2);
		expect(ring.allocate(60, 4)).toBe(32);
		ring.beginFrame(3);
		ring.beginFrame(4);
		// 8 bytes remain at the end; 20 do not fit there, so it wraps to 0.
		expect(ring.allocate(20, 4)).toBe(0);
	});

	it('refuses to overwrite the previous frame or this one', () => {
		const ring = new StreamRing({ capacity: 100 });
		ring.beginFrame(0);
		expect(ring.allocate(40, 4)).toBe(0);
		ring.beginFrame(1);
		expect(ring.allocate(40, 4)).toBe(40);
		ring.beginFrame(2);
		// Frame 1's region (40 to 80) is one frame old; frame 0's (0 to 40) is two.
		expect(ring.allocate(40, 4)).toBe(0);
		// The tail (80 to 100) plus a wrap into frame 1's region is refused.
		expect(ring.allocate(30, 4)).toBe(-1);
	});

	it('reuses a region exactly when it is two frames old', () => {
		const ring = new StreamRing({ capacity: 100 });
		ring.beginFrame(10);
		expect(ring.allocate(100, 4)).toBe(0);
		ring.beginFrame(11);
		expect(ring.allocate(1, 4)).toBe(-1);
		ring.beginFrame(12);
		expect(ring.allocate(100, 4)).toBe(0);
	});

	it('treats a skipped frame as ageing everything before it', () => {
		const ring = new StreamRing({ capacity: 100 });
		ring.beginFrame(0);
		expect(ring.allocate(100, 4)).toBe(0);
		ring.beginFrame(5);
		expect(ring.allocate(100, 4)).toBe(0);
	});

	it('refuses an upload larger than the buffer', () => {
		const ring = new StreamRing({ capacity: 100 });
		ring.beginFrame(0);
		expect(ring.allocate(101, 4)).toBe(-1);
	});

	it('starts empty after a reset, at the new capacity', () => {
		const ring = new StreamRing({ capacity: 100 });
		ring.beginFrame(0);
		expect(ring.allocate(100, 4)).toBe(0);
		expect(ring.allocate(50, 4)).toBe(-1);
		ring.reset(200);
		expect(ring.capacity).toBe(200);
		expect(ring.allocate(150, 4)).toBe(0);
		// Would wrap onto this frame's own 0 to 150.
		expect(ring.allocate(50, 4)).toBe(-1);
		expect(ring.allocate(48, 4)).toBe(152);
	});

	it('only moves forward in frames', () => {
		const ring = new StreamRing({ capacity: 100 });
		ring.beginFrame(3);
		expect(() => ring.beginFrame(3)).toThrow();
	});
});
