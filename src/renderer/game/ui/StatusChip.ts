import { Component, ComponentOptions } from '../../engine/components/Component';
import { drawIcon, DrawIconOptions } from '../../engine/components/Icon';
import type { DrawApi } from '../../engine/draw/DrawApi';
import type { DrawRectOptions, DrawTextOptions } from '../../engine/draw/commands';
import type { RGBA } from '../../engine/draw/geometry';
import type { IconName } from '../../engine/text/icons';
import { resolveColor } from '../../engine/style/styleObject';
import { tokens } from '../../engine/theme/tokens';
import type { VehicleStatusEffect } from '../mechanics/Vehicle';

/** A buff is structure green, a debuff the mock's purple, anything else neutral. */
export type StatusKind = 'buff' | 'debuff' | 'neutral';

/** What a chip shows: an icon and a count, a label ("SPENT"), or the "+N" past the row's room. */
export type StatusChipContent =
	| { kind: 'status'; icon: IconName; tone: StatusKind; count: number | null; title: string; detail?: string }
	| { kind: 'label'; text: string; title: string; detail?: string }
	| { kind: 'more'; count: number; detail: string };

interface StatusLook {
	icon: IconName;
	tone: StatusKind;
	title: string;
	detail: string;
}

/**
 * Each status the battle applies (Battle.applyStatus, cards.json, Combat
 * Rules), as a chip: the icon is the shape twin of its colour (section 7).
 * A status missing here still shows, as a neutral info chip with its name.
 */
const STATUS_LOOKS: Readonly<Record<string, StatusLook>> = {
	vulnerable: { icon: 'gpp_bad', tone: 'debuff', title: 'Vulnerable', detail: 'Takes extra damage from hits.' },
	speed_reduction: { icon: 'keyboard_double_arrow_left', tone: 'debuff', title: 'Slowed', detail: 'Speed is reduced.' },
	oil_slick: { icon: 'keyboard_double_arrow_left', tone: 'debuff', title: 'Oil Slick', detail: 'Speed is reduced.' },
	caltrops: { icon: 'keyboard_double_arrow_left', tone: 'debuff', title: 'Caltrops', detail: 'Speed is reduced.' },
	slow: { icon: 'keyboard_double_arrow_left', tone: 'debuff', title: 'Slowed', detail: 'Speed is reduced.' },
	permanent_speed_loss: { icon: 'keyboard_double_arrow_left', tone: 'debuff', title: 'Crippled', detail: 'Speed is reduced for the rest of the fight.' },
	speed_boost: { icon: 'keyboard_double_arrow_right', tone: 'buff', title: 'Speed boost', detail: 'Speed is raised.' },
	speed_plus: { icon: 'keyboard_double_arrow_right', tone: 'buff', title: 'Speed boost', detail: 'Speed is raised.' },
	nitro_boost: { icon: 'keyboard_double_arrow_right', tone: 'buff', title: 'Nitro', detail: 'Speed is raised.' },
	burn: { icon: 'local_fire_department', tone: 'debuff', title: 'Burning', detail: 'Takes damage each turn.' },
	stunned: { icon: 'flash_on', tone: 'debuff', title: 'Stunned', detail: 'Skips its next action.' },
	death_mark: { icon: 'my_location', tone: 'debuff', title: 'Marked', detail: 'Marked for a heavy hit.' },
	damage_bonus: { icon: 'gps_fixed', tone: 'buff', title: 'Damage up', detail: 'The next attack hits harder.' },
	triple_damage: { icon: 'gps_fixed', tone: 'buff', title: 'Triple damage', detail: 'The next attack deals triple damage.' },
};

/** A status as its chip shows it; the count is its turns left, none when permanent. */
export function statusChipContent(effect: VehicleStatusEffect): StatusChipContent {
	const look = STATUS_LOOKS[effect.name];
	const turns = effect.duration > 0 ? effect.duration : null;
	const remaining = turns === null ? 'Lasts the fight.' : `${turns} turn${turns === 1 ? '' : 's'} left.`;
	if (!look) {
		const title = effect.name.replace(/_/g, ' ');
		return { kind: 'status', icon: 'info', tone: 'neutral', count: turns, title: title.charAt(0).toUpperCase() + title.slice(1), detail: `${effect.description ?? ''} ${remaining}`.trim() };
	}
	return { kind: 'status', icon: look.icon, tone: look.tone, count: turns, title: look.title, detail: `${effect.description ?? look.detail} ${remaining}` };
}

/** Shield (temporary armor) as a chip: it soaks hits before armor and clears at the start of your turn. */
export function shieldChipContent(shield: number): StatusChipContent {
	return { kind: 'status', icon: 'shield', tone: 'buff', count: shield, title: `Shield ${shield}`, detail: 'Soaks damage before armor. Clears at the start of your turn.' };
}

export const STATUS_CHIP_SIZE = 20;
/** "+N" and "SPENT" are as wide as they read, inside the row's height. */
const MORE_WIDTH = 24;
const LABEL_WIDTH = 40;
const ICON_SIZE = 14;
const COUNT_SIZE = 11;
const COUNT_HEIGHT = 11;
/** JetBrains Mono's advance is 0.6 em; the count's backing is sized from it rather than measured each frame. */
const MONO_ADVANCE = 0.6;
const LABEL_SIZE = 11;
const MORE_SIZE = 11;
const RADIUS = 3;

const BACKGROUND = resolveColor('#0d0e0f');
const BORDER = tokens.color.line_edge;
const COUNT_BACKGROUND = resolveColor('#000000');
const TONES: Readonly<Record<StatusKind, RGBA>> = {
	buff: resolveColor('#8fbf5c'),
	debuff: resolveColor('#d3a6f0'),
	neutral: tokens.color.text_dim,
};
const LABEL_COLOR = resolveColor('#ffcc66');

/**
 * One chip in a token's status row (Battle Screen Design, section 3): a
 * 20 px square with the status's icon and its turns left in the corner, a
 * "SPENT" label leading an escort's row, or "+N" for what the row has no
 * room for. Draws its own parts; its tooltip names the status, so hovering
 * a chip explains it while the plate around it stays the target.
 */
export class StatusChip extends Component {
	private content: StatusChipContent | null = null;
	private readonly boxDraw: DrawRectOptions = { rect: { x: 0, y: 0, width: STATUS_CHIP_SIZE, height: STATUS_CHIP_SIZE }, fill: BACKGROUND, radius: RADIUS, border: { color: BORDER, width: 1 } };
	private readonly iconDraw: DrawIconOptions = { glyph: 'info', size: ICON_SIZE, tint: TONES.neutral, box: { x: 0, y: 0, width: STATUS_CHIP_SIZE, height: STATUS_CHIP_SIZE } };
	private readonly countBackDraw: DrawRectOptions = { rect: { x: 0, y: 0, width: 0, height: COUNT_HEIGHT }, fill: COUNT_BACKGROUND, radius: 2 };
	private readonly textDraw: DrawTextOptions = { text: '', box: { x: 0, y: 0, width: 0, height: 0 }, font: 'mono', size: COUNT_SIZE, color: tokens.color.text_bright, align: 'center', verticalAlign: 'middle', wrap: 'none' };

	constructor(options: ComponentOptions = {}) {
		super({ ...options, width: STATUS_CHIP_SIZE, height: STATUS_CHIP_SIZE });
		this.componentType = 'StatusChip';
		this.visible = false;
	}

	/** The width a chip with this content takes in the row. */
	static widthOf(content: StatusChipContent): number {
		if (content.kind === 'more') return MORE_WIDTH;
		if (content.kind === 'label') return LABEL_WIDTH;
		return STATUS_CHIP_SIZE;
	}

	get chip(): StatusChipContent | null {
		return this.content;
	}

	set chip(content: StatusChipContent | null) {
		this.content = content;
		this.visible = content !== null;
		if (!content) {
			this.tooltip = null;
			return;
		}
		const width = StatusChip.widthOf(content);
		if (width !== this.width) this.setSize(width, STATUS_CHIP_SIZE);
		this.boxDraw.rect.width = width;
		this.tooltip = content.kind === 'more'
			? { title: `${content.count} more`, description: content.detail }
			: { title: content.title, description: content.detail };

		const text = this.textDraw;
		const box = text.box as { x: number; y: number; width: number; height: number };
		if (content.kind === 'status') {
			this.iconDraw.glyph = content.icon;
			this.iconDraw.tint = TONES[content.tone];
			// The icon up and left of centre when a count sits in the corner
			const offset = content.count === null ? 0 : -2;
			this.iconDraw.box = { x: offset, y: offset, width: STATUS_CHIP_SIZE, height: STATUS_CHIP_SIZE };
			text.text = content.count === null ? '' : `${content.count}`;
			text.size = COUNT_SIZE;
			text.color = tokens.color.text_bright;
			const countWidth = Math.ceil(text.text.length * COUNT_SIZE * MONO_ADVANCE) + 2;
			const back = this.countBackDraw.rect as { x: number; y: number; width: number; height: number };
			back.x = STATUS_CHIP_SIZE - countWidth;
			back.y = STATUS_CHIP_SIZE - COUNT_HEIGHT;
			back.width = countWidth;
			box.x = back.x;
			box.y = back.y;
			box.width = countWidth;
			box.height = COUNT_HEIGHT;
			return;
		}
		text.text = content.kind === 'more' ? `+${content.count}` : content.text;
		text.size = content.kind === 'more' ? MORE_SIZE : LABEL_SIZE;
		text.color = content.kind === 'more' ? tokens.color.text_dim : LABEL_COLOR;
		box.x = 0;
		box.y = 0;
		box.width = width;
		box.height = STATUS_CHIP_SIZE;
	}

	public render(draw: DrawApi): void {
		const content = this.content;
		if (!content) return;
		draw.drawRect(this.boxDraw);
		if (content.kind === 'status') {
			drawIcon(draw, this.iconDraw);
			if (content.count === null) return;
			draw.drawRect(this.countBackDraw);
		}
		draw.drawText(this.textDraw);
	}
}
