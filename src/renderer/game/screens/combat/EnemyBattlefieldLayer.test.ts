/**
 * @jest-environment jsdom
 */
import { DrawApi, TextCommand } from '../../../engine/draw';
import { ICON_ATLAS_ROLE } from '../../../engine/text/fontFaces';
import { installMeasuringDrawApi, MeasuringRecordingBackend } from '../../../engine/text/testing';
import { ICON_CODE_POINTS } from '../../../engine/text/icons';
import { Vehicle } from '../../mechanics/Vehicle';
import { EnemyBattlefieldLayer, EnemyIntent } from './EnemyBattlefieldLayer';

describe('EnemyBattlefieldLayer intent markers', () => {
	let backend: MeasuringRecordingBackend;
	let api: DrawApi;
	let layer: EnemyBattlefieldLayer;
	let raider: Vehicle;

	beforeEach(() => {
		({ api, backend } = installMeasuringDrawApi());

		raider = new Vehicle({
			name: 'Rust Buggy',
			structure: 30,
			maxStructure: 30,
			armor: 5,
			maxArmor: 5,
			baseSpeed: 2,
			slot: null,
			flank: null,
			velocity: 0,
			driver: null,
			passenger: null,
			statusEffects: [],
		});
		layer = new EnemyBattlefieldLayer({ id: 'enemies', x: 0, y: 0, width: 1440, height: 200 });
		layer.setVehicles([raider]);
	});

	/** The icon glyphs drawn in one frame, by name. */
	function iconsDrawn(): string[] {
		api.beginFrame({ viewport: { width: 1440, height: 882 } });
		layer.render();
		api.endFrame();
		const names = new Map(Object.entries(ICON_CODE_POINTS).map(([name, codePoint]) => [String.fromCodePoint(codePoint), name]));
		return backend.commands
			.filter((command): command is TextCommand => command.kind === 'text' && command.font === ICON_ATLAS_ROLE)
			.map((command) => names.get(command.text) ?? command.text);
	}

	function intent(type: EnemyIntent['type'], value?: number): EnemyIntent {
		return { type, value, description: type };
	}

	it('shows a shield for defend and a wrench for repair, beside the armor badge\'s shield', () => {
		layer.setVehicleIntent(raider.id, intent('defend', 6));
		expect(iconsDrawn()).toEqual(['shield', 'shield']);

		layer.setVehicleIntent(raider.id, intent('repair', 4));
		expect(iconsDrawn()).toEqual(['shield', 'build']);
	});

	it('shows the value, not an icon, for an attack', () => {
		layer.setVehicleIntent(raider.id, intent('attack', 15));
		expect(iconsDrawn()).toEqual(['shield']);
		expect(backend.commands.some((command) => command.kind === 'text' && command.text === '15')).toBe(true);
	});

	it('hides the icon with the marker when the intent clears', () => {
		layer.setVehicleIntent(raider.id, intent('defend', 6));
		layer.clearVehicleIntent(raider.id);
		expect(iconsDrawn()).toEqual(['shield']);
	});
});
