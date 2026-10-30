import type { ResolvedColors } from '../../../engine/components/Component';
import { Stack, StackOptions } from '../../../engine/components/Stack';
import type { DrawApi } from '../../../engine/draw/DrawApi';
import type { Rgba } from './combatStyle';

/** Which edges carry a 1 px line. */
export interface ChromeEdges {
	top?: boolean;
	right?: boolean;
	bottom?: boolean;
	left?: boolean;
}

export interface ChromeOptions {
	/** Solid ground, or a top-to-bottom gradient as a pair. */
	fill: Rgba | readonly [Rgba, Rgba];
	/** A 1 px line along the edges named, inside the box. */
	edge?: { color: Rgba; edges: ChromeEdges };
	/** A band of colour across the top, inside the edge line. */
	stripe?: { color: Rgba; height: number };
	/** Radius of the two top corners. */
	topRadius?: number;
}

const EDGE = 1;

/**
 * A stack with the battle screen's panel chrome: a flat or vertical gradient
 * ground, hairline edges, and a coloured top stripe, all inside its box. The
 * bands and the driver tabs are these.
 */
export class ChromeStack extends Stack {
	private readonly chrome: ChromeOptions;

	constructor({ chrome, ...options }: StackOptions & { chrome: ChromeOptions }) {
		super(options);
		this.chrome = chrome;
	}

	public get resolvedColors(): ResolvedColors | null {
		if (this.width <= 0 || this.height <= 0) return null;
		const { fill, edge } = this.chrome;
		const ground = isGradient(fill) ? fill[0] : fill;
		return edge ? { fill: ground, border: edge.color } : { fill: ground };
	}

	public render(draw: DrawApi): void {
		const { width, height } = this;
		if (width <= 0 || height <= 0) return;
		const { fill, edge, stripe, topRadius = 0 } = this.chrome;
		const id = this.id ?? undefined;
		const radius = topRadius > 0 ? [topRadius, topRadius, 0, 0] as const : undefined;

		// The edge line is the outer rect showing past an inset ground, so it
		// follows the rounded corners
		const edges = edge?.edges ?? {};
		if (edge) draw.drawRect({ id, rect: { x: 0, y: 0, width, height }, fill: edge.color, radius });
		const inset = {
			x: edges.left ? EDGE : 0,
			y: edges.top ? EDGE : 0,
			width: width - (edges.left ? EDGE : 0) - (edges.right ? EDGE : 0),
			height: height - (edges.top ? EDGE : 0) - (edges.bottom ? EDGE : 0),
		};
		const innerRadius = topRadius > 0 ? [topRadius - EDGE, topRadius - EDGE, 0, 0] as const : undefined;
		if (isGradient(fill)) {
			const [top, bottom] = fill;
			draw.drawRect({ id, rect: inset, gradient: [top, top, bottom, bottom], radius: innerRadius });
		} else {
			draw.drawRect({ id, rect: inset, fill, radius: innerRadius });
		}
		if (stripe) {
			draw.drawRect({
				id,
				rect: { x: inset.x, y: inset.y, width: inset.width, height: stripe.height },
				fill: stripe.color,
				radius: innerRadius,
			});
		}
	}
}

function isGradient(fill: ChromeOptions['fill']): fill is readonly [Rgba, Rgba] {
	return Array.isArray(fill[0]);
}
