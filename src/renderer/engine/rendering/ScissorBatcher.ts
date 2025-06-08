import { Renderer } from './Renderer';

/**
 * Represents a rectangular scissor region
 */
export interface ScissorRegion {
	x: number;
	y: number;
	width: number;
	height: number;
}

/**
 * Represents a renderable item
 */
export interface Renderable {
	render(renderer: Renderer): void;
}

/**
 * ScissorBatcher groups rendering operations by scissor region to minimize state changes
 * This dramatically reduces the number of scissor state changes when rendering multiple
 * scrollable panels or clipped regions.
 */
export class ScissorBatcher {
	private regions: Map<string, { region: ScissorRegion; items: Renderable[] }> = new Map();
	private noScissorItems: Renderable[] = [];
	
	/**
	 * Add an item to be rendered with a specific scissor region
	 * @param region The scissor region to apply (null for no scissor)
	 * @param item The item to render
	 */
	public add(region: ScissorRegion | null, item: Renderable): void {
		if (!region) {
			this.noScissorItems.push(item);
			return;
		}
		
		const key = `${region.x},${region.y},${region.width},${region.height}`;
		if (!this.regions.has(key)) {
			this.regions.set(key, { region, items: [] });
		}
		this.regions.get(key)!.items.push(item);
	}
	
	/**
	 * Render all batched items, grouped by scissor region
	 * @param renderer The renderer to use
	 */
	public render(renderer: Renderer): void {
		// Save current scissor state
		const wasScissorEnabled = renderer.isScissorEnabled();
		let previousScissorBox: Int32Array | null = null;
		if (wasScissorEnabled) {
			previousScissorBox = renderer.getContext().getParameter(renderer.getContext().SCISSOR_BOX);
		}
		
		// First render items without scissor
		if (this.noScissorItems.length > 0) {
			if (wasScissorEnabled) {
				renderer.disableScissor();
			}
			for (const item of this.noScissorItems) {
				item.render(renderer);
			}
		}
		
		// Then render items grouped by scissor region
		for (const [_, { region, items }] of this.regions) {
			// Only flush text if there's text to flush
			if (renderer.hasTextToFlush()) {
				renderer.flushTextBatch();
			}
			
			// Enable scissor for this region
			renderer.enableScissor(region.x, region.y, region.width, region.height);
			
			// Render all items in this region
			for (const item of items) {
				item.render(renderer);
			}
		}
		
		// Restore previous scissor state
		if (renderer.hasTextToFlush()) {
			renderer.flushTextBatch();
		}
		
		if (wasScissorEnabled && previousScissorBox) {
			renderer.enableScissor(
				previousScissorBox[0],
				previousScissorBox[1],
				previousScissorBox[2],
				previousScissorBox[3]
			);
		} else {
			renderer.disableScissor();
		}
		
		// Clear for next frame
		this.clear();
	}
	
	/**
	 * Clear all batched items
	 */
	public clear(): void {
		this.regions.clear();
		this.noScissorItems = [];
	}
	
	/**
	 * Get the number of unique scissor regions
	 */
	public getRegionCount(): number {
		return this.regions.size + (this.noScissorItems.length > 0 ? 1 : 0);
	}
	
	/**
	 * Get the total number of items to render
	 */
	public getItemCount(): number {
		let count = this.noScissorItems.length;
		for (const [_, { items }] of this.regions) {
			count += items.length;
		}
		return count;
	}
}