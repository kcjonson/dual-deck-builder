import { tokens } from '../theme/tokens';
import { FONT_FACES, type FontName } from './fontFaces';
import { resolveFont, type WeightedFace } from './fontRoles';

describe('resolveFont (R11.8)', () => {
	it('is the body base face by default', () => {
		expect(resolveFont()).toBe('body');
		expect(resolveFont({ weight: 'normal' })).toBe('body');
		expect(resolveFont({ weight: 400 })).toBe('body');
	});

	it('gives each role its base face when no weight is asked for', () => {
		expect(resolveFont({ family: 'display' })).toBe('display');
		expect(resolveFont({ family: 'body' })).toBe('body');
		expect(resolveFont({ family: 'mono' })).toBe('mono');
	});

	it('resolves display 700 to Barlow Condensed Bold and body 600 to Open Sans SemiBold', () => {
		const faceOf = (font: FontName) => FONT_FACES.find((face) => face.font === font)?.face;
		expect(faceOf(resolveFont({ family: 'display', weight: 700 }))).toBe('barlow-condensed-bold');
		expect(faceOf(resolveFont({ family: 'display', weight: 'bold' }))).toBe('barlow-condensed-bold');
		expect(faceOf(resolveFont({ family: 'display', weight: 600 }))).toBe('barlow-condensed-semibold');
		expect(faceOf(resolveFont({ family: 'body', weight: 600 }))).toBe('open-sans-semibold');
		expect(faceOf(resolveFont({ family: 'body', weight: tokens.typography.weight_semibold }))).toBe('open-sans-semibold');
	});

	it('sends bold body to the display role\'s bold face, since no body bold face is loaded', () => {
		expect(resolveFont({ weight: 'bold' })).toBe('display-700');
		expect(resolveFont({ weight: 700 })).toBe('display-700');
		expect(resolveFont({ weight: 900 })).toBe('display-700');
	});

	it('falls back to the nearest loaded weight within the role', () => {
		expect(resolveFont({ family: 'display', weight: 'normal' })).toBe('display');
		expect(resolveFont({ family: 'display', weight: 300 })).toBe('display');
		expect(resolveFont({ family: 'display', weight: 620 })).toBe('display');
		expect(resolveFont({ family: 'display', weight: 800 })).toBe('display-700');
		expect(resolveFont({ family: 'body', weight: 300 })).toBe('body');
		expect(resolveFont({ family: 'body', weight: 550 })).toBe('body-600');
		expect(resolveFont({ family: 'body', weight: 650 })).toBe('body-600');
		expect(resolveFont({ family: 'mono', weight: 500 })).toBe('mono');
		expect(resolveFont({ family: 'mono', weight: 'bold' })).toBe('mono');
	});

	it('breaks a tie toward the heavier face above 500 and the lighter one otherwise, as CSS searches', () => {
		expect(resolveFont({ family: 'body', weight: 500 })).toBe('body');
		const faces: WeightedFace[] = [
			{ role: 'body', font: 'body', weight: 400 },
			{ role: 'body', font: 'body-600', weight: 600 },
		];
		expect(resolveFont({ family: 'body', weight: 500, faces })).toBe('body');
		const display: WeightedFace[] = [
			{ role: 'display', font: 'display', weight: 600 },
			{ role: 'display', font: 'display-700', weight: 700 },
		];
		expect(resolveFont({ family: 'display', weight: 650, faces: display })).toBe('display-700');
	});

	it('resolves against the faces that are loaded, not the ones the theme hopes for', () => {
		const regularOnly: WeightedFace[] = [
			{ role: 'display', font: 'display', weight: 600 },
			{ role: 'body', font: 'body', weight: 400 },
		];
		expect(resolveFont({ family: 'body', weight: 600, faces: regularOnly })).toBe('body');
		// No display bold either: bold body still goes to display, its nearest face
		expect(resolveFont({ weight: 'bold', faces: regularOnly })).toBe('display');
		expect(resolveFont({ family: 'display', weight: 700, faces: regularOnly })).toBe('display');
	});

	it('ignores a loaded face at a weight the theme does not list', () => {
		const withBodyBold: WeightedFace[] = [
			{ role: 'display', font: 'display', weight: 600 },
			{ role: 'body', font: 'body', weight: 400 },
			{ role: 'body', font: 'body-700', weight: 700 },
		];
		// The theme lists no body 700, so the face is not one of the role's
		expect(resolveFont({ weight: 'bold', faces: withBodyBold })).toBe('display');
	});

	it('maps a family to its role: a role name, a role family, or a generic family', () => {
		expect(resolveFont({ family: 'mono' })).toBe('mono');
		expect(resolveFont({ family: 'JetBrains Mono' })).toBe('mono');
		expect(resolveFont({ family: 'monospace' })).toBe('mono');
		expect(resolveFont({ family: 'barlow condensed' })).toBe('display');
		expect(resolveFont({ family: 'Barlow Condensed', weight: 'bold' })).toBe('display-700');
		expect(resolveFont({ family: 'sans-serif' })).toBe('body');
		expect(resolveFont({ family: 'Arial' })).toBe('body');
	});

	it('has a loaded face for every weight the theme table lists', () => {
		const roles = { display: tokens.typography.role_display, body: tokens.typography.role_body, mono: tokens.typography.role_mono };
		for (const [role, typography] of Object.entries(roles)) {
			for (const weight of typography.weights) {
				expect(FONT_FACES.some((face) => face.role === role && face.weight === weight)).toBe(true);
			}
		}
	});
});
