import { Card, CardData } from '../mechanics/Card';
import { createEscort } from '../mechanics/Escort';
import { Vehicle } from '../mechanics/Vehicle';
import { DamageKind, cardDamageKind, damageToFinish, effectDamageKind, lastingDamage } from './DamageEstimate';
import { createTestDriver, createTestVehicle } from './__tests__/test-helpers';
import cardsFile from '../data/cards.json';

const cardData = (cardsFile as unknown as { cards: CardData[] }).cards;

const realCard = (type: string): Card => {
	const data = cardData.find(candidate => candidate.type === type);
	if (!data) throw new Error(`No card ${type} in cards.json`);
	return new Card({ ...data, upgraded: false });
};

// 10 structure, 5 armor, and a test driver with 5 HP at the wheel
const shieldedCar = (shield: number): Vehicle => {
	const car = createTestVehicle('Car', createTestDriver('Car Driver'));
	car.addShield(shield);
	return car;
};

describe('Damage estimates', () => {
	describe('damage to finish a target', () => {
		test('a vehicle hit goes through Shield and armor, and the crew takes half of what gets past', () => {
			const car = shieldedCar(20);

			// 20 Shield + 5 armor + 19, since 19 past both puts ceil(19 / 2) = 10 on structure
			expect(damageToFinish({ target: car, kind: DamageKind.VEHICLE })).toBe(44);

			car.takeDamage(43);
			expect(car.isAlive()).toBe(true);
			car.takeDamage(1);
			expect(car.isAlive()).toBe(false);
		});

		test('an empty escort takes it all on structure', () => {
			const hauler = createEscort({ type: 'fuel_hauler' });
			hauler.set({ structure: 2, armor: 0 });
			hauler.addShield(20);

			expect(damageToFinish({ target: hauler, kind: DamageKind.VEHICLE })).toBe(22);
		});

		test('driver-only damage skips Shield and armor and is measured against the driver', () => {
			const car = shieldedCar(20);

			expect(damageToFinish({ target: car, kind: DamageKind.DRIVER_ONLY })).toBe(5);
		});

		test('driver-only damage has nothing to finish on an empty escort', () => {
			const hauler = createEscort({ type: 'fuel_hauler' });

			expect(damageToFinish({ target: hauler, kind: DamageKind.DRIVER_ONLY })).toBe(Infinity);
		});

		test('structure-only damage skips Shield and armor and nobody aboard takes a share', () => {
			const car = shieldedCar(20);

			expect(damageToFinish({ target: car, kind: DamageKind.STRUCTURE_ONLY })).toBe(10);
		});
	});

	test('only damage past Shield lasts, unless the hit skips Shield', () => {
		const car = shieldedCar(4);

		expect(lastingDamage({ target: car, damage: 3, kind: DamageKind.VEHICLE })).toBe(0);
		expect(lastingDamage({ target: car, damage: 7, kind: DamageKind.VEHICLE })).toBe(3);
		expect(lastingDamage({ target: car, damage: 3, kind: DamageKind.DRIVER_ONLY })).toBe(3);
	});

	test('a card\'s kind is its damage on the target, not its self cost', () => {
		const rammingRun = realCard('ramming_run');

		expect(cardDamageKind(realCard('headshot'))).toBe(DamageKind.DRIVER_ONLY);
		expect(cardDamageKind(realCard('point_blank'))).toBe(DamageKind.VEHICLE);
		expect(cardDamageKind(rammingRun)).toBe(DamageKind.VEHICLE);
		expect(effectDamageKind(rammingRun.effects[1])).toBe(DamageKind.STRUCTURE_ONLY);
	});
});
