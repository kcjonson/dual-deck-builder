import { CatalogSection } from './CatalogSection';
import type { DeveloperSectionOptions } from './DeveloperSectionPanel';
import { Stack } from '../../../engine/components/Stack';
import { CombatLog, CombatLogType } from '../../mechanics/CombatLog';
import { LOG_DRAWER_WIDTH, TOP_BAR_HEIGHT } from '../combat/CombatLayout';
import { CombatLogLayer } from '../combat/CombatLogLayer';
import { TopBarLayer } from '../combat/TopBarLayer';

/** Short enough that the lines overflow and the drawer scrolls. */
const ROAD_HEIGHT = 320;
const FRAME_HEIGHT = TOP_BAR_HEIGHT + ROAD_HEIGHT;

/** A turn as the game logs it, from the lines Battle and the combat screen write. */
const LINES: readonly [number, string, CombatLogType][] = [
	[2, 'Rust Buggy plays Precision Shot', CombatLogType.ACTION],
	[2, 'Precision Shot misses Lightning Bike', CombatLogType.MISS],
	[2, 'Scrap Hauler plays Brace', CombatLogType.ACTION],
	[2, 'Brace adds 10 armor to Scrap Hauler', CombatLogType.ARMOR],
	[3, 'Your turn', CombatLogType.TURN],
	[3, 'The Interceptor plays Headshot', CombatLogType.ACTION],
	[3, 'Headshot deals 5 damage to Wasteland Raider', CombatLogType.DAMAGE],
	[3, 'The Road Warrior plays Armor Plating', CombatLogType.ACTION],
	[3, 'Armor Plating adds 8 armor to Apocalypse Rig', CombatLogType.ARMOR],
	[3, "The raiders' turn", CombatLogType.TURN],
	[3, 'Dust Crawler loses its speed edge on Lightning Bike and drops back to the raiders\' outside lane, behind', CombatLogType.INFO],
	[3, 'Scrapyard Juggernaut plays Ramming Speed', CombatLogType.ACTION],
	[3, 'Ramming Speed deals 24 total (18 to armor, 3 to structure, 3 to occupants) damage to Apocalypse Rig', CombatLogType.DAMAGE],
];

/**
 * The battle screen's top bar and its open log drawer held still for a
 * golden (DDB-140): the menu, wave 1 of 2 with raiders incoming, the turn,
 * the ticker of the newest line, and the drawer over the right of a road
 * stand-in, its lines wrapping and scrolled to the newest. It takes the
 * column's width at x1 rather than scaling the 1280 reference down, so its
 * buttons keep their size in the developer screen's narrower column; the
 * ticker gives up the difference, as it does on the stage.
 */
export class CombatLogSection extends CatalogSection {
	constructor(options: DeveloperSectionOptions = {}) {
		super({ id: 'dev_section_combat_log', title: 'Combat Log', ...options });

		const log = new CombatLog();
		for (const [turn, message, type] of LINES) log.addEntry({ message, type, turn });

		const drawer = new CombatLogLayer({
			id: 'dev_combat_log',
			positioned: 'absolute',
			anchor: 'topRight',
			width: LOG_DRAWER_WIDTH,
			heightMode: 'fill',
			combatLog: log,
		});
		drawer.openDrawer();

		const topBar = new TopBarLayer({ id: 'dev_combat_top_bar', combatLog: log, onToggleLog: () => drawer.toggle() });
		topBar.wave = { number: 1, total: 2, incoming: 2 };
		topBar.turn = 3;
		topBar.scrap = 150;
		topBar.fuel = 7;

		const road = new Stack({ id: 'dev_combat_log_road', heightMode: 'fill', style: { backgroundColor: '#1c1e20' } });
		road.addChild(drawer);

		const frame = new Stack({ id: 'dev_combat_log_frame', widthMode: 'fill', height: FRAME_HEIGHT, crossAlign: 'stretch' });
		frame.addChild(topBar);
		frame.addChild(road);

		this.addRow('top bar with menu, wave and incoming; the log drawer open, long lines wrapped and scrolled to the newest', frame, { fill: true });
	}
}
