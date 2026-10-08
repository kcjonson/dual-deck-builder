import { Battle } from '../mechanics/Battle';
import { BoardProjection } from '../mechanics/BoardProjection';
import { Card } from '../mechanics/Card';
import { Driver } from '../mechanics/Driver';
import { Team, TeamType } from '../mechanics/Team';
import { Vehicle } from '../mechanics/Vehicle';
import { CardEffectValidator } from './CardEffectValidator';
import { createDrawCard, createFillerCards, createTestCard, createTestDriver, createTestVehicle, driverOf } from './__tests__/test-helpers';

describe('CardEffectValidator', () => {
	describe('a draw card', () => {
		let battle: Battle;
		let rig: Vehicle;
		let driver: Driver;

		beforeEach(() => {
			rig = createTestVehicle('Rig', createTestDriver('Driver'));
			battle = new Battle({
				playerTeam: new Team({ type: TeamType.PLAYER, vehicles: [rig, createTestVehicle('Bike', createTestDriver('Partner'))] }),
				enemyTeam: new Team({ type: TeamType.ENEMY, vehicles: [createTestVehicle('Buggy', createTestDriver('Raider'))] })
			});
			driver = driverOf(rig);
		});

		const hasEffect = (card: Card): boolean =>
			CardEffectValidator.willCardHaveEffect(card, driver, rig, new BoardProjection({ battle }));

		const drawWith = (effect: { type: string; value: number }): Card => createTestCard({
			type: `${effect.type}_and_draw`,
			name: `${effect.type} and draw`,
			cost: 0,
			targetType: 'self',
			effects: [effect, { type: 'draw_cards', value: 2 }]
		});

		test('helps while its draw keeps a card, and not once it would burn them all', () => {
			const draw = createDrawCard(2);
			// Four cards, three once the draw has left the hand
			driver.set({ hand: [draw, ...createFillerCards(3)] });
			expect(hasEffect(draw)).toBe(true);

			driver.set({ handLimit: 3 });
			expect(hasEffect(draw)).toBe(false);
		});

		test('with an effect the validator doesn\'t judge still helps when its draw would burn', () => {
			const shieldAndDraw = drawWith({ type: 'gain_shield', value: 3 });
			driver.set({ hand: [shieldAndDraw, ...createFillerCards(3)], handLimit: 3 });

			expect(hasEffect(shieldAndDraw)).toBe(true);
		});

		test('with effects it judges useless doesn\'t help when its draw would burn', () => {
			const armorAndDraw = drawWith({ type: 'gain_armor', value: 3 });
			driver.set({ hand: [armorAndDraw, ...createFillerCards(3)], handLimit: 3 });

			expect(rig.armor).toBe(rig.maxArmor);
			expect(hasEffect(armorAndDraw)).toBe(false);
		});
	});
});
