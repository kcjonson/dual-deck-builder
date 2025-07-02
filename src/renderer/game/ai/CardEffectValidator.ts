import { Card } from '../mechanics/Card';
import { Driver } from '../mechanics/Driver';
import { Vehicle } from '../mechanics/Vehicle';
import { Battle } from '../mechanics/Battle';

/**
 * Common utility for validating if a card will have any beneficial effect
 * Prevents AIs from playing cards that would have no effect
 */
export class CardEffectValidator {
	/**
	 * Check if a card will have any beneficial effect if played
	 * @param card The card to check
	 * @param caster The driver playing the card
	 * @param target The target vehicle (if applicable)
	 * @param battle The current battle state
	 * @returns true if the card will have a beneficial effect
	 */
	static willCardHaveEffect(
		card: Card, 
		caster: Driver, 
		target: Vehicle | null,
		battle: Battle
	): boolean {
		// Get the caster's vehicle
		const casterVehicle = this.getVehicleForDriver(caster, battle);
		if (!casterVehicle) return false;

		// Check each effect on the card
		for (const effect of card.effects) {
			switch (effect.type) {
				case 'heal':
					// Check if target vehicle needs healing
					if (target) {
						const structureMissing = target.maxStructure - target.structure;
						const armorMissing = target.maxArmor - target.armor;
						// Only beneficial if vehicle is damaged
						if (structureMissing > 0 || (effect.overflow_to_armor && armorMissing > 0)) {
							return true;
						}
					}
					break;

				case 'heal_driver':
					// Check if driver needs healing
					if (effect.target === 'same_vehicle' && target && target.driver) {
						// For same vehicle healing, check if we're in the same vehicle
						if (casterVehicle !== target) {
							continue; // Can't heal, skip this effect
						}
						const hpMissing = target.driver.maxHitpoints - target.driver.hitpoints;
						if (hpMissing > 0) {
							return true;
						}
					} else if (target && target.driver) {
						const hpMissing = target.driver.maxHitpoints - target.driver.hitpoints;
						if (hpMissing > 0) {
							return true;
						}
					}
					break;

				case 'armor':
				case 'gain_armor':
					// Check if target vehicle needs armor
					if (target) {
						const armorMissing = target.maxArmor - target.armor;
						if (armorMissing > 0) {
							return true;
						}
					}
					break;

				case 'damage':
					// For damage effects that need a target
					if (card.targetType === 'enemy_single') {
						// If no target specified, assume we can find one
						if (!target) {
							return true;
						}
						
						// Check if we can hit this specific target
						if (target.driver) {
							// Check range if specified
							if (typeof effect.range === 'number') {
								const range = battle.calculateRange(casterVehicle, target);
								if (range > effect.range) {
									continue; // Out of range
								}
							}
							
							// For evaluation purposes, assume attacks can hit
							// The actual hit check will happen when playing the card
							return true;
						}
					} else {
						// Self-targeting damage or area effects are always valid
						return true;
					}
					break;

				case 'draw_cards':
				case 'draw':
					// Drawing cards is always beneficial
					return true;

				case 'adrenaline':
				case 'gain_resource':
					// Gaining resources is always beneficial
					return true;

				case 'speed':
				case 'apply_status':
				case 'status':
					// Status effects are generally beneficial
					// Could add more specific checks here
					return true;

				case 'move_to_position':
				case 'change_position':
					// Position changes are situational but generally useful
					return true;
			}
		}

		// If no effects were beneficial, return false
		return false;
	}

	/**
	 * Check if a healing card is needed
	 * @param card The healing card
	 * @param target The target vehicle
	 * @returns The amount of healing that would be effective
	 */
	static getEffectiveHealing(card: Card, target: Vehicle | null): number {
		if (!target) return 0;

		let effectiveHealing = 0;

		for (const effect of card.effects) {
			if (effect.type === 'heal') {
				const healAmount = effect.value || 0;
				const structureMissing = target.maxStructure - target.structure;
				
				// Calculate effective structure healing
				const structureHealed = Math.min(healAmount, structureMissing);
				effectiveHealing += structureHealed;
				
				// Check overflow to armor
				if (effect.overflow_to_armor && structureHealed < healAmount) {
					const armorMissing = target.maxArmor - target.armor;
					const armorHealed = Math.min(healAmount - structureHealed, armorMissing);
					effectiveHealing += armorHealed;
				}
			}
		}

		return effectiveHealing;
	}

	/**
	 * Check if an armor card is needed
	 * @param card The armor card
	 * @param target The target vehicle
	 * @returns The amount of armor that would be effective
	 */
	static getEffectiveArmor(card: Card, target: Vehicle | null): number {
		if (!target) return 0;

		let effectiveArmor = 0;

		for (const effect of card.effects) {
			if (effect.type === 'armor' || effect.type === 'gain_armor') {
				const armorAmount = effect.value || 0;
				const armorMissing = target.maxArmor - target.armor;
				effectiveArmor += Math.min(armorAmount, armorMissing);
			}
		}

		return effectiveArmor;
	}

	/**
	 * Get the vehicle that a driver is in
	 */
	private static getVehicleForDriver(driver: Driver, battle: Battle): Vehicle | null {
		const allVehicles = [...battle.playerTeam.vehicles, ...battle.enemyTeam.vehicles];
		return allVehicles.find(v => v.driver === driver || v.passenger === driver) || null;
	}

	/**
	 * Estimate potential damage for a card
	 * @param card The damage card
	 * @param caster The driver playing the card
	 * @param target The target vehicle
	 * @param battle The battle context
	 * @returns Estimated damage or 0 if it won't hit
	 */
	static getEstimatedDamage(
		card: Card, 
		caster: Driver, 
		target: Vehicle | null,
		battle: Battle
	): number {
		if (!target || !target.driver) return 0;

		const casterVehicle = this.getVehicleForDriver(caster, battle);
		if (!casterVehicle) return 0;

		let totalDamage = 0;

		for (const effect of card.effects) {
			if (effect.type === 'damage') {
				// Check range
				if (typeof effect.range === 'number') {
					const range = battle.calculateRange(casterVehicle, target);
					if (range > effect.range) {
						continue; // Out of range
					}
				}

				// Check hit chance
				if (!effect.always_hits) {
					const attackType = (typeof effect.attack_type === 'string' ? effect.attack_type : null) || 
						(effect.scaling === 'ramming' ? 'ramming' : 'ranged');
					const hitModifier = typeof effect.hit_modifier === 'number' ? effect.hit_modifier : 0;
					if (!battle.checkHit(caster, target.driver, attackType, hitModifier)) {
						continue; // Will miss
					}
				}

				// Calculate base damage
				let damage = effect.value || 0;

				// Handle formula-based damage (like rams)
				if (effect.formula && typeof effect.formula === 'string') {
					damage = this.calculateFormulaDamage(effect.formula, casterVehicle, target);
				}

				// Apply damage modifiers
				damage = battle.calculateDamage(damage, casterVehicle, target);

				totalDamage += damage;
			}
		}

		return totalDamage;
	}

	/**
	 * Calculate formula-based damage (simplified version)
	 */
	private static calculateFormulaDamage(formula: string, attacker: Vehicle, target: Vehicle): number {
		// Simplified ram damage calculation
		let damage = 0;
		
		const speedDiff = attacker.getTotalSpeed() - target.getTotalSpeed();
		
		if (formula.includes('armor/10')) {
			damage += Math.floor(attacker.armor / 10);
		}
		if (formula.includes('armor/7')) {
			damage += Math.floor(attacker.armor / 7);
		}
		if (formula.includes('speed_diff * 2')) {
			damage += speedDiff * 2;
		} else if (formula.includes('speed_diff')) {
			damage += speedDiff;
		}
		
		return Math.max(0, damage);
	}
}