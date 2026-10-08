import { createMeasuringDrawApi } from '../../engine/text/testing';
import type { RGBA, Rect } from '../../engine/draw/geometry';
import { CARD_GROUND_FILLS } from './cardStyle';
import { STATUS_TAG_HEIGHT, StatusTagDraw } from './statusTag';

interface Recorded {
	kind: string;
	text?: string;
	rect?: Rect;
	box?: Rect | null;
	fill?: RGBA | null;
}

function frame(tag: StatusTagDraw, measuring: ReturnType<typeof createMeasuringDrawApi>): Recorded[] {
	const { api, backend } = measuring;
	api.beginFrame({ viewport: { width: 200, height: 200 } });
	tag.render(api);
	api.endFrame();
	return [...backend.commands] as unknown as Recorded[];
}

describe('StatusTagDraw', () => {
	it('draws nothing until it has text and has been sized for it', () => {
		const measuring = createMeasuringDrawApi();
		const tag = new StatusTagDraw({ right: 84, y: -7 });
		tag.place(measuring.api);
		expect(frame(tag, measuring)).toEqual([]);
		tag.text = 'HOME';
		expect(tag.shown).toBe(false);
		expect(frame(tag, measuring)).toEqual([]);
		tag.place(measuring.api);
		expect(tag.shown).toBe(true);
		expect(frame(tag, measuring).map((command) => command.kind)).toEqual(['rect', 'text']);
	});

	it('hugs its text from its right edge, at the height every tag shares', () => {
		const measuring = createMeasuringDrawApi();
		const tag = new StatusTagDraw({ right: 84, y: -7 });
		tag.text = 'LOCKED';
		tag.place(measuring.api);
		const [box, label] = frame(tag, measuring);
		const rect = box.rect as Rect;
		expect(rect.x + rect.width).toBeCloseTo(84);
		expect(rect.y).toBe(-7);
		expect(rect.height).toBe(STATUS_TAG_HEIGHT);
		const width = measuring.api.measureText({ text: 'LOCKED', font: 'mono', size: 9, letterSpacing: 0.06, wrap: 'none' }).width;
		expect(rect.width).toBeGreaterThan(width);
		expect(label.text).toBe('LOCKED');
		expect(label.box).toEqual(rect);
	});

	it('measures once per text, however often it is placed', () => {
		const measuring = createMeasuringDrawApi();
		const tag = new StatusTagDraw({ right: 84, y: -7 });
		const measured = jest.spyOn(measuring.api, 'measureText');
		tag.text = '+1';
		for (let index = 0; index < 4; index++) tag.place(measuring.api);
		tag.text = '+2';
		tag.place(measuring.api);
		tag.place(measuring.api);
		expect(measured.mock.calls.map(([options]) => options.text)).toEqual(['+1', '+2']);
	});

	it('takes a point on its box only while it shows', () => {
		const measuring = createMeasuringDrawApi();
		const tag = new StatusTagDraw({ right: 84, y: -7 });
		expect(tag.contains(82, -3)).toBe(false);
		tag.text = 'HOME';
		tag.place(measuring.api);
		expect(tag.contains(82, -3)).toBe(true);
		expect(tag.contains(85, -3)).toBe(false);
		expect(tag.contains(82, 7)).toBe(false);
		tag.text = '';
		tag.place(measuring.api);
		expect(tag.contains(82, -3)).toBe(false);
	});

	it('dims with a faded card, and says whether it is dimmed', () => {
		const measuring = createMeasuringDrawApi();
		const tag = new StatusTagDraw({ right: 84, y: -7 });
		expect(tag.dimmed).toBe(false);
		tag.text = 'HOME';
		tag.place(measuring.api);
		tag.dimmed = true;
		expect(tag.dimmed).toBe(true);
		expect(frame(tag, measuring)[0].fill).toEqual(CARD_GROUND_FILLS.dimmed);
		tag.dimmed = false;
		expect(tag.dimmed).toBe(false);
		expect(frame(tag, measuring)[0].fill).toEqual(CARD_GROUND_FILLS.full);
	});

	it('reports the width it was measured at, and none while it shows nothing', () => {
		const measuring = createMeasuringDrawApi();
		const tag = new StatusTagDraw({ right: 84, y: -7 });
		expect(tag.width).toBe(0);
		tag.text = 'LOCKED';
		expect(tag.width).toBe(0);
		tag.place(measuring.api);
		const box = frame(tag, measuring)[0].rect as Rect;
		expect(tag.width).toBeGreaterThan(0);
		expect(tag.width).toBe(box.width);
		tag.text = '';
		tag.place(measuring.api);
		expect(tag.width).toBe(0);
	});
});
