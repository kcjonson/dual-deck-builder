import type { DrawApi } from '../../engine/draw/DrawApi';
import type { DrawCircleOptions, DrawPolygonOptions, DrawRectOptions } from '../../engine/draw/commands';
import type { RGBA } from '../../engine/draw/geometry';
import { triangulatePolygon } from '../../engine/draw';
import { resolveColor } from '../../engine/style/styleObject';
import type { Vehicle as VehicleData } from '../mechanics/Vehicle';

/**
 * The rear views a token draws (Battle Screen Design, section 3), facing up
 * the road, until there is art. Shapes are the mock's `car`, `truck`, and
 * `bike` symbols, in their 140x58 view box.
 */
export type SpriteKind = 'car' | 'truck' | 'bike';

/** What a part is coloured: the body's tint, the tail lights' red, or the dark of glass and tyres at an alpha. */
type Paint = 'body' | 'light' | { dark: number };

type Shape =
	| { kind: 'rect'; x: number; y: number; width: number; height: number; radius?: number; paint: Paint }
	| { kind: 'polygon'; points: [number, number][]; paint: Paint }
	| { kind: 'circle'; x: number; y: number; radius: number; paint: Paint };

const VIEW_WIDTH = 140;
const VIEW_HEIGHT = 58;
const DARK = '#0d0e0f';
const LIGHT = '#ff5a44';

const SHAPES: Readonly<Record<SpriteKind, readonly Shape[]>> = {
	car: [
		{ kind: 'polygon', points: [[22, 50], [22, 30], [28, 22], [40, 10], [46, 8], [94, 8], [100, 10], [112, 22], [118, 30], [118, 50]], paint: 'body' },
		{ kind: 'polygon', points: [[44, 12], [96, 12], [106, 22], [34, 22]], paint: { dark: 0.6 } },
		{ kind: 'rect', x: 26, y: 28, width: 14, height: 6, radius: 1, paint: 'light' },
		{ kind: 'rect', x: 100, y: 28, width: 14, height: 6, radius: 1, paint: 'light' },
		{ kind: 'rect', x: 60, y: 34, width: 20, height: 7, paint: { dark: 0.5 } },
		{ kind: 'rect', x: 20, y: 42, width: 100, height: 6, paint: { dark: 0.35 } },
		{ kind: 'rect', x: 20, y: 46, width: 16, height: 12, radius: 2, paint: { dark: 1 } },
		{ kind: 'rect', x: 104, y: 46, width: 16, height: 12, radius: 2, paint: { dark: 1 } },
	],
	truck: [
		{ kind: 'rect', x: 14, y: 2, width: 112, height: 42, radius: 2, paint: 'body' },
		{ kind: 'rect', x: 69, y: 6, width: 2, height: 34, paint: { dark: 0.45 } },
		{ kind: 'rect', x: 18, y: 32, width: 12, height: 7, paint: 'light' },
		{ kind: 'rect', x: 110, y: 32, width: 12, height: 7, paint: 'light' },
		{ kind: 'rect', x: 14, y: 42, width: 112, height: 5, paint: { dark: 0.4 } },
		{ kind: 'rect', x: 10, y: 44, width: 26, height: 14, radius: 2, paint: { dark: 1 } },
		{ kind: 'rect', x: 104, y: 44, width: 26, height: 14, radius: 2, paint: { dark: 1 } },
	],
	bike: [
		{ kind: 'circle', x: 70, y: 9, radius: 7, paint: 'body' },
		{ kind: 'polygon', points: [[56, 18], [70, 15], [84, 18], [88, 36], [52, 36]], paint: 'body' },
		{ kind: 'rect', x: 42, y: 21, width: 56, height: 4, radius: 2, paint: 'body' },
		{ kind: 'rect', x: 62, y: 36, width: 16, height: 6, paint: 'body' },
		{ kind: 'rect', x: 64, y: 37, width: 12, height: 4, paint: 'light' },
		{ kind: 'rect', x: 64, y: 42, width: 12, height: 16, radius: 3, paint: { dark: 1 } },
	],
};

/** Big, armored, or an escort hauler reads as a truck; a name with a bike in it as a bike. */
const TRUCK_STRUCTURE = 70;
const BIKE_NAME = /bike|cycle|moto/i;

export function spriteKindOf(vehicle: Pick<VehicleData, 'name' | 'maxStructure' | 'escort'>): SpriteKind {
	if (BIKE_NAME.test(vehicle.name)) return 'bike';
	if (vehicle.escort || vehicle.maxStructure >= TRUCK_STRUCTURE) return 'truck';
	return 'car';
}

/** The rear view an escort shows, as `spriteKindOf` picks it for any escort: a bike by its name, else a truck. */
export function spriteKindForEscort(name: string): SpriteKind {
	return BIKE_NAME.test(name) ? 'bike' : 'truck';
}

type Part =
	| { kind: 'rect'; paint: Paint; options: DrawRectOptions }
	| { kind: 'polygon'; paint: Paint; options: DrawPolygonOptions }
	| { kind: 'circle'; paint: Paint; options: DrawCircleOptions };

/**
 * One rear view fitted into a box (the token's 60x40), built once per kind
 * and recoloured in place, so drawing it every frame allocates nothing. The
 * view box is fitted whole and centred, as SVG's default `meet` does.
 */
export class VehicleSprite {
	private parts: Part[] = [];
	private builtKind: SpriteKind | null = null;
	private bodyColor: RGBA = resolveColor('#777777');
	private lightColor: RGBA = resolveColor(LIGHT);

	private readonly box: Readonly<{ x: number; y: number; width: number; height: number }>;

	constructor({ box }: { box: { x: number; y: number; width: number; height: number } }) {
		this.box = box;
	}

	get kind(): SpriteKind | null {
		return this.builtKind;
	}

	set kind(kind: SpriteKind) {
		if (kind === this.builtKind) return;
		this.builtKind = kind;
		const scale = Math.min(this.box.width / VIEW_WIDTH, this.box.height / VIEW_HEIGHT);
		const originX = this.box.x + (this.box.width - VIEW_WIDTH * scale) / 2;
		const originY = this.box.y + (this.box.height - VIEW_HEIGHT * scale) / 2;
		this.parts = SHAPES[kind].map((shape): Part => {
			switch (shape.kind) {
				case 'rect':
					return {
						kind: 'rect',
						paint: shape.paint,
						options: {
							rect: { x: originX + shape.x * scale, y: originY + shape.y * scale, width: shape.width * scale, height: shape.height * scale },
							radius: shape.radius ? shape.radius * scale : undefined,
						},
					};
				case 'polygon': {
					const points = shape.points.map(([x, y]) => ({ x: originX + x * scale, y: originY + y * scale }));
					return { kind: 'polygon', paint: shape.paint, options: { points, indices: triangulatePolygon(points) } };
				}
				case 'circle':
					return { kind: 'circle', paint: shape.paint, options: { center: { x: originX + shape.x * scale, y: originY + shape.y * scale }, radius: shape.radius * scale } };
			}
		});
		this.applyColors();
	}

	/** The body's tint and the tail lights' colour (grey on a wreck). */
	setColors(body: RGBA, light: RGBA = resolveColor(LIGHT)): void {
		this.bodyColor = body;
		this.lightColor = light;
		this.applyColors();
	}

	draw(draw: DrawApi): void {
		for (const part of this.parts) {
			if (part.kind === 'rect') draw.drawRect(part.options);
			else if (part.kind === 'polygon') draw.drawPolygon(part.options);
			else draw.drawCircle(part.options);
		}
	}

	private applyColors(): void {
		for (const part of this.parts) {
			part.options.fill = this.colorOf(part.paint);
		}
	}

	private colorOf(paint: Paint): RGBA {
		if (paint === 'body') return this.bodyColor;
		if (paint === 'light') return this.lightColor;
		const dark = resolveColor(DARK);
		return [dark[0], dark[1], dark[2], paint.dark];
	}
}
