import { Component, ComponentOptions, ResolvedColors } from '../components/Component';
import { Text } from '../components/Text';
import type { DrawApi } from '../draw/DrawApi';
import type { RGBA } from '../draw/geometry';
import { tokens } from '../theme/tokens';
import { rgba } from './surfaces';

export interface AvatarOptions extends Omit<ComponentOptions, 'style' | 'width' | 'height'> {
	/** A name or id: the same seed is always the same colour and initials. */
	seed: string;
	/** The disc's diameter. Default 32. */
	size?: number;
	/** 0 to 1, shown as a ring banded critical below 0.30, warning below 0.55, ok above; none without one. */
	mood?: number | null;
	selected?: boolean;
}

/** R12.27's mood bands. */
export const MOOD_CRIT = 0.3;
export const MOOD_WARN = 0.55;

const RING = tokens.borderWidth.bw_thick;
const RING_GAP = tokens.borderWidth.bw_hair;
const SATURATION = 0.42;
const LIGHTNESS = 0.34;
const { color } = tokens;

/** R12.27: 32-bit FNV-1a over the seed's UTF-16 code units. */
export function fnv1a(seed: string): number {
	let hash = 0x811c9dc5;
	for (let index = 0; index < seed.length; index += 1) {
		hash ^= seed.charCodeAt(index);
		hash = Math.imul(hash, 0x01000193) >>> 0;
	}
	return hash >>> 0;
}

/** The first letter of each of the first two words, upper-cased. */
export function initialsOf(seed: string): string {
	return seed.trim().split(/\s+/).filter(Boolean).slice(0, 2)
		.map((word) => String.fromCodePoint(word.codePointAt(0) ?? 0x20).toUpperCase())
		.join('');
}

export function moodColor(mood: number): RGBA {
	if (mood < MOOD_CRIT) return color.status_crit;
	if (mood < MOOD_WARN) return color.status_warn;
	return color.status_ok;
}

function hslToRgba(hue: number, saturation: number, lightness: number): RGBA {
	const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
	const sector = hue / 60;
	const second = chroma * (1 - Math.abs((sector % 2) - 1));
	const [r, g, b] = sector < 1 ? [chroma, second, 0]
		: sector < 2 ? [second, chroma, 0]
			: sector < 3 ? [0, chroma, second]
				: sector < 4 ? [0, second, chroma]
					: sector < 5 ? [second, 0, chroma]
						: [chroma, 0, second];
	const match = lightness - chroma / 2;
	return [r + match, g + match, b + match, 1];
}

/**
 * R12.27's avatar: a disc in a hue hashed from `seed` (FNV-1a, so a driver
 * keeps their colour across runs and machines) with the seed's initials,
 * a mood ring when `mood` is given, and the accent ring outside that when
 * `selected`. Both rings are outside the disc, so they are ink (R8.8), not
 * size: avatars line up by their discs.
 */
export class Avatar extends Component {
	private seedValue: string;
	private readonly diameter: number;
	private moodValue: number | null;
	private hue: RGBA;
	private readonly initials: Text;

	constructor({ seed, size = 32, mood = null, selected = false, ...options }: AvatarOptions) {
		super({ ...options, width: size, height: size });
		this.componentType = 'Avatar';
		this.seedValue = seed;
		this.diameter = size;
		this.moodValue = mood;
		this.hue = hslToRgba(fnv1a(seed) % 360, SATURATION, LIGHTNESS);
		this.initials = new Text(initialsOf(seed), {
			width: size,
			height: size,
			style: {
				fontFamily: 'display',
				fontSize: Math.round(size * 0.42),
				color: rgba(color.text_bright),
				textAlign: 'center',
				verticalAlign: 'middle',
				whiteSpace: 'nowrap',
			},
		});
		this.addPart(this.initials);
		if (selected) this.selected = true;
	}

	public get seed(): string {
		return this.seedValue;
	}

	public set seed(seed: string) {
		this.seedValue = seed;
		this.hue = hslToRgba(fnv1a(seed) % 360, SATURATION, LIGHTNESS);
		this.initials.setText(initialsOf(seed));
	}

	public get discColor(): RGBA {
		return this.hue;
	}

	public get initialsText(): string {
		return this.initials.getText();
	}

	public get mood(): number | null {
		return this.moodValue;
	}

	public set mood(mood: number | null) {
		if ((mood === null) !== (this.moodValue === null)) this.invalidateInk();
		this.moodValue = mood;
	}

	/** R11.11's `selected`, drawn as the accent ring. */
	public get selected(): boolean {
		return super.selected;
	}

	public set selected(selected: boolean) {
		if (selected === super.selected) return;
		super.selected = selected;
		this.invalidateInk();
	}

	/** The mood ring, and the selection ring outside it. */
	public get inkExtent(): number {
		let extent = 0;
		if (this.moodValue !== null) extent += RING_GAP + RING;
		if (this.selected) extent += RING_GAP + RING;
		return extent;
	}

	public get resolvedColors(): ResolvedColors {
		return { fill: this.hue, text: color.text_bright, border: this.moodValue !== null ? moodColor(this.moodValue) : undefined };
	}

	public render(draw: DrawApi): void {
		const radius = this.diameter / 2;
		const center = { x: radius, y: radius };
		let ring = radius;
		if (this.moodValue !== null) {
			ring += RING_GAP + RING;
			draw.drawCircle({ center, radius: ring, fill: [0, 0, 0, 0], border: { color: moodColor(this.moodValue), width: RING } });
		}
		if (this.selected) {
			ring += RING_GAP + RING;
			draw.drawCircle({ center, radius: ring, fill: [0, 0, 0, 0], border: { color: color.accent, width: RING } });
		}
		draw.drawCircle({ id: this.id ?? undefined, center, radius, fill: this.hue });
	}
}
