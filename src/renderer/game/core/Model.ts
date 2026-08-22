import { EventEmitter } from './EventEmitter';

/**
 * Base Model class with automatic property getters/setters and change events
 * Based on flux-like patterns with immutable state emission
 */
export abstract class Model<T> extends EventEmitter {
	private readonly __data: Partial<T> = {};
	private readonly __id: string;
	
	// Subclasses must define their properties
	static properties: Set<string>;
	
	constructor(initialData?: Partial<T>) {
		super();
		
		// Generate unique internal ID
		this.__id = `${this.constructor.name}_${Math.random().toString(36).substr(2, 9)}`;
		
		// Get properties from the constructor
		const properties = (this.constructor as typeof Model).properties;
		if (!properties) {
			throw new Error(`${this.constructor.name} must define a static properties Set`);
		}
		
		// Define getters/setters for each property
		properties.forEach((property: string) => {
			Object.defineProperty(this, property, {
				enumerable: true,
				get() {
					return this.__data[property];
				},
				set(value: unknown) {
					const oldValue = this.__data[property];
					if (oldValue !== value) {
						this.__data[property] = value;
						// Emit per-property event, then aggregate change with frozen state snapshot
						this.emit(property, value, oldValue);
						this.emit('change', this.getState());
					}
				}
			});
		});
		
		// Set initial data if provided
		if (initialData) {
			this.set(initialData);
		}
		
		// Freeze the instance to prevent adding properties outside of defined setters
		Object.freeze(this);
	}
	
	/**
	 * Bulk setter - updates multiple properties with a single change event
	 */
	set(data: Partial<T>): void {
		const properties = (this.constructor as typeof Model).properties;
		const changes: Array<[string, unknown, unknown]> = [];

		// Update all properties without emitting
		Object.entries(data).forEach(([key, value]) => {
			if (properties.has(key)) {
				const oldValue = (this.__data as Record<string, unknown>)[key];
				if (oldValue !== value) {
					(this.__data as Record<string, unknown>)[key] = value;
					changes.push([key, value, oldValue]);
				}
			} else {
				console.warn(`Skipping set: property "${key}" is invalid on "${this.constructor.name}" model`);
			}
		});

		// Emit per-property events, then a single aggregate change event
		if (changes.length > 0) {
			changes.forEach(([key, value, oldValue]) => this.emit(key, value, oldValue));
			this.emit('change', this.getState());
		}
	}
	
	/**
	 * Get a single property value
	 */
	get(property: keyof T): T[keyof T] | undefined {
		const properties = (this.constructor as typeof Model).properties;
		if (properties.has(property as string)) {
			return this.__data[property];
		} else {
			console.warn(`Skipping get: property "${String(property)}" is invalid on "${this.constructor.name}" model`);
			return undefined;
		}
	}
	
	/**
	 * Get immutable state snapshot
	 */
	getState(): T {
		// Return frozen copy of current data
		return Object.freeze({ ...this.__data }) as T;
	}
	
	/**
	 * Check if model has a property
	 */
	hasProperty(property: string): boolean {
		return (this.constructor as typeof Model).properties.has(property);
	}
	
	/**
	 * Get the internal ID (read-only)
	 */
	get id(): string {
		return this.__id;
	}
}