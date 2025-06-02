import { Panel } from '../../engine/ui/Panel';
import { Text } from '../../engine/components/Text';
import { Circle } from '../../engine/components/Circle';
import { Triangle } from '../../engine/components/Triangle';
import { Polygon } from '../../engine/components/Polygon';

/**
 * Primitive shapes section for the developer screen
 * Demonstrates circles, triangles, and polygons
 */
export class PrimitiveShapesSection extends Panel {
	constructor(x: number, y: number, width: number) {
		super({
			width,
			height: 400, // Will be calculated based on content
			style: {
				backgroundColor: 'transparent',
			},
		});

		this.setPosition(x, y);
		this.initializeContent();
	}

	private initializeContent(): void {
		const sectionTitle = new Text('Primitive Shapes', {
			style: {
				fontSize: 28,
				color: '#ffffff',
				fontWeight: 'bold',
			},
		});
		sectionTitle.setPosition(0, 0);
		this.addChild(sectionTitle);

		let currentY = 50;
		const shapeSpacing = 90;

		// Circle examples
		const circleLabel = new Text('Circles:', {
			style: {
				fontSize: 20,
				color: '#ffffff',
			},
		});
		circleLabel.setPosition(20, currentY);
		this.addChild(circleLabel);

		const circleY = currentY + 30;
		let shapeX = 20;

		const circle1 = new Circle({
			style: {
				backgroundColor: '#ff0080',
			},
		});
		circle1.setRadius(35);
		circle1.setPosition(shapeX, circleY);
		this.addChild(circle1);
		shapeX += shapeSpacing;

		const circle2 = new Circle({
			style: {
				backgroundColor: '#0080ff',
				borderColor: '#ffffff',
				borderWidth: 3,
			},
		});
		circle2.setRadius(30);
		circle2.setPosition(shapeX + 5, circleY + 5);
		this.addChild(circle2);
		shapeX += shapeSpacing;

		const circle3 = new Circle({
			style: {
				backgroundColor: '#80ff0080',
				borderColor: '#80ff00',
				borderWidth: 2,
			},
		});
		circle3.setRadius(25);
		circle3.setPosition(shapeX + 10, circleY + 10);
		this.addChild(circle3);

		currentY += 100;

		// Triangle examples
		const triangleLabel = new Text('Triangles:', {
			style: {
				fontSize: 20,
				color: '#ffffff',
			},
		});
		triangleLabel.setPosition(20, currentY);
		this.addChild(triangleLabel);

		const triangleY = currentY + 30;
		shapeX = 20;

		const triangle1 = new Triangle({
			width: 70,
			height: 70,
			style: {
				backgroundColor: '#ff8000',
			},
		});
		triangle1.setPosition(shapeX, triangleY);
		this.addChild(triangle1);
		shapeX += shapeSpacing;

		const triangle2 = new Triangle({
			width: 60,
			height: 60,
			style: {
				backgroundColor: '#8000ff',
				borderColor: '#ffffff',
				borderWidth: 2,
			},
		});
		triangle2.setPosition(shapeX, triangleY);
		this.addChild(triangle2);
		shapeX += shapeSpacing;

		const triangle3 = new Triangle({
			width: 50,
			height: 50,
			style: {
				backgroundColor: '#00ff8080',
				borderColor: '#ff0080',
				borderWidth: 3,
			},
		});
		triangle3.setPosition(shapeX, triangleY);
		this.addChild(triangle3);

		currentY += 100;

		// Polygon examples
		const polygonLabel = new Text('Polygons:', {
			style: {
				fontSize: 20,
				color: '#ffffff',
			},
		});
		polygonLabel.setPosition(20, currentY);
		this.addChild(polygonLabel);

		const polygonY = currentY + 30;
		shapeX = 20;

		// Pentagon
		const pentagon = new Polygon({
			width: 70,
			height: 70,
			style: {
				backgroundColor: '#ff00ff',
				borderColor: '#ffffff',
				borderWidth: 2,
			},
		});
		pentagon.makeRegular(5);
		pentagon.setPosition(shapeX, polygonY);
		this.addChild(pentagon);
		shapeX += shapeSpacing;

		// Hexagon
		const hexagon = new Polygon({
			width: 70,
			height: 70,
			style: {
				backgroundColor: '#00ffff',
				borderColor: '#000000',
				borderWidth: 3,
			},
		});
		hexagon.makeRegular(6);
		hexagon.setPosition(shapeX, polygonY);
		this.addChild(hexagon);
		shapeX += shapeSpacing;

		// Star
		const star = new Polygon({
			width: 70,
			height: 70,
			style: {
				backgroundColor: '#ffff00',
				borderColor: '#ff0000',
				borderWidth: 2,
			},
		});
		star.makeStar(5, 0.4);
		star.setPosition(shapeX, polygonY);
		this.addChild(star);
		shapeX += shapeSpacing;

		// Custom polygon (diamond)
		const diamond = new Polygon({
			width: 60,
			height: 80,
			style: {
				backgroundColor: '#00ff00a0',
				borderColor: '#00ff00',
				borderWidth: 2,
			},
		});
		diamond.setPoints([
			[0, -1],    // Top
			[1, 0],     // Right
			[0, 1],     // Bottom
			[-1, 0],    // Left
		]);
		diamond.setPosition(shapeX, polygonY);
		this.addChild(diamond);

		// Update our height based on content
		this.setSize(this.width, polygonY + 100);
	}

	/**
	 * Get the height of this section
	 */
	public getHeight(): number {
		return this.height;
	}
}