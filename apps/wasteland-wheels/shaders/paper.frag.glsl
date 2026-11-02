// paper.frag.glsl - the game's paper (procedural-paper.md): wear computed per pixel on a rect, over a flat reading
// window. params.x is the surface's seed; params.y packs the wear (bits 0-1, W0 to W3), the grab corner (2-3), the hero
// corner (4-5), the hero mark (6-7: none, burn, hole, rip), the fold count (8-10) and the exposed side (11-13: none, top,
// right, bottom, left). Corners count clockwise from the top left. The block is what the look is tuned by, filled from
// atlas/Paper.h; zeroed, it draws the tint.
//
// Grime darkens the tint by at most its wear level's strength, so ink's contrast on the darkest paper is checked without
// a GPU (Paper.test.cpp). Only W3's hero mark goes past it, and only in its corner.

layout(std140) uniform PaperUniforms {
	vec4  strength;	 // 0: the most grime darkens the tint by, at W0 to W3
	vec4  shade;	 // 16: each channel's share of the darkening (rgb), and a fold's darkening (w)
	float band;		 // 32: the edge band, a share of the shorter side
	float fade;		 // 36: grime fades to nothing over this much more
	float frequency; // 40: the mottle's lowest frequency, cycles a px
	float octaves;	 // 44
	float smallSide; // 48: px under which a surface gets the edge tone only
	float edgeTone;	 // 52: the edge tone's share of the strength
	float smudge;	 // 56: the grab corner's smudge, a share of the shorter side
	float hero;		 // 60: the hero mark's reach, a share of the shorter side
} paper;

uint paper_hash(uint value) {
	value ^= value >> 16u;
	value *= 0x7feb352du;
	value ^= value >> 15u;
	value *= 0x846ca68bu;
	value ^= value >> 16u;
	return value;
}

// 0 to 1, one value a lattice point and seed.
float paper_random(ivec2 cell, uint seed) {
	return float(paper_hash(uint(cell.x) * 0x9e3779b1u ^ paper_hash(uint(cell.y) ^ seed))) * (1.0 / 4294967295.0);
}

float paper_noise(vec2 at, uint seed) {
	vec2  cell = floor(at);
	vec2  f = at - cell;
	vec2  u = f * f * (3.0 - 2.0 * f);
	ivec2 c = ivec2(cell);
	float a = paper_random(c, seed);
	float b = paper_random(c + ivec2(1, 0), seed);
	float d = paper_random(c + ivec2(0, 1), seed);
	float e = paper_random(c + ivec2(1, 1), seed);
	return mix(mix(a, b, u.x), mix(d, e, u.x), u.y);
}

float paper_fbm(vec2 at, uint seed) {
	float sum = 0.0;
	float total = 0.0;
	float amplitude = 0.5;
	for (int octave = 0; octave < 6; ++octave) {
		if (float(octave) >= paper.octaves) {
			break;
		}
		sum += amplitude * paper_noise(at, seed + uint(octave) * 0x68e31da4u);
		total += amplitude;
		at = at * 2.03 + vec2(17.3, 5.1);
		amplitude *= 0.5;
	}
	return total > 0.0 ? sum / total : 0.5;
}

// The corner's sign on each axis: 0 top left, 1 top right, 2 bottom right, 3 bottom left.
vec2 paper_corner(uint corner) {
	return vec2(corner == 1u || corner == 2u ? 1.0 : -1.0, corner >= 2u ? 1.0 : -1.0);
}

// 0 to 1: the creases of `folds` folds, alternating across and down the sheet, each a dark line with a light lip.
float paper_folds(vec2 local, vec2 halfSize, uint seed, uint folds, float pixelSize) {
	float crease = 0.0;
	for (uint fold = 0u; fold < folds; ++fold) {
		bool  across = (fold & 1u) == 0u;
		float jitter = paper_random(ivec2(int(fold), 7), seed) - 0.5;
		float at = (float(fold / 2u + 1u) / float((folds + 1u) / 2u + 1u) - 0.5 + jitter * 0.08) * 2.0;
		float span = across ? halfSize.x : halfSize.y;
		float distance = abs((across ? local.x : local.y) - at * span);
		crease = max(crease, 1.0 - smoothstep(0.0, 1.5 + pixelSize, distance));
	}
	return crease;
}

vec4 paper_fill(vec4 color, vec2 local, vec2 halfSize, uvec3 params, float pixelSize) {
	uint  seed = params.x;
	uint  bits = params.y;
	uint  wear = bits & 3u;
	float strength = paper.strength[int(wear)];
	if (!(strength > 0.0)) {
		return color;
	}
	float shortSide = 2.0 * min(halfSize.x, halfSize.y);
	vec2  edge = halfSize - abs(local);
	float distance = min(edge.x, edge.y);
	float band = paper.band * shortSide;
	float reach = band + paper.fade * shortSide;
	bool  small = shortSide < paper.smallSide;

	uint  folds = (bits >> 8u) & 7u;
	float crease = wear >= 2u && !small && folds > 0u ? paper_folds(local, halfSize, seed, folds, pixelSize) : 0.0;

	uint mark = wear == 3u && !small ? (bits >> 6u) & 3u : 0u;
	vec2 heroCorner = paper_corner((bits >> 4u) & 3u) * halfSize;
	float heroReach = paper.hero * shortSide;
	float fromHero = length(local - heroCorner);
	bool  inHero = mark != 0u && fromHero < heroReach * 1.3;

	// The reading window: the tint exactly, unless a crease or the hero mark crosses it.
	if (distance >= reach && crease <= 0.0 && !inHero) {
		return color;
	}

	vec2  at = local + halfSize;
	float inBand = clamp((reach - distance) / max(reach - band, 1e-3), 0.0, 1.0);
	float amount = inBand * paper.edgeTone;
	if (!small && distance < reach) {
		if (wear == 1u) {
			vec2  grab = paper_corner((bits >> 2u) & 3u) * halfSize;
			float radius = paper.smudge * shortSide;
			float smudge = 1.0 - smoothstep(radius * 0.3, radius, length(local - grab * 0.94));
			amount = max(amount, inBand * smudge * (0.55 + 0.45 * paper_noise(at * 0.08, seed)));
		} else if (wear >= 2u) {
			float mottle = smoothstep(0.3, 0.75, paper_fbm(at * paper.frequency, seed));
			amount = inBand * mix(paper.edgeTone, 1.0, mottle);

			// A margin stain, its tide line darker than its middle, on the edge the seed picks.
			uint  side = paper_hash(seed ^ 0x51ed27u) & 3u;
			float along = (paper_random(ivec2(3, 9), seed) - 0.5) * 1.4;
			vec2  centre = side == 0u   ? vec2(along * halfSize.x, -halfSize.y)
						   : side == 1u ? vec2(halfSize.x, along * halfSize.y)
						   : side == 2u ? vec2(along * halfSize.x, halfSize.y)
										: vec2(-halfSize.x, along * halfSize.y);
			float stainRadius = reach * 1.1;
			float fromStain = length(local - centre) / stainRadius + (paper_noise(at * 0.05, seed + 3u) - 0.5) * 0.25;
			float stain = (1.0 - smoothstep(0.85, 1.0, fromStain)) * (0.35 + 0.65 * smoothstep(0.7, 0.95, fromStain));
			amount = max(amount, stain * inBand);

			// Shallow tears: darker notches cut in from the edge.
			for (int tear = 0; tear < 3; ++tear) {
				uint  tearSide = paper_hash(seed + uint(tear) * 0x2545f491u) & 3u;
				float position = (paper_random(ivec2(tear, 13), seed) - 0.5) * 1.6;
				vec2  root = tearSide == 0u   ? vec2(position * halfSize.x, -halfSize.y)
							 : tearSide == 1u ? vec2(halfSize.x, position * halfSize.y)
							 : tearSide == 2u ? vec2(position * halfSize.x, halfSize.y)
											  : vec2(-halfSize.x, position * halfSize.y);
				vec2  inward = tearSide == 0u ? vec2(0.0, 1.0) : tearSide == 1u ? vec2(-1.0, 0.0) : tearSide == 2u ? vec2(0.0, -1.0) : vec2(1.0, 0.0);
				vec2  offset = local - root;
				float depth = dot(offset, inward);
				float across = abs(dot(offset, vec2(inward.y, -inward.x)));
				float notchDepth = band * 0.4;
				float width = max(notchDepth - depth, 0.0) * 0.35;
				float notch = depth >= 0.0 && depth < notchDepth ? 1.0 - smoothstep(width, width + pixelSize, across) : 0.0;
				amount = max(amount, notch * 0.6);
			}

			// What rides in the vehicle: dust in the band on the exposed side, and a tide line inside it.
			uint exposed = (bits >> 11u) & 7u;
			if (exposed != 0u) {
				float fromSide = exposed == 1u ? edge.y * step(0.0, -local.y)
							   : exposed == 2u ? edge.x * step(0.0, local.x)
							   : exposed == 3u ? edge.y * step(0.0, local.y)
											   : edge.x * step(0.0, -local.x);
				bool  onSide = fromSide > 0.0 && fromSide < reach;
				float tide = onSide ? 1.0 - smoothstep(0.0, 1.0 + pixelSize, abs(fromSide - band * (0.8 + 0.3 * paper_noise(at * 0.03, seed + 5u)))) : 0.0;
				amount = max(amount, onSide ? max(tide * 0.8, inBand * paper_noise(at * 0.5, seed + 9u)) : 0.0);
			}
		}
	}

	float darken = min(strength, strength * clamp(amount, 0.0, 1.0) + paper.shade.w * crease);
	vec4  worn = vec4(color.rgb * (1.0 - darken * paper.shade.rgb), color.a);

	if (inHero) {
		float edgeNoise = (paper_fbm(at * 0.09, seed + 11u) - 0.5) * heroReach * 0.5;
		float reachHere = heroReach + edgeNoise;
		if (mark == 1u) {
			// A burn: char at the corner, scorched paper round it.
			float burn = 1.0 - smoothstep(reachHere * 0.55, reachHere, fromHero);
			float charred = 1.0 - smoothstep(reachHere * 0.2, reachHere * 0.6, fromHero);
			worn.rgb = mix(worn.rgb, vec3(0.30, 0.20, 0.11) * color.a, burn * 0.7);
			worn.rgb = mix(worn.rgb, vec3(0.08, 0.06, 0.05) * color.a, charred);
		} else if (mark == 2u) {
			// A hole, the table showing through, with a scorched lip.
			vec2  holeCentre = heroCorner - sign(heroCorner) * heroReach * 0.5;
			float holeRadius = heroReach * 0.35 + edgeNoise * 0.3;
			float fromHole = length(local - holeCentre);
			float lip = 1.0 - smoothstep(holeRadius, holeRadius * 1.35, fromHole);
			worn.rgb = mix(worn.rgb, vec3(0.20, 0.14, 0.09) * color.a, lip * 0.8);
			worn *= smoothstep(holeRadius - pixelSize, holeRadius, fromHole);
		} else {
			// A rip: the corner torn away along a ragged line.
			vec2  toward = normalize(-heroCorner);
			float cut = dot(local - heroCorner, toward) - (reachHere * 0.6);
			worn *= smoothstep(-pixelSize, 0.0, cut);
		}
	}
	return worn;
}
