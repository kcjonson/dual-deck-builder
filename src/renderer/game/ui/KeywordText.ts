import { Component, ComponentOptions } from '../../engine/components/Component';
import { Text } from '../../engine/components/Text';
import type { FontRole } from '../../engine/text/fontFaces';
import { keywordWords } from '../data/keywords';

export interface KeywordTextOptions extends ComponentOptions {
	text: string;
	/** `bracketed` for a summary, `auto` for the full text (see `keywordWords`). */
	mode: 'bracketed' | 'auto';
	fontSize: number;
	/** The line box, logical pixels. */
	lineHeight: number;
	color: string;
	keywordColor: string;
	/** Lines past this are not drawn; a card data check keeps text from reaching it. */
	maxLines?: number;
	font?: FontRole;
}

/**
 * Rules text with its keywords in their own colour (Battle Screen Design,
 * sections 5 and 7). The engine's text draws one colour per run, so this
 * lays the words out itself: each keyword or plain stretch of a word is a
 * hugging `Text`, measured through the mount context like any other, and
 * the words wrap greedily at the box's width on the measured widths. Its
 * width is fixed; its owner sets the height, usually from `reflow`.
 */
export class KeywordText extends Component {
	private readonly pieces: Text[][] = [];
	private readonly keywordLabels = new Set<Text>();
	private readonly font: FontRole;
	private readonly fontSize: number;
	private readonly lineBox: number;
	private readonly maxLines: number;
	private plainColor: string;
	private highlightColor: string;
	private lines = 0;

	constructor({ text, mode, fontSize, lineHeight, color, keywordColor, maxLines = Infinity, font = 'body', ...options }: KeywordTextOptions) {
		super(options);
		this.componentType = 'KeywordText';
		this.font = font;
		this.fontSize = fontSize;
		this.lineBox = lineHeight;
		this.maxLines = maxLines;
		this.plainColor = color;
		this.highlightColor = keywordColor;
		keywordWords(text, mode).forEach((word, wordIndex) => {
			this.pieces.push(word.map((piece, pieceIndex) => {
				const label = new Text({
					text: piece.text,
					id: this.id === null ? undefined : `${this.id}_w${wordIndex}_${pieceIndex}`,
					style: { fontRole: font, fontSize, color: piece.keyword ? keywordColor : color },
					lineHeight: lineHeight / fontSize,
					wrap: 'none',
				});
				if (piece.keyword) this.keywordLabels.add(label);
				// Parts, not children: the words are this component's drawing, and
				// on a turned card their boxes' screen extents touch line to line
				this.addPart(label);
				return label;
			}));
		});
	}

	/** Lines the text needs at its width, drawn or not; zero until it can measure. */
	public get lineCount(): number {
		return this.lines;
	}

	/** The words as drawn, keyword pieces flagged, for tests and the card data check. */
	public get words(): { text: string; keyword: boolean }[][] {
		return this.pieces.map((word) => word.map((label) => ({ text: label.text, keyword: this.isKeyword(label) })));
	}

	private isKeyword(label: Text): boolean {
		return this.keywordLabels.has(label);
	}

	/** Recolours both kinds of piece, as a dimmed card does. */
	public setColors(color: string, keywordColor: string): void {
		if (color === this.plainColor && keywordColor === this.highlightColor) return;
		for (const word of this.pieces) {
			for (const label of word) {
				const keyword = this.isKeyword(label);
				label.style = { ...label.style, color: keyword ? keywordColor : color };
			}
		}
		this.plainColor = color;
		this.highlightColor = keywordColor;
	}

	protected layoutChildren(): void {
		this.reflow();
	}

	/**
	 * Places every word on the measured widths and returns the line count.
	 * A word wider than the box takes a line of its own and overruns it.
	 */
	public reflow(): number {
		const space = this.spaceWidth();
		if (space === null) {
			this.lines = 0;
			return 0;
		}
		let line = 0;
		let x = 0;
		for (const word of this.pieces) {
			let wordWidth = 0;
			for (const label of word) wordWidth += label.measured?.width ?? 0;
			if (x > 0 && x + space + wordWidth > this.width) {
				line++;
				x = 0;
			} else if (x > 0) {
				x += space;
			}
			const shown = line < this.maxLines;
			for (const label of word) {
				label.setPosition(x, line * this.lineBox);
				label.visible = shown;
				x += label.measured?.width ?? 0;
			}
		}
		this.lines = this.pieces.length > 0 ? line + 1 : 0;
		return this.lines;
	}

	/** The gap between words, from the face's own advance; null while nothing can measure. */
	private spaceWidth(): number | null {
		const draw = this.context?.draw;
		if (!draw || !draw.canMeasureText(this.font)) return null;
		const measure = (text: string) => draw.measureText({ text, font: this.font, size: this.fontSize, wrap: 'none' }).width;
		return measure('x x') - measure('xx');
	}
}
