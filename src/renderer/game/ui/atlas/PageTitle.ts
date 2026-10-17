import { Stack, StackOptions } from '../../../engine/components/Stack';
import { Text } from '../../../engine/components/Text';
import { ATLAS } from './atlasStyle';

export interface PageTitleOptions extends Omit<StackOptions, 'style' | 'direction'> {
	title: string;
	/** Beside the title in body type: the day, a count, where the page sits. Absent, there's none. */
	subtitle?: string;
	titleId?: string;
	subtitleId?: string;
}

/** Screen titles: display 700 in spaced capitals, 32 to 34 px (UI Art Direction, Type). */
const TITLE_SIZE = 34;
const SUBTITLE_SIZE = 16;
const GAP = 16;

/**
 * A sheet's title, top left, as the compound plate's "THE COMPOUND, day 9,
 * dawn": the title in display 700 spaced capitals and an optional subtitle
 * after it. The subtitle is set in body until the serif italic role lands
 * (UI Art Direction, Type). Short of room, both shrink with an ellipsis
 * (R10.7) rather than run past the sheet.
 */
export class PageTitle extends Stack {
	private readonly titleText: Text;
	private readonly subtitleText: Text | null;

	constructor({ title, subtitle, titleId, subtitleId, ...options }: PageTitleOptions) {
		super({ widthMode: 'fill', crossAlign: 'center', gap: GAP, ...options, direction: 'horizontal' });
		this.componentType = 'PageTitle';
		this.titleText = new Text({
			id: titleId,
			text: title,
			style: { fontRole: 'display', fontWeight: 700, fontSize: TITLE_SIZE, letterSpacing: ATLAS.headTracking, textTransform: 'uppercase', color: 'text' },
			wrap: 'none',
			textOverflow: 'ellipsis',
		});
		this.addChild(this.titleText);
		this.subtitleText = subtitle !== undefined
			? new Text({ id: subtitleId, text: subtitle, style: { fontSize: SUBTITLE_SIZE, color: 'text_dim' }, wrap: 'none', textOverflow: 'ellipsis' })
			: null;
		if (this.subtitleText) this.addChild(this.subtitleText);
	}

	public get title(): string {
		return this.titleText.text;
	}

	public set title(title: string) {
		this.titleText.text = title;
	}

	public get subtitle(): string | null {
		return this.subtitleText?.text ?? null;
	}

	public set subtitle(subtitle: string | null) {
		if (!this.subtitleText) throw new Error('PageTitle: a title built without a subtitle has no place for one');
		this.subtitleText.text = subtitle ?? '';
	}
}
