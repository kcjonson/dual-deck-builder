import { GameSettings, SettingsStorage } from './GameSettings';

function mapStorage(initial: Record<string, string> = {}): SettingsStorage & { data: Map<string, string> } {
	const data = new Map(Object.entries(initial));
	return {
		data,
		getItem: (key) => data.get(key) ?? null,
		setItem: (key, value) => {
			data.set(key, value);
		},
	};
}

const KEY = 'dual-deckbuilder.settings';

describe('GameSettings', () => {
	it('defaults to following the system for motion', () => {
		expect(new GameSettings({ storage: mapStorage() }).motion).toBe('system');
		expect(new GameSettings().motion).toBe('system');
	});

	it('persists a change and reads it back in a new session', () => {
		const storage = mapStorage();
		const settings = new GameSettings({ storage });
		settings.motion = 'reduced';
		expect(JSON.parse(storage.data.get(KEY) ?? '{}')).toEqual({ motion: 'reduced' });
		expect(new GameSettings({ storage }).motion).toBe('reduced');
	});

	it('tells listeners about a change, once, and not about a no-op', () => {
		const settings = new GameSettings({ storage: mapStorage() });
		const heard = jest.fn();
		const stop = settings.onChange(heard);
		settings.motion = 'full';
		settings.motion = 'full';
		expect(heard).toHaveBeenCalledTimes(1);
		expect(heard).toHaveBeenCalledWith(settings);
		stop();
		settings.motion = 'system';
		expect(heard).toHaveBeenCalledTimes(1);
	});

	it.each([
		['not JSON', '{motion'],
		['an unknown value', JSON.stringify({ motion: 'sideways' })],
		['not an object', '"reduced"'],
	])('falls back to the default over a record that is %s', (_case, raw) => {
		expect(new GameSettings({ storage: mapStorage({ [KEY]: raw }) }).motion).toBe('system');
	});

	it('keeps keys this build does not know when it saves', () => {
		const newer = { motion: 'full', volume: 0.4, keybinds: { pause: 'P' } };
		const storage = mapStorage({ [KEY]: JSON.stringify(newer) });
		const settings = new GameSettings({ storage });
		settings.motion = 'reduced';
		expect(JSON.parse(storage.data.get(KEY) ?? '{}')).toEqual({ ...newer, motion: 'reduced' });
	});

	it('keeps working for the session when storage throws', () => {
		const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
		const settings = new GameSettings({
			storage: {
				getItem: () => {
					throw new Error('blocked');
				},
				setItem: () => {
					throw new Error('quota');
				},
			},
		});
		expect(settings.motion).toBe('system');
		settings.motion = 'reduced';
		expect(settings.motion).toBe('reduced');
		expect(warn).toHaveBeenCalled();
		warn.mockRestore();
	});
});
