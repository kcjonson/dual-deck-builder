import { DeveloperSectionPanel, DeveloperSectionOptions } from './DeveloperSectionPanel';
import type { Component } from '../../../engine/components/Component';
import { Stack } from '../../../engine/components/Stack';
import { Text } from '../../../engine/components/Text';
import { Circle } from '../../../engine/components/Circle';
import type { ShapeStyleObject } from '../../../engine/components/shapeStyle';
import { Triangle } from '../../../engine/components/Triangle';
import { Polygon } from '../../../engine/components/Polygon';

/**
 * Circles, triangles, and polygons (regular, a star, and one from points),
 * filled, bordered, and translucent; hex colours on purpose, as the parser's
 * forms.
 */
export class PrimitiveShapesSection extends DeveloperSectionPanel {
	constructor(options: DeveloperSectionOptions = {}) {
		super({ id: 'dev_section_primitive_shapes', title: 'Primitive Shapes', ...options });

		const circle = (radius: number, style: ShapeStyleObject): Circle => {
			const shape = new Circle({ style });
			shape.radius = radius;
			return shape;
		};

		const pentagon = new Polygon({ width: 70, height: 70, style: { backgroundColor: '#ff00ff', borderColor: '#ffffff', borderWidth: 2 } });
		pentagon.makeRegular(5);
		const hexagon = new Polygon({ width: 70, height: 70, style: { backgroundColor: '#00ffff', borderColor: '#000000', borderWidth: 3 } });
		hexagon.makeRegular(6);
		const star = new Polygon({ width: 70, height: 70, style: { backgroundColor: '#ffff00', borderColor: '#ff0000', borderWidth: 2 } });
		star.makeStar(5, 0.4);
		const diamond = new Polygon({ width: 60, height: 80, style: { backgroundColor: '#00ff00a0', borderColor: '#00ff00', borderWidth: 2 } });
		diamond.points = [[0, -1], [1, 0], [0, 1], [-1, 0]];

		const column = new Stack({ gap: 20, padding: { left: 20 } });
		column.addChild(group('Circles:', [
			circle(35, { backgroundColor: '#ff0080' }),
			circle(30, { backgroundColor: '#0080ff', borderColor: '#ffffff', borderWidth: 3 }),
			circle(25, { backgroundColor: '#80ff0080', borderColor: '#80ff00', borderWidth: 2 }),
		]));
		column.addChild(group('Triangles:', [
			new Triangle({ width: 70, height: 70, style: { backgroundColor: '#ff8000' } }),
			new Triangle({ width: 60, height: 60, style: { backgroundColor: '#8000ff', borderColor: '#ffffff', borderWidth: 2 } }),
			new Triangle({ width: 50, height: 50, style: { backgroundColor: '#00ff8080', borderColor: '#ff0080', borderWidth: 3 } }),
		]));
		column.addChild(group('Polygons:', [pentagon, hexagon, star, diamond]));
		this.addChild(column);
	}
}

/** A label over a row of shapes, centred across it. */
function group(label: string, shapes: Component[]): Stack {
	const column = new Stack({ gap: 10 });
	column.addChild(new Text(label, { style: { fontSize: 20, color: 'text_bright' } }));
	const row = new Stack({ direction: 'horizontal', gap: 20, crossAlign: 'center' });
	for (const shape of shapes) row.addChild(shape);
	column.addChild(row);
	return column;
}
