/**
 * Types of events that can be dispatched
 */
export enum EventType {
  STATE_CHANGED = 'state_changed',
  GAME_START = 'game_start',
  GAME_PAUSE = 'game_pause',
  GAME_RESUME = 'game_resume',
  GAME_END = 'game_end',
  SCREEN_CHANGE = 'screen_change',
  ACTION_PERFORMED = 'action_performed',
}

/**
 * Event interface
 */
export interface GameEvent {
  type: EventType;
  payload?: any;
}

/**
 * Event handler type
 */
export type EventHandler = (event: GameEvent) => void;

/**
 * State management class
 */
export class State {
  private state: Record<string, any> = {};
  private previousState: Record<string, any> = {};
  private listeners: Map<EventType, EventHandler[]> = new Map();
  
  /**
   * Initialize the state with default values
   * @param initialState Initial state values
   */
  constructor(initialState: Record<string, any> = {}) {
    this.state = { ...initialState };
    this.previousState = { ...this.state };
  }
  
  /**
   * Get current state
   * @returns Current state object
   */
  public getState(): Record<string, any> {
    return { ...this.state };
  }
  
  /**
   * Get previous state
   * @returns Previous state object
   */
  public getPreviousState(): Record<string, any> {
    return { ...this.previousState };
  }
  
  /**
   * Get a specific value from the state
   * @param key State key
   * @returns Value for the key
   */
  public get<T>(key: string): T {
    return this.state[key] as T;
  }
  
  /**
   * Set a value in the state
   * @param key State key
   * @param value New value
   */
  public set<T>(key: string, value: T): void {
    // Save previous state
    this.previousState = { ...this.state };
    
    // Update state
    this.state[key] = value;
    
    // Dispatch state change event
    this.dispatch({
      type: EventType.STATE_CHANGED,
      payload: { key, value, previousValue: this.previousState[key] }
    });
  }
  
  /**
   * Update multiple state values at once
   * @param newState Partial state object to merge
   */
  public update(newState: Record<string, any>): void {
    // Save previous state
    this.previousState = { ...this.state };
    
    // Update state
    this.state = { ...this.state, ...newState };
    
    // Dispatch state change event
    this.dispatch({
      type: EventType.STATE_CHANGED,
      payload: { updatedKeys: Object.keys(newState) }
    });
  }
  
  /**
   * Check if a key exists in the state
   * @param key State key
   * @returns Whether the key exists
   */
  public has(key: string): boolean {
    return key in this.state;
  }
  
  /**
   * Remove a key from the state
   * @param key State key
   */
  public remove(key: string): void {
    if (this.has(key)) {
      // Save previous state
      this.previousState = { ...this.state };
      
      // Remove key
      delete this.state[key];
      
      // Dispatch state change event
      this.dispatch({
        type: EventType.STATE_CHANGED,
        payload: { key, value: undefined, previousValue: this.previousState[key] }
      });
    }
  }
  
  /**
   * Reset the state to initial values
   * @param initialState Initial state values
   */
  public reset(initialState: Record<string, any> = {}): void {
    // Save previous state
    this.previousState = { ...this.state };
    
    // Reset state
    this.state = { ...initialState };
    
    // Dispatch state change event
    this.dispatch({
      type: EventType.STATE_CHANGED,
      payload: { reset: true }
    });
  }
  
  /**
   * Listen for events
   * @param type Event type to listen for
   * @param handler Event handler function
   */
  public on(type: EventType, handler: EventHandler): void {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, []);
    }
    
    this.listeners.get(type)!.push(handler);
  }
  
  /**
   * Remove an event listener
   * @param type Event type
   * @param handler Event handler to remove
   */
  public off(type: EventType, handler: EventHandler): void {
    if (!this.listeners.has(type)) {
      return;
    }
    
    const handlers = this.listeners.get(type)!;
    const index = handlers.indexOf(handler);
    
    if (index !== -1) {
      handlers.splice(index, 1);
    }
  }
  
  /**
   * Dispatch an event
   * @param event Event to dispatch
   */
  public dispatch(event: GameEvent): void {
    if (!this.listeners.has(event.type)) {
      return;
    }
    
    const handlers = this.listeners.get(event.type)!;
    
    for (const handler of handlers) {
      handler(event);
    }
  }
}
