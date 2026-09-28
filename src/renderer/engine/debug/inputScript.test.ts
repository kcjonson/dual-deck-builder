import { parseInputCommand } from './inputScript';

/**
 * R13.35's grammar, exercised without a DOM. The default node environment is
 * deliberate: the parser is the half that can be proved by pure test, and
 * splitting it out is what keeps the grammar honest when the dispatch side
 * needs jsdom (R13.4).
 */

function steps(command: string) {
	const parsed = parseInputCommand(command);
	if (!parsed.ok) throw new Error(`expected "${command}" to parse, got: ${parsed.error}`);
	return parsed.steps;
}

/** What a pointer verb reports when it names no pointer: a mouse's, R9.25's defaults. */
const mouse = { pointerId: 1, pointerType: 'mouse' };

function error(command: string): string {
	const parsed = parseInputCommand(command);
	if (parsed.ok) throw new Error(`expected "${command}" to be rejected`);
	return parsed.error;
}

describe('the R13.35 verbs', () => {
	it('parses move,x,y', () => {
		expect(steps('move,10,20')).toEqual([{ kind: 'move', x: 10, y: 20, ...mouse }]);
	});

	it('defaults down and up to button 0', () => {
		expect(steps('down,10,20')).toEqual([{ kind: 'down', x: 10, y: 20, button: 0, ...mouse }]);
		expect(steps('up,10,20')).toEqual([{ kind: 'up', x: 10, y: 20, button: 0, ...mouse }]);
	});

	it('takes an explicit button on down and up', () => {
		expect(steps('down,10,20,2')).toEqual([{ kind: 'down', x: 10, y: 20, button: 2, ...mouse }]);
		expect(steps('up,10,20,2')).toEqual([{ kind: 'up', x: 10, y: 20, button: 2, ...mouse }]);
	});

	it('parses scroll,x,y,delta', () => {
		expect(steps('scroll,10,20,100')).toEqual([{ kind: 'scroll', x: 10, y: 20, delta: 100 }]);
	});

	it('parses keydown and keyup', () => {
		expect(steps('keydown,Enter')).toEqual([{ kind: 'keydown', key: 'Enter' }]);
		expect(steps('keyup,Enter')).toEqual([{ kind: 'keyup', key: 'Enter' }]);
	});
});

describe('click expansion (R13.35)', () => {
	it('expands to move, then down, then up', () => {
		expect(steps('click,10,20')).toEqual([
			{ kind: 'move', x: 10, y: 20, ...mouse },
			{ kind: 'down', x: 10, y: 20, button: 0, ...mouse },
			{ kind: 'up', x: 10, y: 20, button: 0, ...mouse },
		]);
	});

	it('carries the button into both the down and the up', () => {
		expect(steps('click,10,20,2')).toEqual([
			{ kind: 'move', x: 10, y: 20, ...mouse },
			{ kind: 'down', x: 10, y: 20, button: 2, ...mouse },
			{ kind: 'up', x: 10, y: 20, button: 2, ...mouse },
		]);
	});

	// R13.35 spells out click's expansion and no other verb's, which is what
	// settles the question for down: it does not imply a move, or the three
	// steps above would be redundant.
	it('leaves down and up unexpanded', () => {
		expect(steps('down,10,20')).toHaveLength(1);
		expect(steps('up,10,20')).toHaveLength(1);
	});
});

describe('pointer fields and cancel (R9.25)', () => {
	it('takes a pointerId and pointerType after x,y on move', () => {
		expect(steps('move,10,20,3,touch')).toEqual([{ kind: 'move', x: 10, y: 20, pointerId: 3, pointerType: 'touch' }]);
	});

	it('takes them after the button on down, up and click', () => {
		expect(steps('down,10,20,0,2,pen')).toEqual([
			{ kind: 'down', x: 10, y: 20, button: 0, pointerId: 2, pointerType: 'pen' },
		]);
		expect(steps('up,10,20,0,2,pen')).toEqual([
			{ kind: 'up', x: 10, y: 20, button: 0, pointerId: 2, pointerType: 'pen' },
		]);
		const touch = { pointerId: 5, pointerType: 'touch' };
		expect(steps('click,10,20,0,5,touch')).toEqual([
			{ kind: 'move', x: 10, y: 20, ...touch },
			{ kind: 'down', x: 10, y: 20, button: 0, ...touch },
			{ kind: 'up', x: 10, y: 20, button: 0, ...touch },
		]);
	});

	it('defaults the pointerType to mouse when only the id is given', () => {
		expect(steps('move,10,20,4')).toEqual([{ kind: 'move', x: 10, y: 20, pointerId: 4, pointerType: 'mouse' }]);
	});

	it('reads the pointerType case-insensitively', () => {
		expect(steps(' move , 1 , 2 , 7 , Touch ')).toEqual([
			{ kind: 'move', x: 1, y: 2, pointerId: 7, pointerType: 'touch' },
		]);
	});

	it('rejects a pointerId that is not a non-negative integer', () => {
		expect(error('move,1,2,-1')).toMatch(/non-negative integer pointerId/);
		expect(error('move,1,2,1.5')).toMatch(/non-negative integer pointerId/);
		expect(error('down,1,2,0,,touch')).toMatch(/non-negative integer pointerId/);
	});

	// virtual is R9.1's controller type; the DOM adapter never produces it.
	it('rejects a pointerType the DOM cannot send', () => {
		expect(error('move,1,2,1,virtual')).toMatch(/pointerType of mouse, touch or pen/);
		expect(error('down,1,2,0,1,finger')).toMatch(/pointerType of mouse, touch or pen/);
	});

	it('parses cancel with and without a pointerId', () => {
		expect(steps('cancel')).toEqual([{ kind: 'cancel', pointerId: 1 }]);
		expect(steps('cancel,3')).toEqual([{ kind: 'cancel', pointerId: 3 }]);
		expect(steps('CANCEL, 3 ')).toEqual([{ kind: 'cancel', pointerId: 3 }]);
	});

	it('rejects a bad cancel pointerId', () => {
		expect(error('cancel,x')).toMatch(/cancel needs a non-negative integer pointerId/);
		expect(error('cancel,')).toMatch(/cancel needs a non-negative integer pointerId/);
	});
});

describe('numbers', () => {
	it('accepts negative, fractional and exponent coordinates', () => {
		expect(steps('move,-4.5,1e2')).toEqual([{ kind: 'move', x: -4.5, y: 100, ...mouse }]);
	});

	it('accepts a negative scroll delta', () => {
		expect(steps('scroll,0,0,-40')).toEqual([{ kind: 'scroll', x: 0, y: 0, delta: -40 }]);
	});

	it('rejects a non-numeric coordinate', () => {
		expect(error('move,abc,20')).toMatch(/finite x/);
		expect(error('move,10,abc')).toMatch(/finite y/);
	});

	// Number('') is 0, so an empty field would silently become the origin.
	it('rejects an empty coordinate rather than reading it as zero', () => {
		expect(error('move,,20')).toMatch(/finite x/);
		expect(error('move,10,')).toMatch(/finite y/);
	});

	it('rejects non-finite coordinates', () => {
		expect(error('move,Infinity,20')).toMatch(/finite x/);
		expect(error('move,NaN,20')).toMatch(/finite x/);
	});

	it('rejects a non-numeric or non-integer or negative button', () => {
		expect(error('down,1,2,left')).toMatch(/button/);
		expect(error('down,1,2,1.5')).toMatch(/button/);
		expect(error('down,1,2,-1')).toMatch(/button/);
	});

	// The dispatcher's BUTTONS_BIT table has five entries, so a button above 4
	// masks to 0 and would produce a mousedown claiming nothing is held. The
	// parser refuses it rather than letting the dispatcher lie.
	it('rejects a button the buttons mask cannot represent', () => {
		expect(steps('down,1,2,4')).toEqual([{ kind: 'down', x: 1, y: 2, button: 4, ...mouse }]);
		expect(error('down,1,2,5')).toMatch(/integer button from 0 to 4/);
		expect(error('down,1,2,9')).toMatch(/integer button from 0 to 4/);
		expect(error('up,1,2,9')).toMatch(/integer button from 0 to 4/);
		expect(error('click,1,2,9')).toMatch(/integer button from 0 to 4/);
	});

	it('rejects a non-numeric scroll delta', () => {
		expect(error('scroll,1,2,fast')).toMatch(/finite delta/);
	});
});

describe('whitespace', () => {
	it('tolerates padding around the verb and the numbers', () => {
		expect(steps('  move , 10 , 20  ')).toEqual([{ kind: 'move', x: 10, y: 20, ...mouse }]);
	});

	it('accepts an uppercase verb', () => {
		expect(steps('CLICK,1,2')).toHaveLength(3);
	});

	// A key is taken verbatim from the character after the first comma, because
	// ' ' and ',' are both real key names. Trimming would make the space bar unreachable
	// and lowercasing would turn Shift+A into a.
	it('keeps a key exactly as written', () => {
		expect(steps('keydown, ')).toEqual([{ kind: 'keydown', key: ' ' }]);
		expect(steps('keydown,,')).toEqual([{ kind: 'keydown', key: ',' }]);
		expect(steps('keydown,A')).toEqual([{ kind: 'keydown', key: 'A' }]);
		expect(steps('  keyup,ArrowLeft')).toEqual([{ kind: 'keyup', key: 'ArrowLeft' }]);
	});
});

describe('rejections, none of which throw', () => {
	it('rejects an empty string', () => {
		expect(error('')).toBe('empty command');
		expect(error('   ')).toBe('empty command');
	});

	// The message names the alternatives because window.__dev is one variadic
	// input(...) with no help surface: a harness author holding a console and
	// no copy of R13.35 has nowhere else to read the vocabulary.
	it('rejects an unknown command and names the verbs', () => {
		const message = error('teleport,1,2');
		expect(message).toMatch(/unknown command "teleport"/);
		for (const verb of ['move', 'down', 'up', 'click', 'cancel', 'scroll', 'keydown', 'keyup']) {
			expect(message).toContain(verb);
		}
	});

	it('rejects a missing argument', () => {
		expect(error('move')).toMatch(/move takes x,y/);
		expect(error('move,10')).toMatch(/move takes x,y/);
		expect(error('down,10')).toMatch(/down takes x,y/);
		expect(error('scroll,10,20')).toMatch(/scroll takes x,y,delta/);
		expect(error('keydown')).toBe('keydown needs a key');
		expect(error('keyup')).toBe('keyup needs a key');
		expect(error('keydown,')).toBe('keydown needs a key');
	});

	it('rejects extra arguments rather than ignoring them', () => {
		expect(error('move,1,2,3,touch,9')).toMatch(/move takes x,y\[,pointerId\[,pointerType\]\]/);
		expect(error('down,1,2,0,3,touch,9')).toMatch(/down takes x,y\[,button\[,pointerId\[,pointerType\]\]\]/);
		expect(error('click,1,2,0,3,touch,9')).toMatch(/click takes x,y\[,button/);
		expect(error('cancel,1,2')).toMatch(/cancel takes \[pointerId\]/);
		expect(error('scroll,1,2,3,4')).toMatch(/scroll takes x,y,delta/);
	});

	it('rejects a non-string without throwing', () => {
		expect(parseInputCommand(undefined as unknown as string)).toEqual({
			ok: false,
			error: 'command must be a string',
		});
		expect(parseInputCommand(['move,1,2'] as unknown as string)).toEqual({
			ok: false,
			error: 'command must be a string',
		});
	});
});
