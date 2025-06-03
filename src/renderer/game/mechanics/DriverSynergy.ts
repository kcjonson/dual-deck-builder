import { Driver, DriverArchetype } from './Driver';

/**
 * Types of synergy relationships between drivers
 */
export type SynergyType = 'strong' | 'good' | 'neutral' | 'warning';

/**
 * Synergy analysis result
 */
export interface SynergyAnalysis {
	type: SynergyType;
	description: string;
	warning?: string;
	tags: string[];
}

/**
 * Driver stat compatibility for analysis
 */
interface StatCompatibility {
	offensive: number;
	defensive: number;
	utility: number;
	speed: number;
}

/**
 * DriverSynergy analyzes relationships between driver pairs
 * Uses driver stats and characteristics to determine synergies dynamically
 */
export class DriverSynergy {
	
	/**
	 * Analyze synergy between two drivers
	 * @param driver1 First driver
	 * @param driver2 Second driver
	 * @returns Synergy analysis result
	 */
	public static analyzeSynergy(driver1: Driver, driver2: Driver): SynergyAnalysis {
		// const stats1 = driver1.getVehicleStats(); // For future use
		// const stats2 = driver2.getVehicleStats(); // For future use
		
		const compat1 = this.calculateStatCompatibility(driver1);
		const compat2 = this.calculateStatCompatibility(driver2);
		
		// Analyze different aspects of the pairing
		const offensiveBalance = this.analyzeOffensiveBalance(compat1, compat2);
		const defensiveBalance = this.analyzeDefensiveBalance(compat1, compat2);
		const speedBalance = this.analyzeSpeedBalance(compat1, compat2);
		const utilityBalance = this.analyzeUtilityBalance(compat1, compat2);
		
		// Determine overall synergy
		return this.synthesizeSynergyResult(
			driver1, driver2, 
			offensiveBalance, defensiveBalance, speedBalance, utilityBalance
		);
	}

	/**
	 * Calculate stat compatibility scores for a driver
	 */
	private static calculateStatCompatibility(driver: Driver): StatCompatibility {
		const stats = driver.getVehicleStats();
		
		return {
			offensive: stats.gunnery + (stats.weight * 0.5), // Gunnery + ramming potential
			defensive: stats.armor + (stats.maxHealth * 0.1) + stats.evade,
			utility: this.calculateUtilityScore(driver),
			speed: stats.speed + stats.evade
		};
	}

	/**
	 * Calculate utility score based on driver archetype
	 */
	private static calculateUtilityScore(driver: Driver): number {
		const archetype = driver.getId();
		
		// Base utility scores by archetype (could be made configurable)
		const utilityMap: Record<DriverArchetype, number> = {
			mechanic: 8,     // High utility
			raider: 3,       // Low utility, high chaos
			road_warrior: 4, // Medium utility
			interceptor: 5   // Medium-high utility
		};
		
		return utilityMap[archetype] || 3;
	}

	/**
	 * Analyze offensive balance between drivers
	 */
	private static analyzeOffensiveBalance(compat1: StatCompatibility, compat2: StatCompatibility): {
		score: number;
		description: string;
	} {
		const totalOffensive = compat1.offensive + compat2.offensive;
		const difference = Math.abs(compat1.offensive - compat2.offensive);
		
		if (totalOffensive >= 12) {
			return {
				score: difference <= 3 ? 8 : 6,
				description: difference <= 3 
					? 'Devastating combined firepower' 
					: 'High damage with specialist roles'
			};
		} else if (totalOffensive <= 6) {
			return {
				score: 3,
				description: 'Limited offensive capabilities'
			};
		} else {
			return {
				score: 6,
				description: 'Balanced offensive potential'
			};
		}
	}

	/**
	 * Analyze defensive balance between drivers
	 */
	private static analyzeDefensiveBalance(compat1: StatCompatibility, compat2: StatCompatibility): {
		score: number;
		description: string;
		warning?: string;
	} {
		const totalDefensive = compat1.defensive + compat2.defensive;
		const minDefensive = Math.min(compat1.defensive, compat2.defensive);
		
		if (totalDefensive >= 20) {
			return {
				score: 8,
				description: 'Excellent survivability'
			};
		} else if (minDefensive <= 5) {
			return {
				score: 4,
				description: 'Vulnerable team composition',
				warning: 'One driver is very fragile - protect them carefully'
			};
		} else if (totalDefensive <= 10) {
			return {
				score: 3,
				description: 'Glass cannon setup',
				warning: 'Low overall defense - consider finding armor early'
			};
		} else {
			return {
				score: 6,
				description: 'Adequate defensive coverage'
			};
		}
	}

	/**
	 * Analyze speed balance between drivers
	 */
	private static analyzeSpeedBalance(compat1: StatCompatibility, compat2: StatCompatibility): {
		score: number;
		description: string;
	} {
		const avgSpeed = (compat1.speed + compat2.speed) / 2;
		const speedGap = Math.abs(compat1.speed - compat2.speed);
		
		if (avgSpeed >= 8 && speedGap <= 2) {
			return {
				score: 8,
				description: 'Lightning-fast coordination'
			};
		} else if (speedGap >= 6) {
			return {
				score: 4,
				description: 'Mismatched mobility - one fast, one slow'
			};
		} else if (avgSpeed <= 3) {
			return {
				score: 5,
				description: 'Heavy, methodical approach'
			};
		} else {
			return {
				score: 6,
				description: 'Balanced mobility'
			};
		}
	}

	/**
	 * Analyze utility balance between drivers
	 */
	private static analyzeUtilityBalance(compat1: StatCompatibility, compat2: StatCompatibility): {
		score: number;
		description: string;
	} {
		const totalUtility = compat1.utility + compat2.utility;
		const hasHighUtility = Math.max(compat1.utility, compat2.utility) >= 7;
		
		if (hasHighUtility && totalUtility >= 10) {
			return {
				score: 8,
				description: 'Excellent support capabilities'
			};
		} else if (totalUtility <= 6) {
			return {
				score: 4,
				description: 'Limited support options'
			};
		} else {
			return {
				score: 6,
				description: 'Adequate utility coverage'
			};
		}
	}

	/**
	 * Synthesize all analysis into final synergy result
	 */
	private static synthesizeSynergyResult(
		driver1: Driver, 
		driver2: Driver,
		offensive: { score: number; description: string },
		defensive: { score: number; description: string },
		speed: { score: number; description: string },
		utility: { score: number; description: string }
	): SynergyAnalysis {
		const avgScore = (offensive.score + defensive.score + speed.score + utility.score) / 4;
		
		// Combine descriptions
		const descriptions = [
			offensive.description,
			defensive.description,
			speed.description,
			utility.description
		];
		
		// Collect warnings
		const warnings = [defensive.warning].filter(Boolean);
		
		// Generate tags based on analysis
		const tags = this.generateSynergyTags(driver1, driver2, {
			offensive: offensive.score,
			defensive: defensive.score,
			speed: speed.score,
			utility: utility.score
		});
		
		// Determine synergy type based on average score
		let type: SynergyType;
		if (avgScore >= 7.5) {
			type = 'strong';
		} else if (avgScore >= 6) {
			type = 'good';
		} else if (warnings.length > 0) {
			type = 'warning';
		} else {
			type = 'neutral';
		}
		
		return {
			type,
			description: this.formatSynergyDescription(driver1, driver2, descriptions, type),
			warning: warnings.length > 0 ? warnings.join(' ') : undefined,
			tags
		};
	}

	/**
	 * Generate descriptive tags for the synergy
	 */
	private static generateSynergyTags(
		driver1: Driver, 
		driver2: Driver, 
		scores: { offensive: number; defensive: number; speed: number; utility: number }
	): string[] {
		const tags: string[] = [];
		
		if (scores.offensive >= 7) tags.push('high-damage');
		if (scores.defensive >= 7) tags.push('tank');
		if (scores.speed >= 7) tags.push('mobile');
		if (scores.utility >= 7) tags.push('support');
		
		if (scores.defensive <= 4) tags.push('glass-cannon');
		if (scores.offensive <= 4) tags.push('defensive');
		
		// Add archetype-specific tags
		const archetypes = [driver1.getId(), driver2.getId()];
		if (archetypes.includes('mechanic')) tags.push('utility');
		if (archetypes.includes('raider')) tags.push('berserker');
		if (archetypes.includes('road_warrior')) tags.push('fortress');
		if (archetypes.includes('interceptor')) tags.push('precision');
		
		return tags;
	}

	/**
	 * Format the final synergy description
	 */
	private static formatSynergyDescription(
		driver1: Driver,
		driver2: Driver,
		descriptions: string[],
		type: SynergyType
	): string {
		const name1 = driver1.getName();
		const name2 = driver2.getName();
		
		// Pick the most relevant descriptions based on synergy type
		const primaryDesc = descriptions[0]; // Offensive is usually most important
		const secondaryDesc = type === 'warning' ? descriptions[1] : descriptions[3];
		
		return `${name1} and ${name2}: ${primaryDesc}. ${secondaryDesc}.`;
	}

	/**
	 * Get a simple compatibility rating between drivers
	 * @param driver1 First driver
	 * @param driver2 Second driver
	 * @returns Compatibility score from 0-10
	 */
	public static getCompatibilityRating(driver1: Driver, driver2: Driver): number {
		const analysis = this.analyzeSynergy(driver1, driver2);
		
		const scoreMap: Record<SynergyType, number> = {
			strong: 9,
			good: 7,
			neutral: 5,
			warning: 3
		};
		
		return scoreMap[analysis.type];
	}
}