import { readSceneParameter, resolveScene } from './sceneSelection';

const NAMES = ['interactive-controls', 'style-guide', 'buttons'];

describe('readSceneParameter', () => {
	it('reads the parameter with or without the leading question mark', () => {
		expect(readSceneParameter('?scene=buttons')).toBe('buttons');
		expect(readSceneParameter('scene=buttons')).toBe('buttons');
	});

	it('treats an empty or whitespace value as absent', () => {
		expect(readSceneParameter('?scene=')).toBeNull();
		expect(readSceneParameter('?scene=%20%20')).toBeNull();
	});

	it('ignores other parameters and takes the first scene when repeated', () => {
		expect(readSceneParameter('?paused=1&scene=text&debug=1')).toBe('text');
		expect(readSceneParameter('?scene=text&scene=buttons')).toBe('text');
	});

	it('decodes percent-encoded values', () => {
		expect(readSceneParameter('?scene=style%2Dguide')).toBe('style-guide');
	});

	it('returns null for a search with no scene at all', () => {
		expect(readSceneParameter('')).toBeNull();
		expect(readSceneParameter('?other=1')).toBeNull();
	});
});

describe('resolveScene', () => {
	it('defaults to the first registered scene when none is asked for', () => {
		expect(resolveScene('', NAMES)).toEqual({ status: 'default', name: 'interactive-controls' });
	});

	it('resolves a known name', () => {
		expect(resolveScene('?scene=buttons', NAMES)).toEqual({ status: 'requested', name: 'buttons' });
	});

	// A stale harness asking for a renamed scene has to be distinguishable from
	// a run that never asked, or a capture silently screenshots the wrong thing.
	it('reports an unknown name rather than falling back silently', () => {
		expect(resolveScene('?scene=nope', NAMES)).toEqual({ status: 'unknown', requested: 'nope' });
	});

	it('is case and whitespace sensitive apart from trimming the value', () => {
		expect(resolveScene('?scene=%20buttons%20', NAMES)).toEqual({ status: 'requested', name: 'buttons' });
		expect(resolveScene('?scene=Buttons', NAMES)).toEqual({ status: 'unknown', requested: 'Buttons' });
	});

	it('reports an empty registry instead of indexing off the end of it', () => {
		expect(resolveScene('?scene=buttons', [])).toEqual({ status: 'empty' });
		expect(resolveScene('', [])).toEqual({ status: 'empty' });
	});
});
