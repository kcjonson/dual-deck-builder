import { Container } from './Container';

describe('Container parts (R8.1)', () => {
	describe('the mark', () => {
		it('is off until something adds the layer as a part', () => {
			expect(new Container().isPart).toBe(false);
		});

		it('is set by addPart and left alone by addChild', () => {
			const panel = new Container({ id: 'panel', width: 100, height: 100 });
			const background = new Container({ id: 'background', width: 100, height: 100 });
			const card = new Container({ id: 'card', width: 20, height: 20 });

			panel.addPart(background);
			panel.addChild(card);

			expect(background.isPart).toBe(true);
			expect(card.isPart).toBe(false);
		});

		it('does not spread to the part\'s own contents', () => {
			const panel = new Container({ width: 100, height: 100 });
			const content = new Container({ width: 100, height: 100 });
			const row = new Container({ width: 40, height: 10 });

			content.addChild(row);
			panel.addPart(content);

			expect(content.isPart).toBe(true);
			expect(row.isPart).toBe(false);
		});
	});

	describe('parenting', () => {
		it('parents the part the way addChild does, so it draws inside its owner', () => {
			const panel = new Container({ x: 10, y: 20, width: 100, height: 100 });
			const background = new Container({ x: 5, y: 7, width: 90, height: 90 });

			panel.addPart(background);

			expect(background.localToScreen({ x: 0, y: 0 })).toEqual({ x: 15, y: 27 });
		});

		it('returns the owner, so parts chain the way children do', () => {
			const panel = new Container({ width: 100, height: 100 });

			expect(panel.addPart(new Container())).toBe(panel);
		});
	});

	describe('paint order', () => {
		it('appends into the same array as addChild, so a mix keeps insertion order', () => {
			const panel = new Container({ width: 100, height: 100 });
			const background = new Container({ id: 'background', width: 100, height: 100 });
			const card = new Container({ id: 'card', width: 20, height: 20 });
			const border = new Container({ id: 'border', width: 100, height: 100 });

			panel.addPart(background);
			panel.addChild(card);
			panel.addPart(border);

			expect(panel.children.map((child) => child.id)).toEqual(['background', 'card', 'border']);
			expect(panel.debugChildren.map((child) => child.id)).toEqual(['background', 'card', 'border']);
		});

		it('puts parts in the array Container.render walks, so a plain Container sees no difference', () => {
			const panel = new Container({ width: 100, height: 100 });
			const background = new Container({ id: 'background', width: 100, height: 100 });
			const card = new Container({ id: 'card', width: 20, height: 20 });

			panel.addPart(background);
			panel.addChild(card);

			const children = panel.children;

			expect(children).toHaveLength(2);
			expect(children[0]).toBe(background);
			expect(children[1]).toBe(card);
		});
	});

	describe('losing the mark', () => {
		it('clears the mark, so a part handed back to a caller stops being one', () => {
			const panel = new Container({ width: 100, height: 100 });
			const background = new Container({ id: 'background', width: 100, height: 100 });

			panel.addPart(background);

			expect(panel.removeChild(background)).toBe(true);
			expect(background.isPart).toBe(false);
			expect(panel.children).toHaveLength(0);
		});

		it('leaves a detached part a plain child when it is re-added with addChild', () => {
			const panel = new Container({ width: 100, height: 100 });
			const adopter = new Container({ width: 100, height: 100 });
			const background = new Container({ id: 'background', width: 100, height: 100 });

			panel.addPart(background);
			panel.removeChild(background);
			adopter.addChild(background);

			expect(background.isPart).toBe(false);
			expect(adopter.children).toEqual([background]);
		});

		it('clears the mark when a part is adopted straight into another parent', () => {
			// addChild does not detach from a previous parent, so this is the
			// path removeChild never sees. Without the clear in addChild the
			// mark is sticky: anything that was ever anyone's part would be
			// reported as its new parent's own drawing and would stop being
			// paired with that parent's real children.
			const owner = new Container({ width: 100, height: 100 });
			const adopter = new Container({ width: 100, height: 100 });
			const shared = new Container({ id: 'shared', width: 100, height: 100 });

			owner.addPart(shared);
			adopter.addChild(shared);

			expect(shared.isPart).toBe(false);
		});

		it('leaves the mark alone on a layer it does not hold', () => {
			const panel = new Container({ width: 100, height: 100 });
			const stranger = new Container({ width: 100, height: 100 });
			const background = new Container({ id: 'background', width: 100, height: 100 });

			panel.addPart(background);

			expect(stranger.removeChild(background)).toBe(false);
			expect(background.isPart).toBe(true);
		});
	});
});
