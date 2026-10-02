import { CatalogSection } from './CatalogSection';
import type { DeveloperSectionOptions } from './DeveloperSectionPanel';
import type { Component } from '../../../engine/components/Component';
import { Container } from '../../../engine/components/Container';
import { Rectangle } from '../../../engine/components/Rectangle';
import { Stack } from '../../../engine/components/Stack';
import { Text } from '../../../engine/components/Text';
import { tokens as theme } from '../../../engine/theme/tokens';
import { FlowWrap } from '../../ui/FlowWrap';
import { Driver, DriverRole } from '../../mechanics/Driver';
import { Vehicle as VehicleData, VehicleStatusEffect } from '../../mechanics/Vehicle';
import { createEscort } from '../../mechanics/Escort';
import { CombatModel } from '../combat/CombatModel';
import { EnemyIntent } from '../../ui/IntentPill';
import { TOKEN_HEIGHT, TOKEN_PASSENGER_HEIGHT, TOKEN_WIDTH, Vehicle, VehicleSide } from '../../ui/Vehicle';

/** A slot a little bigger than the token at x1, so each group reads as the road would place it. */
const SLOT_WIDTH = 210;
const SLOT_MARGIN = 4;
const CELL_GAP = 24;
const ROW_GAP = 16;
const CAPTION_GAP = 6;

interface GalleryVehicle {
	name: string;
	structure: [number, number];
	armor: number;
	speed: number;
	driver?: { name: string; hp: [number, number] } | null;
	passenger?: { name: string; hp: [number, number] };
	statuses?: VehicleStatusEffect[];
	shield?: number;
}

/** A driver as the battle makes one, with only what a token reads filled in. */
export function galleryDriver(name: string, [hitpoints, maxHitpoints]: [number, number], role = DriverRole.ACTIVE): Driver {
	return new Driver({
		archetype: 'road_warrior',
		metadata: { name, vehicleName: name, specialty: '', flavorText: '', unlocked: true },
		skills: { ramming: 4, gunnery: 4, evade: 4, speed: 0 },
		vehicleStats: { maxStructure: 50, weight: 2, armor: 5, speed: 3, gunnery: 4, evade: 4 },
		startingDeck: { cards: [] },
		hitpoints,
		maxHitpoints,
		adrenaline: 0,
		maxAdrenaline: 10,
		role,
		hand: [],
		discard: [],
		deck: null,
	});
}

function galleryVehicle({ name, structure, armor, speed, driver, passenger, statuses = [], shield = 0 }: GalleryVehicle): VehicleData {
	return new VehicleData({
		name,
		armor,
		maxArmor: armor,
		structure: structure[0],
		maxStructure: structure[1],
		baseSpeed: speed,
		slot: null,
		flank: null,
		velocity: 0,
		driver: driver === null || driver === undefined ? null : galleryDriver(driver.name, driver.hp),
		passenger: passenger ? galleryDriver(passenger.name, passenger.hp, DriverRole.PASSENGER) : null,
		statusEffects: statuses,
		shield,
	});
}

/**
 * The vehicle token (Battle Screen Design, section 3) in every state it
 * has, held still for a golden: both drivers' marks and an escort's,
 * raiders whose intents carry each target mark, a passenger row, more
 * statuses than the row holds, a long name cut with an ellipsis, a wreck
 * and an unmanned raider, the targeting outlines and dimming, the acting
 * raider's glow, and the
 * token filling slots at x1, x1.12, and x1.25.
 */
export class VehicleTokensSection extends CatalogSection {
	private readonly seats = new Map<Driver, 1 | 2>();
	/** Captioned groups side by side, wrapping where the section is narrower (the developer screen at 1024). */
	private readonly grid: FlowWrap;

	constructor(options: DeveloperSectionOptions = {}) {
		super({ id: 'dev_section_vehicle_tokens', title: 'Vehicle Tokens', ...options });
		this.grid = new FlowWrap({ id: 'dev_tokens_grid', widthMode: 'fill', gap: CELL_GAP, rowGap: ROW_GAP });
		this.addRow('every state the token has', this.grid);

		const rig = galleryVehicle({ name: 'Apocalypse Rig', structure: [54, 80], armor: 10, speed: 1, driver: { name: 'The Road Warrior', hp: [40, 40] }, statuses: [{ name: 'damage_bonus', duration: 2 }] });
		const bike = galleryVehicle({ name: 'Lightning Bike', structure: [31, 50], armor: 0, speed: 5, driver: { name: 'The Interceptor', hp: [18, 25] }, statuses: [{ name: 'speed_boost', duration: 3 }] });
		this.seat(rig, 1);
		this.seat(bike, 2);
		const medTruck = createEscort({ type: 'med_truck' });
		medTruck.spent = true;
		medTruck.shield = 3;
		this.cell('your drivers (triangle, diamond), a spent escort with Shield', this.tokens('dev_tokens_own', 'player', [rig, bike, medTruck]).row);

		const buggy = galleryVehicle({ name: 'Rust Buggy', structure: [22, 30], armor: 5, speed: 3, driver: { name: 'Wasteland Raider', hp: [30, 30] }, statuses: [{ name: 'vulnerable', duration: 2 }] });
		const hauler = galleryVehicle({ name: 'Scrap Hauler', structure: [64, 90], armor: 12, speed: 2, driver: { name: 'Hauler Boss', hp: [35, 35] } });
		const crawler = galleryVehicle({ name: 'Dust Crawler', structure: [18, 25], armor: 0, speed: 4, driver: { name: 'Crawler', hp: [20, 20] }, statuses: [{ name: 'speed_reduction', duration: 1 }] });
		const raiders = this.tokens('dev_tokens_raiders', 'raider', [buggy, hauler, crawler]);
		const plans: EnemyIntent[][] = [
			[
				{ type: 'attack', value: 6, hits: 3, valueText: '6x3', description: 'Burst', target: 'driver1' },
				{ type: 'attack', value: 6, description: 'Shoot', target: 'driver2' },
				{ type: 'defend', value: 10, description: 'Brace' },
			],
			[{ type: 'attack', value: 12, description: 'Spray', target: 'both' }],
			[
				{ type: 'attack', value: 5, description: 'Sideswipe', target: 'escort' },
				{ type: 'debuff', valueText: 'Oil', description: 'Oil Slick', target: 'driver2' },
			],
		];
		raiders.tokens.forEach((token, index) => {
			token.intents = plans[index];
		});
		this.cell('intent pills: a 6x3 multi-hit, the heavy tier at 12, marks for each target, two then +N', raiders.row);

		const elite = galleryVehicle({ name: 'Warlord Elite', structure: [70, 90], armor: 8, speed: 3, driver: { name: 'Warlord', hp: [45, 45] } });
		const crowded = galleryVehicle({ name: 'Chain Hauler', structure: [90, 90], armor: 12, speed: 2, driver: { name: 'Hauler', hp: [35, 35] } });
		const hidden = this.tokens('dev_tokens_hidden', 'raider', [elite, crowded]);
		hidden.tokens[0].intents = [
			{ type: 'attack', valueText: '?', description: '???', target: 'driver2' },
			{ type: 'defend', valueText: '?', description: '???' },
		];
		hidden.tokens[1].intents = [
			{ type: 'attack', value: 8, hits: 3, valueText: '8x3', description: 'Chain Sweep', target: 'both' },
			{ type: 'attack', value: 12, hits: 2, valueText: '12x2', description: 'Twin Ram', target: 'both' },
			{ type: 'debuff', valueText: 'Slow', description: 'Jam', target: 'driver1' },
		];
		this.cell('an elite hides its values; two wide pills give way to one and +N', hidden.row);

		const carrier = galleryVehicle({ name: 'Lightning Bike', structure: [31, 50], armor: 0, speed: 5, driver: { name: 'The Interceptor', hp: [18, 25] }, passenger: { name: 'The Road Warrior', hp: [12, 40] } });
		this.seat(carrier, 2);
		if (carrier.passenger) this.seats.set(carrier.passenger, 1);
		const outrider = createEscort({ type: 'outrider' });
		outrider.passenger = galleryDriver('The Interceptor', [9, 25], DriverRole.PASSENGER);
		this.seats.set(outrider.passenger, 2);
		this.cell('a passenger row (135 tall); an escort carrying one', this.tokens('dev_tokens_passenger', 'player', [carrier, outrider]).row);

		const loaded = galleryVehicle({
			name: 'Warlord Juggernaut',
			structure: [120, 150],
			armor: 15,
			speed: 2,
			driver: { name: 'Warlord', hp: [60, 60] },
			shield: 4,
			statuses: ['vulnerable', 'burn', 'stunned', 'speed_reduction', 'death_mark', 'triple_damage'].map((name) => ({ name, duration: 2 })),
		});
		const long = galleryVehicle({ name: 'Apocalypse Rig Mark Seven Deluxe', structure: [80, 80], armor: 10, speed: 1, driver: { name: 'The Road Warrior', hp: [40, 40] } });
		this.seat(long, 1);
		const busy = this.tokens('dev_tokens_overflow', 'raider', [loaded]);
		const named = this.tokens('dev_tokens_long', 'player', [long]);
		const both = new Container({ id: 'dev_tokens_overflow_long', width: SLOT_WIDTH * 2, height: busy.row.height });
		named.row.x = SLOT_WIDTH;
		both.addChild(busy.row);
		both.addChild(named.row);
		this.cell('five chips then +N; a long name ellipsized', both);

		const wreck = galleryVehicle({ name: 'Rust Buggy', structure: [0, 30], armor: 0, speed: 3, driver: { name: 'Wasteland Raider', hp: [4, 30] } });
		const unmanned = galleryVehicle({ name: 'Dust Crawler', structure: [12, 25], armor: 2, speed: 4, driver: null });
		this.cell('a wreck; a raider whose driver is down', this.tokens('dev_tokens_wrecked', 'raider', [wreck, unmanned]).row);

		const model = new CombatModel();
		const valid = galleryVehicle({ name: 'Rust Buggy', structure: [22, 30], armor: 5, speed: 3, driver: { name: 'Wasteland Raider', hp: [30, 30] } });
		const aimed = galleryVehicle({ name: 'Scrap Hauler', structure: [64, 90], armor: 12, speed: 2, driver: { name: 'Hauler Boss', hp: [35, 35] } });
		const outOfReach = galleryVehicle({ name: 'Dust Crawler', structure: [18, 25], armor: 0, speed: 4, driver: { name: 'Crawler', hp: [20, 20] } });
		model.isTargeting = true;
		model.targetableVehicleIds = [valid.id, aimed.id];
		model.focusedVehicleId = aimed.id;
		this.cell('targeting: in reach, aimed at, out of reach', this.tokens('dev_tokens_targeting', 'raider', [valid, aimed, outOfReach], model).row);

		const actor = galleryVehicle({ name: 'Rust Buggy', structure: [22, 30], armor: 5, speed: 3, driver: { name: 'Wasteland Raider', hp: [30, 30] } });
		const acting = this.tokens('dev_tokens_acting', 'raider', [actor]);
		acting.tokens[0].intents = [{ type: 'attack', value: 8, description: 'Ram', target: 'driver1' }];
		acting.tokens[0].acting = true;
		this.cell('the raider acting in the enemy turn glows', acting.row);

		this.cell('filling a slot: x1, x1.12, x1.25 (the cap)', this.fitRow());
	}

	/** A caption over `content`, one cell of the wrapping grid. */
	private cell(caption: string, content: Component): void {
		const cell = new Stack({ gap: CAPTION_GAP });
		cell.addChild(new Text({ text: caption, width: content.width, style: { fontSize: theme.fontSize.fs_base, color: 'text_dim' } }));
		cell.addChild(content);
		this.grid.addChild(cell);
	}

	private seat(vehicle: VehicleData, seat: 1 | 2): void {
		if (vehicle.driver) this.seats.set(vehicle.driver, seat);
	}

	/** Tokens side by side, each at x1 in a slot of its own. */
	private tokens(id: string, side: VehicleSide, vehicles: VehicleData[], combatData?: CombatModel): { row: Container; tokens: Vehicle[] } {
		const slotHeight = Math.max(...vehicles.map((vehicle) => (vehicle.passenger ? TOKEN_PASSENGER_HEIGHT : TOKEN_HEIGHT))) + SLOT_MARGIN;
		const row = new Container({ id, width: SLOT_WIDTH * vehicles.length, height: slotHeight });
		const tokens = vehicles.map((vehicleData, index) => {
			const token = new Vehicle({
				id: `${id}_${index}`,
				vehicleData,
				side,
				combatData,
				seatOf: (driver) => this.seats.get(driver) ?? null,
				onClick: combatData ? () => undefined : undefined,
			});
			token.fitToSlot({ x: index * SLOT_WIDTH, y: 0, width: SLOT_WIDTH, height: slotHeight }, 1);
			row.addChild(token);
			return token;
		});
		return { row, tokens };
	}

	/** Slot outlines under the tokens that fill them. */
	private fitRow(): Container {
		const scales = [1, 1.12, 1.25];
		// The last slot is bigger than x1.25 needs, to show the cap
		const slots = scales.map((scale, index) => ({
			width: Math.ceil(TOKEN_WIDTH * scale) + 6 + (index === 2 ? 30 : 0),
			height: Math.ceil(TOKEN_HEIGHT * scale) + 4 + (index === 2 ? 10 : 0),
		}));
		const gap = 16;
		const width = slots.reduce((sum, slot) => sum + slot.width + gap, 0);
		const height = Math.max(...slots.map((slot) => slot.height));
		const row = new Container({ id: 'dev_tokens_fit', width, height });
		let x = 0;
		slots.forEach((slot, index) => {
			const rect = { x, y: 0, width: slot.width, height: slot.height };
			row.addChild(new Rectangle({
				id: `dev_tokens_fit_slot_${index}`,
				...rect,
				zIndex: 0,
				pointerEvents: 'none',
				style: { backgroundColor: 'transparent', borderColor: 'line_edge', borderWidth: 1, borderRadius: 4 },
			}));
			const vehicleData = galleryVehicle({ name: 'Rust Buggy', structure: [22, 30], armor: 5, speed: 3, driver: { name: 'Wasteland Raider', hp: [30, 30] } });
			const token = new Vehicle({ id: `dev_tokens_fit_${index}`, vehicleData, side: 'raider', zIndex: 1 });
			token.fitToSlot(rect);
			row.addChild(token);
			x += slot.width + gap;
		});
		return row;
	}
}
