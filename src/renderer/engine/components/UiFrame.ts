import type { Animator } from '../animation/Animator';
import type { Clock } from '../animation/Clock';
import type { Component } from './Component';

/**
 * Passes over a layout pass before giving up on a tree that keeps
 * invalidating itself from its own `onLayout`.
 */
const MAX_LAYOUT_PASSES = 8;

/** A mount-context service with per-frame work, such as the tooltip service's hover delay. */
export interface FrameTicker {
	tick(): void;
}

/**
 * The per-frame half of the mount context (R8.16 to R8.18): who asked for
 * `update(dt)`, and which relayout boundaries are dirty. Its update phase is
 * also where time moves: the clock advances and the animator ticks before any
 * component updates (R8.28), so a paused shell, which skips `update`, stops
 * every tween with it.
 *
 * The shell runs it in R8.16's order, `update` then `layout`, before render;
 * the dispatcher calls `layout` on demand before a hit test so a pointer
 * never lands on geometry from before a change. Render never runs layout.
 */
export class UiFrame {
	private readonly clock: Clock;
	private readonly animator: Animator;
	private requested = new Set<Component>();
	/** The other half of a double buffer, so a frame's update allocates nothing. */
	private spare = new Set<Component>();
	private readonly dirty = new Set<Component>();
	private tickers = new Set<FrameTicker>();
	private spareTickers = new Set<FrameTicker>();
	/** Mounted roots, for `viewportChanged`. */
	private readonly roots = new Set<Component>();
	private layoutRuns = 0;
	private readonly layoutListeners: (() => void)[] = [];

	constructor({ clock, animator }: { clock: Clock; animator: Animator }) {
		this.clock = clock;
		this.animator = animator;
	}

	/**
	 * R8.17: `update(dt)` on the next frame, once. A component that animates
	 * asks again from its own `update`, which lands in the next frame's set.
	 */
	public requestUpdate(component: Component): void {
		this.requested.add(component);
	}

	/** Called by the base class on unmount, so nothing unmounted is updated or laid out. */
	public forget(component: Component): void {
		this.requested.delete(component);
		this.spare.delete(component);
		this.dirty.delete(component);
		this.roots.delete(component);
	}

	/** Called by the base class when a root mounts. */
	public addRoot(root: Component): void {
		this.roots.add(root);
	}

	/**
	 * The viewport's logical size changed. Every root sized from it (a `fill`
	 * axis, R8.21) is invalidated, so the resize re-lays out through the same
	 * path as the first layout, with no screen code involved.
	 */
	public viewportChanged(): void {
		for (const root of this.roots) {
			if (root.parent !== null) continue;
			if (root.widthMode === 'fill' || root.heightMode === 'fill') root.invalidateLayout();
		}
	}

	public get hasUpdateRequests(): boolean {
		return this.requested.size > 0 || this.tickers.size > 0;
	}

	/**
	 * R8.17 for a service rather than a component: `tick` on the next frame,
	 * once, after the animator and before component updates, with the clock
	 * already at the frame's time. A service that is waiting on the clock
	 * asks again from its own `tick`.
	 */
	public requestTick(ticker: FrameTicker): void {
		this.tickers.add(ticker);
	}

	/**
	 * Advances the clock by `dt` seconds and ticks the animator, then runs the
	 * requested set in request order. A component in an invisible subtree is
	 * skipped and keeps its request, so it resumes when shown; one unmounted
	 * since it asked is dropped.
	 */
	public update(dt: number): void {
		this.clock.advance(dt * 1000);
		this.animator.tick();
		if (this.tickers.size > 0) {
			const tickers = this.tickers;
			this.tickers = this.spareTickers;
			this.spareTickers = tickers;
			for (const ticker of tickers) ticker.tick();
			tickers.clear();
		}
		if (this.requested.size === 0) return;
		const due = this.requested;
		this.requested = this.spare;
		this.spare = due;
		for (const component of due) {
			if (!component.isMounted) continue;
			if (!component.effectivelyVisible) {
				this.requested.add(component);
				continue;
			}
			component.update(dt);
		}
		due.clear();
	}

	/** A relayout boundary with a dirty subtree (R8.18). The base class calls it. */
	public scheduleLayout(boundary: Component): void {
		this.dirty.add(boundary);
	}

	/**
	 * Runs after every `layout`, whether or not anything was dirty: the focus
	 * manager's fixup (R9.28), which has to see a component hidden or
	 * disabled since the last frame.
	 */
	public afterLayout(listener: () => void): void {
		this.layoutListeners.push(listener);
	}

	public get layoutPending(): boolean {
		return this.dirty.size > 0;
	}

	/**
	 * Counts layout calls that laid something out. The dispatcher compares it
	 * across frames to re-derive hover when layout moved content under a
	 * still pointer (R9.9).
	 */
	public get layoutVersion(): number {
		return this.layoutRuns;
	}

	/**
	 * Lays out every dirty boundary once, outermost first, so a boundary inside
	 * another dirty one is done by the outer pass. Layout that invalidates
	 * layout (an `onLayout` that resizes something) gets further passes, up to
	 * a bound that turns a feedback loop into an error instead of a hang.
	 */
	public layout(): void {
		if (this.dirty.size > 0) this.layoutRuns++;
		for (let pass = 0; this.dirty.size > 0; pass++) {
			if (pass === MAX_LAYOUT_PASSES) {
				this.dirty.clear();
				throw new Error(`UiFrame.layout: still invalid after ${MAX_LAYOUT_PASSES} passes; an onLayout is invalidating what it measures`);
			}
			const boundaries = [...this.dirty].sort((a, b) => depthOf(a) - depthOf(b));
			this.dirty.clear();
			for (const boundary of boundaries) {
				if (boundary.isMounted) boundary.layoutSubtree();
			}
		}
		for (const listener of this.layoutListeners) listener();
	}
}

function depthOf(component: Component): number {
	return component.parent ? depthOf(component.parent) + 1 : 0;
}
