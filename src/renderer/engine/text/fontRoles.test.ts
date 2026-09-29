import { resolveFontRole } from './fontRoles';

describe('resolveFontRole (R11.8)', () => {
	it('is body by default', () => {
		expect(resolveFontRole()).toBe('body');
		expect(resolveFontRole({ weight: 'normal' })).toBe('body');
	});

	it('sends bold body to the display role, since no body bold face is loaded', () => {
		expect(resolveFontRole({ weight: 'bold' })).toBe('display');
		expect(resolveFontRole({ weight: 700 })).toBe('display');
		expect(resolveFontRole({ weight: 900 })).toBe('display');
	});

	it('falls back to the nearest face a role has for any other weight', () => {
		expect(resolveFontRole({ weight: 600 })).toBe('body');
		expect(resolveFontRole({ family: 'display', weight: 'normal' })).toBe('display');
		expect(resolveFontRole({ family: 'mono', weight: 'bold' })).toBe('mono');
	});

	it('maps a family to its role: a role name, a role family, or a generic family', () => {
		expect(resolveFontRole({ family: 'mono' })).toBe('mono');
		expect(resolveFontRole({ family: 'JetBrains Mono' })).toBe('mono');
		expect(resolveFontRole({ family: 'monospace' })).toBe('mono');
		expect(resolveFontRole({ family: 'barlow condensed' })).toBe('display');
		expect(resolveFontRole({ family: 'sans-serif' })).toBe('body');
		expect(resolveFontRole({ family: 'Arial' })).toBe('body');
	});
});
