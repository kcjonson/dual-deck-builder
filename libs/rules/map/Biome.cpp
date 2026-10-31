#include "Biome.h"

namespace rules::map {

	Biome classifyBiome(const BiomeFields& fields) {
		const BiomeThresholds& at = kBiomeThresholds;
		if (fields.mountains >= at.mountains) {
			return Biome::Mountains;
		}
		if (fields.canyons >= at.canyons) {
			return Biome::Canyons;
		}
		if (fields.lowland >= at.mireLowland && fields.moisture + at.mireContamination * fields.contamination >= at.mireWetness) {
			return Biome::Mire;
		}
		if (fields.badlands >= at.badlands && fields.moisture < at.badlandsMoisture) {
			return Biome::Badlands;
		}
		if (fields.moisture < at.desertMoisture) {
			return Biome::Desert;
		}
		return Biome::Scrub;
	}

} // namespace rules::map
