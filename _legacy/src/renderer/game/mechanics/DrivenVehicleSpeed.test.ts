import { Battle } from './Battle';
import { Driver, DriverArchetype, DRIVER_CONFIGS } from './Driver';
import { createEscort } from './Escort';
import { Team, TeamType } from './Team';
import { Vehicle, createDrivenVehicle } from './Vehicle';
import { DriverLoader } from '../core/DriverLoader';

// Speed = driver speed + vehicle base speed (Combat Rules, Vehicle). Every
// place that builds a driven vehicle (the combat screen, the AI evaluator,
// the battle simulator) goes through createDrivenVehicle.
describe('Driven vehicle speed', () => {
	const driverOf = (archetype: DriverArchetype): Driver => {
		const driver = DriverLoader.getInstance().getDriver(archetype);
		if (!driver) throw new Error(`No ${archetype} driver`);
		return driver;
	};

	beforeAll(async () => {
		jest.spyOn(console, 'log').mockImplementation(() => undefined);
		await DriverLoader.getInstance().loadDrivers();
	});

	afterAll(() => {
		jest.restoreAllMocks();
	});

	test.each([
		['road_warrior', 1, 1, 2],
		['interceptor', 5, 3, 8],
		['mechanic', 2, 2, 4],
		['raider', 3, 2, 5]
	] as const)('the %s drives at base %i + driver %i = %i', (archetype, baseSpeed, driverSpeed, total) => {
		const vehicle = createDrivenVehicle({ driver: driverOf(archetype) });

		expect(vehicle.baseSpeed).toBe(baseSpeed);
		expect(vehicle.driver?.skills.speed).toBe(driverSpeed);
		expect(vehicle.speed).toBe(total);
	});

	test('every stock driver has a speed skill in the spec range', () => {
		Object.values(DRIVER_CONFIGS).forEach(config => {
			expect(config.skills.speed).toBeGreaterThanOrEqual(1);
			expect(config.skills.speed).toBeLessThanOrEqual(5);
		});
	});

	test('the stat block sets base speed and the driver counts once', () => {
		const driver = driverOf('mechanic');
		const vehicle = createDrivenVehicle({ driver });

		expect(vehicle.speed).toBe(driver.vehicleStats.speed + driver.skills.speed);
	});

	test('statuses add on top of both', () => {
		const vehicle = createDrivenVehicle({ driver: driverOf('raider') });
		vehicle.applyStatusEffect({ name: 'speed_boost', duration: 2, value: 3 });

		expect(vehicle.speed).toBe(3 + 2 + 3);
	});

	test('a passenger who takes the wheel brings their own speed', () => {
		const roadWarrior = driverOf('road_warrior');
		const interceptor = driverOf('interceptor');
		const rig = createDrivenVehicle({ driver: roadWarrior });
		rig.addPassenger(interceptor);
		expect(rig.speed).toBe(1 + 1);

		roadWarrior.hitpoints = 0;
		rig.handleDriverDeath();

		// The Rig's base 1 plus the Interceptor's 3, not the Lightning Bike's 5
		expect(rig.driver).toBe(interceptor);
		expect(rig.speed).toBe(1 + 3);
	});

	test('with nobody at the wheel only base speed is left', () => {
		const driver = driverOf('interceptor');
		const bike = createDrivenVehicle({ driver });

		driver.hitpoints = 0;
		bike.handleDriverDeath();

		expect(bike.speed).toBe(5);
	});

	describe('flanking against escorts', () => {
		// The combat screen's test raider: a base 3 buggy driven at speed 2
		const rustBuggy = (): Vehicle => {
			const driver = driverOf('mechanic');
			driver.set({ vehicleStats: { ...driver.vehicleStats, speed: 3 } });
			return createDrivenVehicle({ driver, name: 'Rust Buggy' });
		};

		const createBattle = (raiders: Vehicle[]): { battle: Battle; outrider: Vehicle } => {
			const outrider = createEscort({ type: 'outrider' });
			const battle = new Battle({
				playerTeam: new Team({
					type: TeamType.PLAYER,
					vehicles: [
						createDrivenVehicle({ driver: driverOf('road_warrior') }),
						createDrivenVehicle({ driver: driverOf('interceptor') }),
						outrider
					]
				}),
				enemyTeam: new Team({ type: TeamType.ENEMY, vehicles: raiders })
			});
			return { battle, outrider };
		};

		test('an Outrider (5) can\'t outrun a Rust Buggy (3 + 2 = 5): flanking needs strictly more speed', () => {
			const buggy = rustBuggy();
			const { battle, outrider } = createBattle([buggy]);

			expect(buggy.speed).toBe(5);
			expect(outrider.speed).toBe(5);
			expect(battle.getFlankBlocker(outrider, buggy)).toBe('Outrider is not faster than Rust Buggy');
		});

		test('an Outrider (5) outruns an Apocalypse Rig (1 + 1 = 2)', () => {
			const raiderRig = createDrivenVehicle({ driver: driverOf('road_warrior') });
			const { battle, outrider } = createBattle([raiderRig]);

			expect(raiderRig.speed).toBe(2);
			expect(battle.getFlankBlocker(outrider, raiderRig)).toBeNull();
		});

		test('a slowed Rust Buggy drops to where the Outrider outruns it', () => {
			const buggy = rustBuggy();
			const { battle, outrider } = createBattle([buggy]);
			buggy.applyStatusEffect({ name: 'caltrops', duration: -1, value: -2 });

			expect(buggy.speed).toBe(3);
			expect(battle.getFlankBlocker(outrider, buggy)).toBeNull();
		});
	});
});
