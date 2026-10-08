import type { Mat2D, Rect, Vec2 } from '../../../engine/draw';

/**
 * Pan and zoom over the area map, as plain maths so it's tested without a
 * renderer.
 *
 * Three spaces. World space is the generator's: world units, the compound at
 * the origin, y north. Map space is world space with y flipped, so it runs
 * down the screen like every other space in the UI; the view keeps its
 * geometry there, so the camera is a scale and a translation with no
 * reflection in it. Screen space is the view's own content box, logical
 * pixels, origin top-left.
 *
 * `zoom` is screen pixels per world unit and `center` the world point at the
 * middle of the view. The camera keeps the centre inside the disc's bounding
 * square, so the map can't be panned off the view, and the zoom between
 * `minZoom` (a little short of the whole disc in view) and `maxZoom`.
 */

export interface MapCameraOptions {
	/** World units: the disc's radius. */
	radius: number;
	/** Screen pixels. */
	width?: number;
	height?: number;
}

/** Screen pixels per world unit at the closest. A road step (20 units) is then 80 pixels. */
export const MAX_ZOOM = 4;
/** How far past the whole disc the camera zooms out: a share of the zoom that fits it. */
export const MIN_ZOOM_SHARE = 0.75;
/** Room left round a fitted rect, as a share of the view's smaller side. */
export const FIT_MARGIN = 0.04;

export class MapCamera {
	private mapRadius: number;
	private viewWidth: number;
	private viewHeight: number;
	private centerX = 0;
	private centerY = 0;
	private scale = 1;
	/** The world rect last fitted, refitted on a resize until the camera is moved by hand. */
	private fitted: Rect | null;

	constructor({ radius, width = 0, height = 0 }: MapCameraOptions) {
		if (!(radius > 0)) throw new Error(`MapCamera: radius must be positive, got ${radius}`);
		this.mapRadius = radius;
		this.viewWidth = width;
		this.viewHeight = height;
		this.fitted = this.discRect;
		this.refit();
	}

	public get radius(): number {
		return this.mapRadius;
	}

	/** A new map: the camera fits its whole disc. */
	public set radius(radius: number) {
		if (!(radius > 0)) throw new Error(`MapCamera: radius must be positive, got ${radius}`);
		this.mapRadius = radius;
		this.fit(this.discRect);
	}

	public get width(): number {
		return this.viewWidth;
	}

	public get height(): number {
		return this.viewHeight;
	}

	/** The world point at the middle of the view. */
	public get center(): Vec2 {
		return { x: this.centerX, y: this.centerY };
	}

	public set center(point: Vec2) {
		this.fitted = null;
		this.centerX = point.x;
		this.centerY = point.y;
		this.clampCenter();
	}

	/** Screen pixels per world unit. */
	public get zoom(): number {
		return this.scale;
	}

	public set zoom(value: number) {
		this.fitted = null;
		this.scale = this.clampZoom(value);
	}

	/** The zoom that fits the whole disc, less `MIN_ZOOM_SHARE`. */
	public get minZoom(): number {
		return Math.min(MAX_ZOOM, this.fitZoom(this.discRect) * MIN_ZOOM_SHARE);
	}

	public get maxZoom(): number {
		return MAX_ZOOM;
	}

	/** True until the camera is panned or zoomed by hand; a resize then refits. */
	public get isFitted(): boolean {
		return this.fitted !== null;
	}

	/** The disc's bounding square, in world space. */
	public get discRect(): Rect {
		const radius = this.mapRadius;
		return { x: -radius, y: -radius, width: radius * 2, height: radius * 2 };
	}

	/**
	 * Map space to screen: `[zoom, 0, 0, zoom, tx, ty]`. Under it a map-space
	 * point lands where `worldToScreen` puts its world twin.
	 */
	public get matrix(): Mat2D {
		const scale = this.scale;
		return [scale, 0, 0, scale, this.viewWidth / 2 - this.centerX * scale, this.viewHeight / 2 + this.centerY * scale];
	}

	/** The view resized: refit if fitted, else keep the centre and zoom, clamped. */
	public resize(width: number, height: number): void {
		this.viewWidth = width;
		this.viewHeight = height;
		this.refit();
	}

	/** Shows world `rect` whole, centred, with `FIT_MARGIN` round it, and refits it on every resize until moved. */
	public fit(rect: Rect): void {
		this.fitted = { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
		this.refit();
	}

	public worldToScreen(x: number, y: number, out: Vec2 = { x: 0, y: 0 }): Vec2 {
		out.x = this.viewWidth / 2 + (x - this.centerX) * this.scale;
		out.y = this.viewHeight / 2 - (y - this.centerY) * this.scale;
		return out;
	}

	public screenToWorld(x: number, y: number, out: Vec2 = { x: 0, y: 0 }): Vec2 {
		out.x = this.centerX + (x - this.viewWidth / 2) / this.scale;
		out.y = this.centerY - (y - this.viewHeight / 2) / this.scale;
		return out;
	}

	/** Moves the map with a drag of (dx, dy) screen pixels: what was under the pointer stays under it. */
	public panBy(dx: number, dy: number): void {
		this.fitted = null;
		this.centerX -= dx / this.scale;
		this.centerY += dy / this.scale;
		this.clampCenter();
	}

	/**
	 * Zooms by `factor` about a screen point, which keeps the world point
	 * under it there unless a clamp intervenes. Returns whether anything moved.
	 */
	public zoomAt(factor: number, screenX: number, screenY: number): boolean {
		const next = this.clampZoom(this.scale * factor);
		if (next === this.scale) return false;
		const anchor = this.screenToWorld(screenX, screenY);
		this.fitted = null;
		this.scale = next;
		this.centerX = anchor.x - (screenX - this.viewWidth / 2) / next;
		this.centerY = anchor.y + (screenY - this.viewHeight / 2) / next;
		this.clampCenter();
		return true;
	}

	/** Whether zooming by `factor` would change anything: false at the limit it heads for. */
	public canZoom(factor: number): boolean {
		return this.clampZoom(this.scale * factor) !== this.scale;
	}

	/** The world rect the view shows. */
	public get visibleWorld(): Rect {
		const width = this.viewWidth / this.scale;
		const height = this.viewHeight / this.scale;
		return { x: this.centerX - width / 2, y: this.centerY - height / 2, width, height };
	}

	private refit(): void {
		const rect = this.fitted;
		if (rect === null) {
			this.scale = this.clampZoom(this.scale);
			this.clampCenter();
			return;
		}
		this.scale = this.clampZoom(this.fitZoom(rect));
		this.centerX = rect.x + rect.width / 2;
		this.centerY = rect.y + rect.height / 2;
		this.clampCenter();
	}

	/** The zoom that shows `rect` whole with the margin; 1 for a view or a rect of no size. */
	private fitZoom(rect: Rect): number {
		const margin = Math.min(this.viewWidth, this.viewHeight) * FIT_MARGIN;
		const width = this.viewWidth - margin * 2;
		const height = this.viewHeight - margin * 2;
		if (width <= 0 || height <= 0 || rect.width <= 0 || rect.height <= 0) return 1;
		return Math.min(width / rect.width, height / rect.height);
	}

	private clampZoom(value: number): number {
		if (!Number.isFinite(value) || value <= 0) return this.scale;
		return Math.max(this.minZoom, Math.min(MAX_ZOOM, value));
	}

	private clampCenter(): void {
		const radius = this.mapRadius;
		this.centerX = Math.max(-radius, Math.min(radius, this.centerX));
		this.centerY = Math.max(-radius, Math.min(radius, this.centerY));
	}
}
