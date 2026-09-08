import { gallerySceneRegistry } from './registry';
import { developerSections } from '../renderer/game/screens/developer/sections';
import { resolveScene } from './sceneSelection';

/**
 * These assertions are about the properties a `?scene=` name has to hold, not
 * about how many scenes there are. Constructing a scene is deliberately absent:
 * two of the eight sections call Input.setValue in their constructors, which
 * measures text through RendererContext and throws without a GL renderer, so a
 * factory can only be exercised in the browser (R14.1 keeps the unit suite
 * GPU-free). SceneHost.test.ts covers the mount and unmount discipline against
 * synthetic scenes instead.
 */
describe('gallery scene registry', () => {
	it('has scenes', () => {
		expect(gallerySceneRegistry.length).toBeGreaterThan(0);
	});

	it('names are unique', () => {
		const names = gallerySceneRegistry.map((scene) => scene.name);
		expect(new Set(names).size).toBe(names.length);
	});

	// A name that needs encoding would round-trip differently in a URL than in
	// a committed golden's filename, and the two have to stay the same string.
	it('names are URL-safe as written', () => {
		for (const name of gallerySceneRegistry.map((scene) => scene.name)) {
			expect(encodeURIComponent(name)).toBe(name);
		}
	});

	it('every name is addressable through the query parameter', () => {
		const names = gallerySceneRegistry.map((scene) => scene.name);
		for (const name of names) {
			expect(resolveScene(`?scene=${name}`, names)).toEqual({ status: 'requested', name });
		}
	});

	// The screen and the gallery show the same eight things because there is
	// one list, in the game's own directory, and this file only wraps it.
	it('wraps the developer section list one for one, in order', () => {
		expect(gallerySceneRegistry.map((scene) => scene.name)).toEqual(developerSections.map((section) => section.name));
		for (const [index, scene] of gallerySceneRegistry.entries()) {
			expect(scene.factory).toBe(developerSections[index].build);
		}
	});

	it('every entry carries a factory', () => {
		for (const scene of gallerySceneRegistry) {
			expect(typeof scene.factory).toBe('function');
		}
	});
});
