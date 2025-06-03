import { Component } from './Component';
import { Layer } from './Layer';
import { Polygon } from './Polygon';
import { RenderContext } from '../rendering/RenderContext';

export interface ArrowOptions {
	x?: number;
	y?: number;
	width?: number;
	height?: number;
	color?: string;
	lineWidth?: number;
	arrowHeadSize?: number;
}

/**
 * Arrow component for drawing arrows between two points
 * Used for targeting visualization and other directional indicators
 */
export class Arrow extends Component {
	private line: Polygon;
	private arrowHead: Polygon;
	private startX = 0;
	private startY = 0;
	private endX = 0;
	private endY = 0;
	private lineWidth = 2;
	private arrowHeadSize = 8;
	private color = '#ffffff';
	private hidden = true;

	/**
	 * Create a new arrow component
	 */
	constructor(options: ArrowOptions = {}) {
		super({
			x: options.x ?? 0,
			y: options.y ?? 0,
			width: options.width ?? 0,
			height: options.height ?? 0,
		});

		this.lineWidth = options.lineWidth ?? 2;
		this.arrowHeadSize = options.arrowHeadSize ?? 8;
		this.color = options.color ?? '#ffffff';

		// Create line polygon with minimal triangle (will be updated in updateArrow)
		this.line = new Polygon({
			style: {
				backgroundColor: this.color,
				borderColor: this.color,
				borderWidth: 0,
			},
		});
		this.line.setPoints([[0, 0], [0, 0], [0, 0]]); // Set minimal triangle initially
		this.addChild(this.line);

		// Create arrow head polygon
		this.arrowHead = new Polygon({
			style: {
				backgroundColor: this.color,
				borderColor: this.color,
				borderWidth: 0,
			},
		});
		this.arrowHead.setPoints([[0, 0], [0, 0], [0, 0]]); // Set minimal triangle initially
		this.addChild(this.arrowHead);
	}

	/**
	 * Set the start point of the arrow
	 */
	public setStartPoint(x: number, y: number): void {
		this.startX = x;
		this.startY = y;
		this.updateArrow();
	}

	/**
	 * Set the end point of the arrow
	 */
	public setEndPoint(x: number, y: number): void {
		this.endX = x;
		this.endY = y;
		this.updateArrow();
	}

	/**
	 * Set both start and end points
	 */
	public setPoints(startX: number, startY: number, endX: number, endY: number): void {
		this.startX = startX;
		this.startY = startY;
		this.endX = endX;
		this.endY = endY;
		this.updateArrow();
	}

	/**
	 * Set the arrow color
	 */
	public setColor(color: string): void {
		this.color = color;
		this.line.setFillColor(color);
		this.line.setStrokeColor(color);
		this.arrowHead.setFillColor(color);
		this.arrowHead.setStrokeColor(color);
	}

	/**
	 * Set the line width
	 */
	public setLineWidth(width: number): void {
		this.lineWidth = width;
		this.updateArrow();
	}

	/**
	 * Set the arrow head size
	 */
	public setArrowHeadSize(size: number): void {
		this.arrowHeadSize = size;
		this.updateArrow();
	}

	/**
	 * Update the arrow geometry based on start and end points
	 */
	private updateArrow(): void {
		// Calculate arrow direction and length
		const dx = this.endX - this.startX;
		const dy = this.endY - this.startY;
		const length = Math.sqrt(dx * dx + dy * dy);

		if (length === 0) {
			// No arrow if start and end are the same
			this.hide();
			return;
		}

		// Make visible when we have valid points
		this.hidden = false;

		// Normalize direction
		const dirX = dx / length;
		const dirY = dy / length;

		// Calculate perpendicular direction for line width
		const perpX = -dirY;
		const perpY = dirX;

		// Calculate line rectangle points (offset from arrow position)
		const halfWidth = this.lineWidth / 2;
		const lineStartX = this.startX - this.getX();
		const lineStartY = this.startY - this.getY();
		const lineEndX = this.endX - this.getX() - dirX * this.arrowHeadSize;
		const lineEndY = this.endY - this.getY() - dirY * this.arrowHeadSize;

		const linePoints = [
			lineStartX + perpX * halfWidth, lineStartY + perpY * halfWidth,
			lineStartX - perpX * halfWidth, lineStartY - perpY * halfWidth,
			lineEndX - perpX * halfWidth, lineEndY - perpY * halfWidth,
			lineEndX + perpX * halfWidth, lineEndY + perpY * halfWidth,
		];

		// Convert flat array to point pairs
		const linePointPairs: [number, number][] = [];
		for (let i = 0; i < linePoints.length; i += 2) {
			linePointPairs.push([linePoints[i], linePoints[i + 1]]);
		}
		this.line.setPoints(linePointPairs);

		// Calculate arrow head points
		const headX = this.endX - this.getX();
		const headY = this.endY - this.getY();
		const headBaseX = headX - dirX * this.arrowHeadSize;
		const headBaseY = headY - dirY * this.arrowHeadSize;

		const headPoints = [
			headX, headY, // Tip
			headBaseX + perpX * this.arrowHeadSize * 0.6, headBaseY + perpY * this.arrowHeadSize * 0.6,
			headBaseX - perpX * this.arrowHeadSize * 0.6, headBaseY - perpY * this.arrowHeadSize * 0.6,
		];

		// Convert flat array to point pairs
		const headPointPairs: [number, number][] = [];
		for (let i = 0; i < headPoints.length; i += 2) {
			headPointPairs.push([headPoints[i], headPoints[i + 1]]);
		}
		this.arrowHead.setPoints(headPointPairs);

		// Update our own bounds to encompass the entire arrow
		const minX = Math.min(this.startX, this.endX) - this.arrowHeadSize;
		const minY = Math.min(this.startY, this.endY) - this.arrowHeadSize;
		const maxX = Math.max(this.startX, this.endX) + this.arrowHeadSize;
		const maxY = Math.max(this.startY, this.endY) + this.arrowHeadSize;

		this.setPosition(minX, minY);
		this.setSize(maxX - minX, maxY - minY);
	}

	/**
	 * Check if the arrow is visible (has valid start and end points and not hidden)
	 */
	public isVisible(): boolean {
		if (this.hidden) return false;
		const dx = this.endX - this.startX;
		const dy = this.endY - this.startY;
		return Math.sqrt(dx * dx + dy * dy) > 0;
	}

	/**
	 * Hide the arrow
	 */
	public hide(): void {
		this.hidden = true;
	}

	/**
	 * Render the arrow
	 */
	public render(context?: RenderContext): void {
		if (this.isVisible()) {
			// Call Layer's render method to render children (line and arrowHead polygons)
			Layer.prototype.render.call(this, context);
		}
	}
}