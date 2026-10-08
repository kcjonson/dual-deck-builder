/**
 * @jest-environment jsdom
 */
import type { Component } from '../../engine/components/Component';
import { Text } from '../../engine/components/Text';
import { createMeasuringDrawApi } from '../../engine/text/testing';
import { createTestContext } from '../../engine/components/testing';
import type { MountContext } from '../../engine/components/MountContext';
import { layoutLint } from '../../engine/debug/layoutLint';
import { treeSnapshot } from '../../engine/debug/treeSnapshot';
import { ESCORT_CONFIGS, EscortType } from '../mechanics/Escort';
import { CardSize } from './Card';
import { CardLookup } from './DriverDetailView';
import { ESCORT_DETAIL, EscortDetailView } from './EscortDetailView';
import { EscortCardData, escortCardData } from './escortCardData';
import { lookup, part } from './testing';

const TYPES = Object.keys(ESCORT_CONFIGS) as EscortType[];

let context: MountContext;

beforeEach(() => {
	context = createTestContext({ draw: createMeasuringDrawApi().api });
});

function view(data: EscortCardData, options: { pinned?: boolean; cards?: CardLookup } = {}): EscortDetailView {
	const detail = new EscortDetailView({ id: 'detail', data, cards: options.cards ?? lookup, pinned: options.pinned });
	detail.mount(context);
	context.frame.layout();
	return detail;
}

/** Every word in the view, its stats' too, which flow in a row of their own, but not its card's. */
function words(detail: Component): string[] {
	return detail.children.flatMap((child) => (child instanceof Text ? [child.text] : child.id === 'detail_signature' ? [] : words(child)));
}

/** An escort that was a driven vehicle, carrying on unmanned. */
const UNMANNED: EscortCardData = { ...escortCardData({ type: 'pilot_car' }), name: 'Apocalypse Rig', type: null, role: 'gun', signatureCard: null, dividend: null };

describe('Escort detail view (Game Flow 7.0)', () => {
	it('shows its profile: name, role, structure, armor, speed, and crew skills, and what a hauler pays', () => {
		const detail = view(escortCardData({ type: 'fuel_hauler', structure: 18 }));
		expect(words(detail)).toEqual([
			'Fuel Hauler', 'HAULER', 'STRUCTURE 18/40', 'ARMOR 5', 'SPEED 2', 'GUNNERY 1', 'EVADE 1', 'RAMMING 3', 'AFTER A WIN +1 FUEL', 'SIGNATURE CARD', 'RMB / I: PIN',
		]);
	});

	it('says each kind of dividend, and nothing for a gun escort', () => {
		expect(words(view(escortCardData({ type: 'med_truck' })))).toContain('AFTER A WIN EVERY DRIVER +3 HP');
		expect(words(view(escortCardData({ type: 'fuel_hauler', dividend: { kind: 'scrap', amount: 15 } })))).toContain('AFTER A WIN +15 SCRAP');
		const gun = view(escortCardData({ type: 'outrider' }));
		expect(words(gun)).toContain('GUN ESCORT');
		expect(words(gun).some((text) => text.startsWith('AFTER'))).toBe(false);
	});

	it('shows the signature card it brings as a full face, a view to read rather than a card to work', () => {
		const detail = view(escortCardData({ type: 'pilot_car' }));
		const face = detail.signatureCard;
		expect(face?.data.type).toBe('flag_down');
		expect(face?.size).toBe(CardSize.NORMAL);
		expect(face?.driver).toBeNull();
		expect(face?.pointerEvents).toBe('none');
	});

	it('puts the card right of a rule, its hex clear of the heading and inside the view', () => {
		const detail = view(escortCardData({ type: 'med_truck' }));
		const face = detail.signatureCard;
		if (!face) throw new Error('no card');
		const heading = part(detail, 'signature_heading');
		const ink = face.inkExtent;
		expect(face.x - ink).toBeGreaterThanOrEqual(heading.x);
		expect(face.y - ink).toBeGreaterThanOrEqual(heading.y + heading.height);
		expect(face.x + face.width).toBeLessThanOrEqual(detail.width - ESCORT_DETAIL.pad);
		expect(heading.x).toBeGreaterThan(ESCORT_DETAIL.pad + ESCORT_DETAIL.profile);
		expect(part(detail, 'pin').y).toBeGreaterThan(face.y + face.height);
	});

	it('says an escort that brings no card does, and is the profile alone', () => {
		const detail = view(UNMANNED);
		expect(detail.signatureCard).toBeNull();
		expect(words(detail)).toEqual(expect.arrayContaining(['Apocalypse Rig', 'UNMANNED', 'BRINGS NO CARD']));
		expect(words(detail)).not.toContain('SIGNATURE CARD');
		expect(detail.width).toBe(ESCORT_DETAIL.pad * 2 + ESCORT_DETAIL.profile);
		expect(view(escortCardData({ type: 'pilot_car' })).width).toBeGreaterThan(detail.width);
		// A card the lookup doesn't know is left out the same way
		expect(view(escortCardData({ type: 'pilot_car' }), { cards: () => null }).signatureCard).toBeNull();
	});

	it('knows its width before it lays out, so the inspector can place it', () => {
		for (const data of [escortCardData({ type: 'outrider' }), UNMANNED]) {
			const detail = new EscortDetailView({ data, cards: lookup });
			const width = detail.width;
			detail.mount(context);
			context.frame.layout();
			expect(detail.width).toBe(width);
		}
	});

	it('says PINNED in its foot when pinned, at the right', () => {
		const detail = view(escortCardData({ type: 'outrider' }), { pinned: true });
		const pin = part(detail, 'pin');
		expect(pin.text).toBe('PINNED');
		expect(pin.x + pin.width).toBeCloseTo(detail.width - ESCORT_DETAIL.pad, 5);
	});

	it('grows to hold its name on two lines without moving the card', () => {
		const short = view(escortCardData({ type: 'outrider' }));
		const long = view(escortCardData({ type: 'outrider', name: 'Outrider of the Long Southern Road' }));
		expect(part(long, 'name').height).toBe(2 * part(short, 'name').height);
		expect(part(long, 'role').y).toBeGreaterThan(part(short, 'role').y);
		expect(long.signatureCard?.y).toBe(short.signatureCard?.y);
	});

	it('is short enough for a 1024x600 screen\'s room whatever it shows', () => {
		for (const data of [...TYPES.map((type) => escortCardData({ type })), UNMANNED]) {
			// 600, less the 10 it rests above the bottom edge and the tooltip service's 8 at the top
			expect([data.name, view(data).height <= 582]).toEqual([data.name, true]);
		}
	});

	it('cuts nothing and lints clean for every type, and an unmanned vehicle', () => {
		for (const data of [...TYPES.map((type) => escortCardData({ type, structure: 1 })), UNMANNED]) {
			const detail = view(data);
			const result = layoutLint(treeSnapshot([detail], { width: detail.width, height: detail.height }));
			expect({ name: data.name, violations: result.violations }).toEqual({ name: data.name, violations: [] });
			for (const suffix of ['name', 'role', 'structure', 'pin']) {
				expect([data.name, suffix, part(detail, suffix).overflowOutcome ?? 'none']).toEqual([data.name, suffix, 'none']);
			}
			detail.unmount();
		}
	});
});
