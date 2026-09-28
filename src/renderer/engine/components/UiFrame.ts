import type { Component } from './Component';

/**
 * Passes over a layout pass before giving up on a tree that keeps
 * invalidating itself from its own `onLayout`.
 */
const MAX_LAYOUT_PASSES = 8;

/**
 * The per-frame half of the mount context (R8.16 to R8.18): who asked for
 * `update(dt)`, and which relayout boundaries are dirty.
 *
 * The shell runs it in R8.16's order, `update` then `layout`, before render;
 * the input system calls `layout` on demand before a hit test so a pointer
 * never lands on geometry from before a change. Render never runs layout.
 */
export class UiFrame {
	private requested = new Set<Component>();
	/** The other half of a double buffer, so a frame's update allocates nothing. */
	private spare = new Set<Component>();
	private readonly dirty = new Set<Component>();

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
	}

	public get hasUpdateRequests(): boolean {
		return this.requested.size > 0;
	}

	/**
	 * Runs the requested set in request order. A component in an invisible
	 * subtree is skipped and keeps its request, so it resumes when shown; one
	 * unmounted since it asked is dropped.
	 */
	public update(dt: number): void {
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

	public get layoutPending(): boolean {
		return this.dirty.size > 0;
	}

	/**
	 * Lays out every dirty boundary once, outermost first, so a boundary inside
	 * another dirty one is done by the outer pass. Layout that invalidates
	 * layout (an `onLayout` that resizes something) gets further passes, up to
	 * a bound that turns a feedback loop into an error instead of a hang.
	 */
	public layout(): void {
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
	}
}

function depthOf(component: Component): number {
	return component.parent ? depthOf(component.parent) + 1 : 0;
}
