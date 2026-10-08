import { DRIVER_CONFIGS } from '../mechanics/Driver';
import { cardCount, startingDeckCounts, totalCards } from './CardCounts';
import { DRIVER_ARCHETYPES, DriverRecord, DriverRecordJson, DriverRecordOptions, placeholderName } from './DriverRecord';

const recruit = (options: Partial<DriverRecordOptions> = {}): DriverRecord => new DriverRecord({
	id: 'driver-1',
	archetype: 'road_warrior',
	name: 'Road Warrior 1',
	...options
});

/** A record's JSON through JSON text and back, as a save does it. */
const throughText = (record: DriverRecord): unknown => JSON.parse(JSON.stringify(record));

describe('DriverRecord', () => {
	it.each(DRIVER_ARCHETYPES)('starts a new %s at full HP with their archetype\'s hand limit and starting deck, ready', (archetype) => {
		const record = recruit({ archetype });

		expect(record.hitpoints).toBe(DRIVER_CONFIGS[archetype].maxHitpoints);
		expect(record.maxHitpoints).toBe(DRIVER_CONFIGS[archetype].maxHitpoints);
		expect(record.handLimit).toBe(DRIVER_CONFIGS[archetype].handLimit);
		expect(record.defaultDeck).toEqual(startingDeckCounts(archetype));
		expect(record.status).toBe('ready');
		expect(record.injuredDays).toBe(0);
		expect(record.runsCompleted).toBe(0);
	});

	it('answers to its own id, never the model\'s runtime one', () => {
		// Two models, so two runtime ids, and neither reaches the record or its JSON
		const first = recruit();
		const second = recruit();

		expect(first.id).toBe('driver-1');
		expect(second.id).toBe('driver-1');
		expect(JSON.stringify(first)).toBe(JSON.stringify(second));
	});

	it('counts every copy in the default deck as its deck size', () => {
		expect(recruit().deckSize).toBe(totalCards(startingDeckCounts('road_warrior')));
		expect(recruit({ defaultDeck: {} }).deckSize).toBe(0);
	});

	describe('invariants', () => {
		it.each([
			['HP over max', { hitpoints: 41 }, 'DriverRecord.hitpoints must be an integer from 0 to maxHitpoints (40), got 41'],
			['negative HP', { hitpoints: -1 }, 'DriverRecord.hitpoints must be an integer >= 0, got -1'],
			['fractional HP', { hitpoints: 12.5 }, 'DriverRecord.hitpoints must be an integer >= 0, got 12.5'],
			['a max HP of 0', { maxHitpoints: 0, hitpoints: 0, status: 'dead' }, 'DriverRecord.maxHitpoints must be an integer >= 1, got 0'],
			['a dead driver with HP left', { status: 'dead' }, 'DriverRecord.hitpoints must be 0 for a dead driver, got 40'],
			['a dead driver who kept their cards', { status: 'dead', hitpoints: 0, defaultDeck: { headshot: 2 } }, 'DriverRecord.defaultDeck must be empty for a dead driver, whose cards went with them, got {"headshot":2}'],
			['0 HP on a living driver', { hitpoints: 0 }, 'DriverRecord.status must be dead at 0 hitpoints, got "ready"'],
			['an injury with no days to heal', { status: 'injured', hitpoints: 20 }, 'DriverRecord.injuredDays must be 1 or more for an injured driver, got 0'],
			['days to heal on a ready driver', { injuredDays: 2 }, 'DriverRecord.injuredDays must be 0 for a driver who is ready, got 2'],
			['days to heal on a missing driver', { status: 'missing', injuredDays: 1 }, 'DriverRecord.injuredDays must be 0 for a driver who is missing, got 1'],
			['a negative hand limit', { handLimit: -1 }, 'DriverRecord.handLimit must be an integer >= 0, got -1'],
			['a fractional hand limit', { handLimit: 6.5 }, 'DriverRecord.handLimit must be an integer >= 0, got 6.5'],
			['negative runs completed', { runsCompleted: -1 }, 'DriverRecord.runsCompleted must be an integer >= 0, got -1'],
			['an unknown status', { status: 'resting' }, 'DriverRecord.status must be one of ready, injured, dead, missing, got "resting"'],
			['a blank name', { name: '  ' }, 'DriverRecord.name must not be blank'],
			['a blank id', { id: '' }, 'DriverRecord.id must not be blank'],
			['a deck count of 0', { defaultDeck: { repair_kit: 0 } }, 'DriverRecord.defaultDeck.repair_kit must be an integer >= 1, got 0']
		])('rejects %s', (_label, options, message) => {
			expect(() => recruit(options as Partial<DriverRecordOptions>)).toThrow(message);
		});

		it('rejects an unknown archetype before reaching for its config', () => {
			expect(() => recruit({ archetype: 'mutant' } as unknown as Partial<DriverRecordOptions>))
				.toThrow('DriverRecord.archetype must be one of road_warrior, interceptor, mechanic, raider, got "mutant"');
		});

		it('takes a hand limit of 0, the least a record can hold', () => {
			expect(recruit({ handLimit: 0 }).handLimit).toBe(0);
		});
	});

	describe('set', () => {
		it('changes fields together with one change event: a driver comes home hurt', () => {
			const record = recruit();
			const changes = jest.fn();
			record.on('change', changes);

			record.set({ hitpoints: 12, status: 'injured', injuredDays: 3 });

			expect([record.hitpoints, record.status, record.injuredDays]).toEqual([12, 'injured', 3]);
			expect(changes).toHaveBeenCalledTimes(1);
		});

		it('checks the result as a whole, and changes nothing when it fails: dying is one call', () => {
			const record = recruit();
			const changes = jest.fn();
			record.on('change', changes);

			expect(() => record.set({ status: 'dead' })).toThrow('DriverRecord.hitpoints must be 0 for a dead driver, got 40');
			expect(() => record.set({ status: 'dead', hitpoints: 0 }))
				.toThrow('DriverRecord.defaultDeck must be empty for a dead driver, whose cards went with them, got {"armor_plating":3,');
			record.set({ status: 'dead', hitpoints: 0, defaultDeck: {} });

			expect([record.status, record.hitpoints, record.deckSize]).toEqual(['dead', 0, 0]);
			expect(changes).toHaveBeenCalledTimes(1);
		});

		it('never changes the id or the archetype', () => {
			const record = recruit();

			expect(() => record.set({ id: 'driver-9' })).toThrow('DriverRecord.id can\'t change, from "driver-1" to "driver-9"');
			expect(() => record.set({ archetype: 'mechanic' })).toThrow('DriverRecord.archetype can\'t change, from "road_warrior" to "mechanic"');
			record.set({ id: 'driver-1', archetype: 'road_warrior', name: 'Max' });

			expect([record.id, record.archetype, record.name]).toEqual(['driver-1', 'road_warrior', 'Max']);
		});

		it('rejects a field a record doesn\'t have', () => {
			expect(() => recruit().set({ adrenaline: 3 } as Partial<DriverRecordOptions>)).toThrow('DriverRecord has an unknown field "adrenaline"');
		});

		it('keeps the deck in its canonical, frozen form', () => {
			const record = recruit();

			record.set({ defaultDeck: { repair_kit: 1, armor_plating: 2 } });

			expect(Object.keys(record.defaultDeck)).toEqual(['armor_plating', 'repair_kit']);
			expect(Object.isFrozen(record.defaultDeck)).toBe(true);
		});

		it('is the only way in: the properties are read-only to the compiler', () => {
			const record = recruit();
			const assign = (): void => {
				// @ts-expect-error properties are read-only, so changes go through set's checks
				record.hitpoints = 99;
			};

			expect(assign).toBeInstanceOf(Function);
		});
	});

	describe('JSON', () => {
		it('writes exactly the record\'s fields, and nothing of the model\'s', () => {
			expect(Object.keys(recruit().toJSON())).toEqual([
				'id', 'archetype', 'name', 'hitpoints', 'maxHitpoints', 'injuredDays', 'handLimit', 'defaultDeck', 'status', 'runsCompleted'
			]);
		});

		it('reads back what it wrote, through JSON text', () => {
			const record = recruit({ hitpoints: 9, status: 'injured', injuredDays: 4, runsCompleted: 6, handLimit: 8 });
			record.set({ defaultDeck: { headshot: 1, ramming_speed: 3 } });

			const loaded = DriverRecord.fromJSON(throughText(record));

			expect(loaded).not.toBe(record);
			expect(loaded.toJSON()).toEqual(record.toJSON());
			expect(cardCount(loaded.defaultDeck, 'ramming_speed')).toBe(3);
		});

		it('hands out a copy, so editing the JSON leaves the record alone', () => {
			const record = recruit();
			const json = record.toJSON();

			json.defaultDeck.ramming_speed = 99;

			expect(cardCount(record.defaultDeck, 'ramming_speed')).toBe(5);
		});

		it.each([
			['a missing field', (json: DriverRecordJson) => { delete (json as Partial<DriverRecordJson>).runsCompleted; }, TypeError, 'DriverRecord.runsCompleted is missing'],
			['an unknown field', (json: DriverRecordJson) => { (json as unknown as Record<string, unknown>).adrenaline = 3; }, TypeError, 'DriverRecord has an unknown field "adrenaline"'],
			['HP in a string', (json: DriverRecordJson) => { (json as unknown as Record<string, unknown>).hitpoints = '40'; }, TypeError, 'DriverRecord.hitpoints must be a number, got "40"'],
			['a null deck', (json: DriverRecordJson) => { (json as unknown as Record<string, unknown>).defaultDeck = null; }, TypeError, 'DriverRecord.defaultDeck must be an object, got null'],
			['a hand limit below 0', (json: DriverRecordJson) => { json.handLimit = -2; }, RangeError, 'DriverRecord.handLimit must be an integer >= 0, got -2']
		])('rejects a save with %s', (_label, damage, errorType, message) => {
			const json = recruit().toJSON();
			damage(json);

			expect(() => DriverRecord.fromJSON(json)).toThrow(errorType);
			expect(() => DriverRecord.fromJSON(json)).toThrow(message);
		});

		it('rejects a save that isn\'t an object', () => {
			expect(() => DriverRecord.fromJSON('driver-1')).toThrow('DriverRecord must be an object, got "driver-1"');
		});
	});

	describe('placeholderName', () => {
		it.each([
			['road_warrior', 2, 'Road Warrior 2'],
			['interceptor', 1, 'Interceptor 1'],
			['mechanic', 3, 'Mechanic 3'],
			['raider', 1, 'Raider 1']
		] as const)('names a %s with ordinal %i "%s"', (archetype, ordinal, name) => {
			expect(placeholderName({ archetype, ordinal })).toBe(name);
		});
	});
});
