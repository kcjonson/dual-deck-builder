/**
 * Simple EventEmitter base class for change tracking
 * Provides event emission capabilities to game mechanics classes
 */
export class EventEmitter {
	private listeners: Map<string, Set<Function>> = new Map();

	/**
	 * Subscribe to an event
	 * @param event Event name
	 * @param listener Callback function
	 * @returns Unsubscribe function
	 */
	public on(event: string, listener: Function): () => void {
		if (!this.listeners.has(event)) {
			this.listeners.set(event, new Set());
		}
		
		this.listeners.get(event)!.add(listener);
		
		// Return unsubscribe function
		return () => {
			const eventListeners = this.listeners.get(event);
			if (eventListeners) {
				eventListeners.delete(listener);
			}
		};
	}

	/**
	 * Subscribe to an event once (auto-unsubscribes after first emit)
	 * @param event Event name
	 * @param listener Callback function
	 */
	public once(event: string, listener: Function): void {
		const unsubscribe = this.on(event, (...args: any[]) => {
			unsubscribe();
			listener(...args);
		});
	}

	/**
	 * Emit an event
	 * @param event Event name
	 * @param args Arguments to pass to listeners
	 */
	protected emit(event: string, ...args: any[]): void {
		const eventListeners = this.listeners.get(event);
		if (eventListeners) {
			// Create a copy to avoid issues if listeners modify the set
			const listenersCopy = Array.from(eventListeners);
			listenersCopy.forEach(listener => {
				try {
					listener(...args);
				} catch (error) {
					console.error(`Error in event listener for "${event}":`, error);
				}
			});
		}
	}

	/**
	 * Remove all listeners for an event or all events
	 * @param event Optional event name. If not provided, removes all listeners
	 */
	public removeAllListeners(event?: string): void {
		if (event) {
			this.listeners.delete(event);
		} else {
			this.listeners.clear();
		}
	}

	/**
	 * Get the number of listeners for an event
	 * @param event Event name
	 */
	public listenerCount(event: string): number {
		const eventListeners = this.listeners.get(event);
		return eventListeners ? eventListeners.size : 0;
	}

	/**
	 * Get all event names that have listeners
	 */
	public eventNames(): string[] {
		return Array.from(this.listeners.keys());
	}
}