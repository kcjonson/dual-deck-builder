import { CatalogSection } from './CatalogSection';
import { Stack } from '../../../engine/components/Stack';
import { tokens } from '../../../engine/theme/tokens';
import { Avatar } from '../../../engine/ui/Avatar';
import { BADGE_HEIGHT, Badge } from '../../../engine/ui/Badge';
import { Divider } from '../../../engine/ui/Divider';
import { KeyCap } from '../../../engine/ui/KeyCap';
import { Stat } from '../../../engine/ui/Stat';

/**
 * R12.26 to R12.29: badges filled, outlined, and with a status dot; avatars
 * hashed from their seeds with mood rings in each band and a selection ring;
 * stats at the three sizes with units on the value's baseline; key caps; and
 * dividers plain and captioned.
 */
export class DataDisplaySection extends CatalogSection {
	constructor(x: number, y: number, width: number) {
		super({ id: 'dev_section_data_display', title: 'Badges, Avatars, Stats', x, y, width });

		this.addRow('badges: default, accent, data, ok, warn, crit; outlined; with a dot', this.line([
			new Badge({ id: 'dev_badge_default', label: 'Idle' }),
			new Badge({ label: 'Active', tone: 'accent' }),
			new Badge({ label: 'Intel', tone: 'data' }),
			new Badge({ label: 'Ready', tone: 'ok' }),
			new Badge({ label: 'Low fuel', tone: 'warn' }),
			new Badge({ label: 'Breached', tone: 'crit' }),
			new Badge({ id: 'dev_badge_outline', label: 'Escort', tone: 'data', outline: true }),
			new Badge({ label: 'Draft', outline: true }),
			new Badge({ id: 'dev_badge_dot', label: 'Online', tone: 'ok', dot: true, outline: true }),
			new Badge({ id: 'dev_badge_dot_alone', label: '', tone: 'crit', dot: true }),
		], tokens.space.space_2), BADGE_HEIGHT);

		const avatarSize = 40;
		this.addRow('avatars: mood crit, warn, ok; none; selected', this.line([
			new Avatar({ id: 'dev_avatar_rook', seed: 'Rook Valdez', size: avatarSize, mood: 0.2 }),
			new Avatar({ seed: 'Mara Quill', size: avatarSize, mood: 0.45 }),
			new Avatar({ seed: 'Dusty Okafor', size: avatarSize, mood: 0.8 }),
			new Avatar({ seed: 'Scrap King', size: avatarSize }),
			new Avatar({ id: 'dev_avatar_selected', seed: 'Ada Kestrel', size: avatarSize, mood: 0.6, selected: true }),
			new Avatar({ seed: 'Wren', size: 24 }),
		], tokens.space.space_4), avatarSize);

		const stats = new Stack({ direction: 'horizontal', gap: tokens.space.space_10, crossAlign: 'end' });
		stats.addChild(new Stat({ id: 'dev_stat_speed', label: 'Top speed', value: 142, unit: 'km/h', size: 'lg' }));
		stats.addChild(new Stat({ label: 'Armor', value: 12, unit: '/ 18', size: 'md', tone: 'data' }));
		stats.addChild(new Stat({ label: 'Hull', value: 0.2, size: 'md', tone: 'auto' }));
		stats.addChild(new Stat({ label: 'Scrap', value: 1240, size: 'sm' }));
		stats.addChild(new Stat({ label: 'Turn', value: 7, size: 'sm', align: 'right', width: 80 }));
		this.addRow('stats: lg with unit, md toned, auto, sm, right-aligned', stats, 64);

		this.addRow('key caps', this.line([
			new KeyCap({ label: 'R' }),
			new KeyCap({ label: 'Esc' }),
			new KeyCap({ label: 'Space', size: 'md' }),
		], tokens.space.space_2), 24);

		const dividers = new Stack({ direction: 'vertical', gap: tokens.space.space_4, width: 480, crossAlign: 'stretch' });
		dividers.addChild(new Divider({ id: 'dev_divider_plain' }));
		dividers.addChild(new Divider({ id: 'dev_divider_caption', caption: 'Escorts' }));
		this.addRow('dividers: plain and captioned', dividers, 40);
	}
}
