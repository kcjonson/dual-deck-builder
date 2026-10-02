import type { Card } from '../mechanics/Card';

/**
 * The rules words a card's text is written with (Battle Screen Design,
 * section 5), and what each means for the keyword boxes beside the detail
 * view. A summary marks them in `[brackets]`; the full text is matched
 * against these names.
 */
export const KEYWORDS: Readonly<Record<string, string>> = {
	'Range 1': 'Reaches one step: the next lane over on the same row.',
	'Range 2': 'Reaches two steps, counting lanes across plus rows ahead or behind.',
	Vulnerable: 'Takes 50% more damage. Counts down each turn.',
	'Sure-hit': 'Ignores Evade. Always lands.',
	Partner: 'Your other driver. Synergy cards check what they did this turn.',
	Armor: 'Absorbs damage first. Resets at the start of your turn.',
	Shield: 'Temporary armor. Takes damage before Armor, stacks, and clears at the start of your turn.',
	Flank: 'Swerve to the outside of the target. Needs more speed than the target.',
	Exhaust: 'Removed from your deck until the fight ends.',
	Evade: 'A shot hits only if the attacker\'s Gunnery beats the target\'s Evade.',
	Escort: 'A convoy vehicle with no driver of its own. Order cards command it; once it acts it is spent until your next turn.',
};

const KEYWORD_NAMES = Object.keys(KEYWORDS);

/** One stretch of a text, and whether it is a keyword. */
export interface TextPiece {
	text: string;
	keyword: boolean;
}

/** A word between spaces, in pieces, since "[Flank]s" is one word in two colours. */
export type TextWord = TextPiece[];

const escape = (name: string) => name.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&').replace(/ /g, '\\s+');
/** Longest first, so "Range 1" wins over a shorter name inside it. */
const AUTO_PATTERN = new RegExp(
	`\\[(.+?)\\]|\\b(${[...KEYWORD_NAMES].sort((a, b) => b.length - a.length).map(escape).join('|')})(?![\\w-])`,
	'gi',
);
const BRACKET_PATTERN = /\[(.+?)\]/g;

/**
 * A text cut into words and each word into keyword and plain pieces.
 * `bracketed` reads only `[brackets]`, as a summary is written; `auto` also
 * highlights every keyword name it finds, as the full text is not marked
 * up. Brackets never show.
 */
export function keywordWords(text: string, mode: 'bracketed' | 'auto'): TextWord[] {
	const words: TextWord[] = [];
	let word: TextWord = [];
	for (const piece of keywordPieces(text, mode)) {
		const parts = piece.text.split(/\s+/);
		parts.forEach((part, index) => {
			if (index > 0 && word.length > 0) {
				words.push(word);
				word = [];
			}
			if (part.length > 0) word.push({ text: part, keyword: piece.keyword });
		});
	}
	if (word.length > 0) words.push(word);
	return words;
}

/** A text cut into keyword and plain stretches, brackets dropped. */
export function keywordPieces(text: string, mode: 'bracketed' | 'auto'): TextPiece[] {
	const pieces: TextPiece[] = [];
	const pattern = mode === 'auto' ? AUTO_PATTERN : BRACKET_PATTERN;
	pattern.lastIndex = 0;
	let last = 0;
	for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
		if (match.index > last) pieces.push({ text: text.slice(last, match.index), keyword: false });
		pieces.push({ text: match[1] ?? match[2], keyword: true });
		last = match.index + match[0].length;
	}
	if (last < text.length) pieces.push({ text: text.slice(last), keyword: false });
	return pieces;
}

/** The keyword a matched name means, in its canonical spelling, or null. */
function canonical(name: string): string | null {
	const flat = name.replace(/\s+/g, ' ').toLowerCase();
	return KEYWORD_NAMES.find((keyword) => keyword.toLowerCase() === flat) ?? null;
}

/** The longest effect range on a card, 1 or 2, or null for a card with none. */
export function cardRange(card: Card): number | null {
	let range = 0;
	for (const effect of card.effects) {
		if (typeof effect.range === 'number') range = Math.max(range, effect.range);
	}
	return range > 0 ? range : null;
}

/**
 * The keywords a card's detail view explains, in the order they come up:
 * the full text's, then the summary's brackets, then the card's range
 * (the mock's `kwFound` plus the range chip).
 */
export function cardKeywords(card: Card): string[] {
	const found: string[] = [];
	const add = (name: string) => {
		const keyword = canonical(name);
		if (keyword && !found.includes(keyword)) found.push(keyword);
	};
	for (const piece of keywordPieces(card.displayDescription, 'auto')) if (piece.keyword) add(piece.text);
	for (const piece of keywordPieces(card.displaySummary, 'bracketed')) if (piece.keyword) add(piece.text);
	const range = cardRange(card);
	if (range !== null) add(`Range ${range}`);
	return found;
}
