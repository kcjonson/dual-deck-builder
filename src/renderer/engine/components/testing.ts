import type { Clock } from '../animation/Clock';
import { DrawApi, NullBackend } from '../draw';
import { circleInk, lineInk, pointsInk, rectInk, shadowInk } from '../draw/bounds';
import type { BoxShadow } from '../draw/commands';
import { ClipRect, Rect, transformedBounds } from '../draw/geometry';
import { glowShadow } from '../style/look';
import type { Component } from './Component';
import { MountContext, MountContextOptions, ViewportSource, createMountContext } from './MountContext';
import { renderTree } from './renderTree';
import { InjectionResult, InjectionTarget, injectInput } from '../debug/inputInjection';

export interface TestContextOptions {
	/** Defaults to a null-backend draw API, so the whole walk runs with no GL (R14.1). */
	draw?: DrawApi;
	/** Defaults to the harness's fixed 1440 by 882 viewport (R13.37). */
	viewport?: ViewportSource;
	/** A clock the test holds, to freeze or inspect (R13.37). */
	clock?: Clock;
	/** Hears the dispatcher's resolved cursor, as a page's canvas would. */
	onCursorChange?: MountContextOptions['onCursorChange'];
}

/** A mount context for tests, built through the same factory the pages use. */
export function createTestContext({ draw, viewport, clock, onCursorChange }: TestContextOptions = {}): MountContext {
	return createMountContext({
		draw: draw ?? new DrawApi({ backend: new NullBackend(), development: false }),
		viewport: viewport ?? { logical: { width: 1440, height: 882 } },
		clock,
		onCursorChange,
	});
}

/**
 * R13.35's injection followed by the next frame's input phase, so a test sees
 * the effect at once. The events still travel the adapter and the queue
 * (R9.25); only the wait for a frame is skipped.
 */
export function injectNow(target: InjectionTarget, commands: string[]): InjectionResult {
	const result = injectInput(target, commands);
	target.dispatcher.dispatchPending();
	return result;
}

/** `rect`, in `component`'s content box, on screen: the bounds of its transformed corners, so a rotation or a scale counts. */
export function rectOnScreen(component: Component, rect: Rect): ClipRect {
	return transformedBounds(component.screenMatrix, rect);
}

/** What `component` draws now (its `revealInk`, or its box where that has no bound) on screen. */
export function inkOnScreen(component: Component): ClipRect {
	return rectOnScreen(component, component.revealInk ?? { x: 0, y: 0, width: component.width, height: component.height });
}

/** `component`'s clip on screen. */
export function clipOnScreen(component: Component): ClipRect {
	return rectOnScreen(component, component.clipRect);
}

/** Expects `inner` inside `outer` on `axis` (or both), to a millionth of a pixel. */
export function expectWithin(inner: ClipRect, outer: ClipRect, axis: 'x' | 'y' | 'both' = 'both'): void {
	if (axis !== 'x') {
		expect(inner.minY).toBeGreaterThanOrEqual(outer.minY - 1e-6);
		expect(inner.maxY).toBeLessThanOrEqual(outer.maxY + 1e-6);
	}
	if (axis !== 'y') {
		expect(inner.minX).toBeGreaterThanOrEqual(outer.minX - 1e-6);
		expect(inner.maxX).toBeLessThanOrEqual(outer.maxX + 1e-6);
	}
}

/** One draw's ink on screen, cut by the clip it is drawn under. */
export interface DrawnInk {
	/** The draw call, and its id when it has one: `rect`, `shadow`, `text`, `circle`, ... */
	readonly draw: string;
	readonly ink: ClipRect;
	/** Drawn as R11.5's glow (`glowShadow`), which a reveal leaves out (R12.20). */
	readonly glow: boolean;
}

const LOOK_GLOW = glowShadow([0, 0, 0, 0]);

/** A shadow in the glow preset's shape, whatever its colour: a look's, a segment chip's, a slider thumb's. */
function isLookGlow(shadow: BoxShadow): boolean {
	const offset = shadow.offset ?? { x: 0, y: 0 };
	return shadow.blur === LOOK_GLOW.blur && shadow.spread === LOOK_GLOW.spread && offset.x === 0 && offset.y === 0;
}

/**
 * Renders `component`'s subtree through `api` in a frame of its own, under
 * its parent's transform and inside a clip far bigger than the screen, as
 * the walk does, its focus ring included, and answers where each draw's ink
 * lands on screen: the bounds the draw API culls by, before its device-pixel
 * outset, cut by the clip the draw is made under. Text is measured with
 * `measureTextInk`, so `api` needs a backend that measures text ink
 * (`createMeasuringDrawApi`). The frame's diagnostics stay on `api`.
 */
export function drawnInk(component: Component, api: DrawApi): DrawnInk[] {
	if (!api.canMeasureTextInk) throw new Error('drawnInk: the draw API cannot measure text ink; use createMeasuringDrawApi');
	const found: DrawnInk[] = [];
	const note = (kind: string, id: string | undefined, local: Rect | null, glow = false): void => {
		const clip = api.clip;
		if (!local || clip.kind === 'empty') return;
		const ink = { ...transformedBounds(api.transform, local) };
		if (clip.kind === 'rect') {
			ink.minX = Math.max(ink.minX, clip.rect.minX);
			ink.minY = Math.max(ink.minY, clip.rect.minY);
			ink.maxX = Math.min(ink.maxX, clip.rect.maxX);
			ink.maxY = Math.min(ink.maxY, clip.rect.maxY);
			if (ink.minX >= ink.maxX || ink.minY >= ink.maxY) return;
		}
		found.push({ draw: id ? `${kind} ${id}` : kind, ink, glow });
	};
	const spies: Partial<DrawApi> = {
		drawRect: (options) => {
			if (options.shadow) note('shadow', options.id, shadowInk(options.rect, options.shadow), isLookGlow(options.shadow));
			note('rect', options.id, rectInk(options.rect, options.border));
			api.drawRect(options);
		},
		drawCircle: (options) => {
			note('circle', options.id, circleInk(options.center, options.radius, options.border));
			api.drawCircle(options);
		},
		drawLine: (options) => {
			note('line', options.id, lineInk(options.from, options.to, options.width));
			api.drawLine(options);
		},
		drawPolyline: (options) => {
			note('polyline', options.id, pointsInk(options.points, options.width));
			api.drawPolyline(options);
		},
		drawPolygon: (options) => {
			note('polygon', options.id, pointsInk(options.points, 0));
			api.drawPolygon(options);
		},
		drawImage: (options) => {
			note('image', options.id, options.rect);
			api.drawImage(options);
		},
		drawText: (options) => {
			let ink = api.measureTextInk(options);
			const box = options.overflow === 'clip' ? options.box : undefined;
			if (ink && box) {
				const x = Math.max(ink.x, box.x);
				const y = Math.max(ink.y, box.y);
				ink = { x, y, width: Math.min(ink.x + ink.width, box.x + box.width) - x, height: Math.min(ink.y + ink.height, box.y + box.height) - y };
				if (ink.width <= 0 || ink.height <= 0) ink = null;
			}
			if (ink && options.shadow) {
				const offset = options.shadow.offset ?? { x: 0, y: 0 };
				const blur = options.shadow.blur ?? 0;
				note('text shadow', options.id, { x: ink.x + offset.x - blur, y: ink.y + offset.y - blur, width: ink.width + blur * 2, height: ink.height + blur * 2 });
			}
			note(`text '${options.text}'`, options.id, ink);
			api.drawText(options);
		},
	};
	const draw = new Proxy(api, {
		get: (target, property) => {
			if (Object.prototype.hasOwnProperty.call(spies, property)) return spies[property as keyof DrawApi];
			const value: unknown = Reflect.get(target, property, target);
			return typeof value === 'function' ? value.bind(target) : value;
		},
	});
	api.beginFrame({ viewport: { width: 4096, height: 4096 } });
	try {
		// Under a rect clip, so the walk's development audit of each bound runs too.
		api.pushClip({ x: -100000, y: -100000, width: 200000, height: 200000 });
		const parent = component.parent;
		if (parent) {
			api.pushTransform(parent.screenMatrix);
			api.pushTranslate(-parent.contentOffset.x, -parent.contentOffset.y);
		}
		renderTree(component, draw);
		if (parent) {
			api.popTransform();
			api.popTransform();
		}
		api.popClip();
	} finally {
		api.endFrame();
	}
	return found;
}

/** What R12.20's contract finds for one component: what it reveals against what it draws. */
export interface RevealCheck {
	/** Draws a reveal must show (all but a look's glow) that land outside it: what `revealInk` leaves out. */
	readonly outside: string[];
	/** How far the reveal reaches past the box and those draws on each side: what `revealInk` counts that isn't drawn. */
	readonly beyond: { top: number; right: number; bottom: number; left: number };
	/** The walk's own development audit of each cull bound in the same frame (R8.8). */
	readonly audit: string[];
}

/**
 * R12.20's contract for `component` as it stands: what scrolling it into view
 * shows, its box and `revealInk`, is what its subtree draws now, the walk's
 * ring included and a look's glow left out, to a millionth of a pixel.
 */
export function checkReveal(component: Component, api: DrawApi): RevealCheck {
	const drawn = drawnInk(component, api);
	const audit = api.diagnostics.filter((diagnostic) => diagnostic.code === 'ink-outside-bound').map((diagnostic) => diagnostic.message);
	const box = rectOnScreen(component, { x: 0, y: 0, width: component.width, height: component.height });
	const ink = inkOnScreen(component);
	const reveal = { minX: Math.min(box.minX, ink.minX), minY: Math.min(box.minY, ink.minY), maxX: Math.max(box.maxX, ink.maxX), maxY: Math.max(box.maxY, ink.maxY) };
	const shown = { ...box };
	const outside: string[] = [];
	const at = (rect: ClipRect): string => `[${[rect.minX, rect.minY, rect.maxX, rect.maxY].map((edge) => Math.round(edge * 100) / 100).join(', ')}]`;
	for (const { draw, ink: drawnRect, glow } of drawn) {
		if (glow) continue;
		shown.minX = Math.min(shown.minX, drawnRect.minX);
		shown.minY = Math.min(shown.minY, drawnRect.minY);
		shown.maxX = Math.max(shown.maxX, drawnRect.maxX);
		shown.maxY = Math.max(shown.maxY, drawnRect.maxY);
		const inside = drawnRect.minX >= reveal.minX - 1e-6 && drawnRect.minY >= reveal.minY - 1e-6
			&& drawnRect.maxX <= reveal.maxX + 1e-6 && drawnRect.maxY <= reveal.maxY + 1e-6;
		if (!inside) outside.push(`${draw} at ${at(drawnRect)}, outside ${at(reveal)}`);
	}
	const settle = (distance: number): number => (distance > 1e-6 ? Math.round(distance * 1e6) / 1e6 : 0);
	const beyond = {
		top: settle(shown.minY - reveal.minY),
		right: settle(reveal.maxX - shown.maxX),
		bottom: settle(reveal.maxY - shown.maxY),
		left: settle(shown.minX - reveal.minX),
	};
	return { outside, beyond, audit };
}
