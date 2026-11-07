// highlighter.frag.glsl - the player's selection in highlighter (procedural-paper.md, Hand marks): one pass of a chisel-tip
// marker, left to right, over the rect behind the label it marks, so the label's ink lands on top. The rect's fill is
// Highlighter yellow at the alpha one pass lays down; the hook takes coverage away (the chisel ends, the streaks, the
// edges where the hand wandered) and adds it only where the tip landed and pooled. params.x is the mark's seed, params.y
// the pool's most as a factor on the fill (a float's bits), params.z how deep the streaks go (a float's bits), both from
// atlas/Highlighter.h, so the contrast test there reads what this draws.

uint highlighter_hash(uint value) {
	value ^= value >> 16u;
	value *= 0x7feb352du;
	value ^= value >> 15u;
	value *= 0x846ca68bu;
	value ^= value >> 16u;
	return value;
}

// 0 to 1, one value a lattice point and seed.
float highlighter_random(int index, uint seed) {
	return float(highlighter_hash(uint(index) * 0x9e3779b1u ^ seed)) * (1.0 / 4294967295.0);
}

// Smooth noise along one axis, 0 to 1.
float highlighter_noise(float at, uint seed) {
	float cell = floor(at);
	float f = at - cell;
	float u = f * f * (3.0 - 2.0 * f);
	return mix(highlighter_random(int(cell), seed), highlighter_random(int(cell) + 1, seed), u);
}

vec4 highlighter_fill(vec4 color, vec2 local, vec2 halfSize, uvec3 params, float pixelSize) {
	uint  seed = params.x;
	float pool = uintBitsToFloat(params.y);
	float streaks = uintBitsToFloat(params.z);
	vec2  size = halfSize * 2.0;
	vec2  at = local + halfSize; // from the top left
	float soft = pixelSize * 0.75;

	// The band wanders a little up and down along its length, and never quite fills the rect's height.
	float wander = (highlighter_noise(at.x * 0.018, seed) - 0.5) * size.y * 0.1;
	float top = size.y * 0.07 + wander;
	float bottom = size.y * 0.93 + wander;
	float across = smoothstep(top - soft, top + soft, at.y) * (1.0 - smoothstep(bottom - soft, bottom + soft, at.y));

	// The chisel tip is held at a slant, so each end is a leaning cut: the start leans back at the foot, the end forward
	// at the head, each by its own seeded amount.
	float lean = size.y * (0.22 + 0.16 * highlighter_random(1, seed));
	float start = size.y * 0.12 * highlighter_random(2, seed) + lean * (1.0 - at.y / size.y);
	float end = size.x - size.y * 0.12 * highlighter_random(3, seed) - lean * (at.y / size.y);
	float along = smoothstep(start - soft, start + soft, at.x) * (1.0 - smoothstep(end - soft, end + soft, at.x));

	// Streaks: the felt's fibres lay lines along the stroke, a little lighter between them, drifting as the pass goes.
	float fibre = highlighter_noise(at.y * 0.85 + at.x * 0.012 + 11.0, seed ^ 0x51ed27u);
	float streak = 1.0 - streaks * smoothstep(0.35, 0.85, fibre);

	// The darker start: ink pooled where the tip landed, fading over about the stroke's height.
	float landed = 1.0 - smoothstep(0.0, size.y * 0.9, at.x - start);
	float coverage = across * along * streak * mix(1.0, pool, landed);
	return color * min(coverage, 1.0 / max(color.a, 0.0001));
}
