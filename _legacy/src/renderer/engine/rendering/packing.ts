/**
 * R5.4's packed attribute types, written on the CPU: IEEE half floats
 * (`HALF_FLOAT`) and normalised unsigned bytes (`UNSIGNED_BYTE`,
 * normalised). WebGL2 converts both to float32 before the vertex stage, so
 * what the shader reads is exactly `fromHalf(toHalf(x))` and `toUnorm8(x) /
 * 255`.
 */

const floatScratch = new Float32Array(1);
const bitsScratch = new Uint32Array(floatScratch.buffer);

/**
 * The half float nearest `value`, ties to even, as its 16 bits. Rounds through
 * float32 first, which can differ from a direct rounding only on a float32
 * that lands exactly on a half-float tie. Out of range is infinity; NaN stays
 * NaN.
 */
export function toHalf(value: number): number {
	floatScratch[0] = value;
	const bits = bitsScratch[0];
	const sign = (bits >>> 16) & 0x8000;
	const exponent = ((bits >>> 23) & 0xff) - 127 + 15;
	const mantissa = bits & 0x7fffff;

	if (exponent === 0xff - 127 + 15) return sign | 0x7c00 | (mantissa ? 0x200 : 0);
	if (exponent >= 0x1f) return sign | 0x7c00;
	if (exponent <= 0) {
		// A subnormal half: the implicit bit joins the mantissa and shifts down.
		if (exponent < -10) return sign;
		const full = mantissa | 0x800000;
		const shift = 14 - exponent;
		let half = full >>> shift;
		const remainder = full & ((1 << shift) - 1);
		const halfway = 1 << (shift - 1);
		if (remainder > halfway || (remainder === halfway && (half & 1) === 1)) half += 1;
		return sign | half;
	}
	let half = (exponent << 10) | (mantissa >>> 13);
	const remainder = mantissa & 0x1fff;
	// A carry out of the mantissa bumps the exponent, which is the correct rounding.
	if (remainder > 0x1000 || (remainder === 0x1000 && (half & 1) === 1)) half += 1;
	return sign | half;
}

/** The value of a half float's 16 bits. */
export function fromHalf(half: number): number {
	const sign = half & 0x8000 ? -1 : 1;
	const exponent = (half >>> 10) & 0x1f;
	const mantissa = half & 0x3ff;
	if (exponent === 0) return sign * mantissa * 2 ** -24;
	if (exponent === 0x1f) return mantissa ? NaN : sign * Infinity;
	return sign * (1 + mantissa / 1024) * 2 ** (exponent - 15);
}

/**
 * A 0 to 1 value as a normalised unsigned byte, clamped, rounded the way a GPU
 * writes a float to an 8-bit target: the float32 product with 255, to the
 * nearest integer, ties to even. So an opaque colour stored here reaches the
 * framebuffer as the same byte the float would have: 0.3 is 76.5 in float32
 * and becomes 76 either way, where `Math.round` would make it 77.
 */
export function toUnorm8(value: number): number {
	if (!(value > 0)) return 0;
	if (value >= 1) return 255;
	const scaled = Math.fround(Math.fround(value) * 255);
	const floor = Math.floor(scaled);
	const fraction = scaled - floor;
	return fraction > 0.5 || (fraction === 0.5 && floor % 2 === 1) ? floor + 1 : floor;
}
