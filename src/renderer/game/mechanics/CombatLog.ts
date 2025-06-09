import { Model } from '../core/Model';

/**
 * Types of combat log entries
 */
export enum CombatLogType {
	ACTION = 'action',
	DAMAGE = 'damage',
	HEAL = 'heal',
	STATUS = 'status',
	TURN = 'turn',
	INFO = 'info'
}

/**
 * A single combat log entry
 */
export interface CombatLogEntry {
	id: string;
	timestamp: number;
	message: string;
	type: CombatLogType;
	driver?: 1 | 2; // Optional driver number for driver-specific actions
}

/**
 * Combat log data interface
 */
export interface CombatLogData {
	entries: CombatLogEntry[];
	maxEntries: number;
	nextId: number;
}

/**
 * Combat log interface for the class
 */
// eslint-disable-next-line @typescript-eslint/no-empty-interface
export interface CombatLog extends CombatLogData {}

/**
 * Combat log model that tracks combat actions
 * Automatically maintains a rolling buffer of entries
 */
export class CombatLog extends Model<CombatLogData> {
	// Runtime property list - MUST match CombatLogData interface
	static properties = new Set<keyof CombatLogData>([
		'entries',
		'maxEntries',
		'nextId'
	]);
	
	/**
	 * Create a new combat log
	 */
	constructor(maxEntries = 10) {
		super({
			entries: [],
			maxEntries,
			nextId: 1
		});
	}
	
	/**
	 * Add a new log entry - supports both simple string and structured formats
	 * @param entry - Either a string message or a structured entry object
	 * @param type - Optional type when using string format (defaults to INFO)
	 */
	public addEntry(
		entry: string | {
			message: string;
			type?: CombatLogType;
			driver?: 1 | 2;
		},
		type: CombatLogType = CombatLogType.INFO
	): void {
		let message: string;
		let entryType: CombatLogType;
		let driver: 1 | 2 | undefined;
		
		if (typeof entry === 'string') {
			// Simple string format
			message = entry;
			entryType = type;
		} else {
			// Structured format
			message = this.formatMessage(entry);
			entryType = entry.type || CombatLogType.INFO;
			driver = entry.driver;
		}
		
		const newEntry: CombatLogEntry = {
			id: `log-${this.nextId}`,
			timestamp: Date.now(),
			message,
			type: entryType,
			driver
		};
		
		// Increment nextId
		this.nextId = this.nextId + 1;
		
		// Get current entries
		const currentEntries = [...this.entries];
		const removedEntries: CombatLogEntry[] = [];
		
		// Add new entry
		currentEntries.push(newEntry);
		
		// If we exceed max entries, remove the oldest
		if (currentEntries.length > this.maxEntries) {
			const removedEntry = currentEntries.shift();
			if (removedEntry) {
				removedEntries.push(removedEntry);
			}
		}
		
		// Update entries array
		this.entries = currentEntries;
		
		// Emit single change event with added and removed arrays
		this.emit('change', Object.freeze({ 
			added: [newEntry],
			removed: removedEntries
		}));
	}
	
	/**
	 * Format a structured message with driver prefix if specified
	 */
	private formatMessage(entry: {
		message: string;
		driver?: 1 | 2;
	}): string {
		if (entry.driver) {
			return `[D${entry.driver}] ${entry.message}`;
		}
		return entry.message;
	}
	
	/**
	 * Add multiple entries at once
	 */
	public addEntries(entries: Array<string | { message: string; type?: CombatLogType; driver?: 1 | 2 }>): void {
		const newEntries: CombatLogEntry[] = entries.map(entry => {
			const id = `log-${this.nextId}`;
			this.nextId = this.nextId + 1;
			
			if (typeof entry === 'string') {
				return {
					id,
					timestamp: Date.now(),
					message: entry,
					type: CombatLogType.INFO
				};
			} else {
				return {
					id,
					timestamp: Date.now(),
					message: this.formatMessage(entry),
					type: entry.type || CombatLogType.INFO,
					driver: entry.driver
				};
			}
		});
		
		// Get current entries
		const currentEntries = [...this.entries];
		const removedEntries: CombatLogEntry[] = [];
		
		// Add new entries
		currentEntries.push(...newEntries);
		
		// Remove oldest entries if we exceed max
		while (currentEntries.length > this.maxEntries) {
			const removedEntry = currentEntries.shift();
			if (removedEntry) {
				removedEntries.push(removedEntry);
			}
		}
		
		// Update entries array
		this.entries = currentEntries;
		
		// Emit single change event with added and removed arrays
		this.emit('change', Object.freeze({ 
			added: newEntries,
			removed: removedEntries
		}));
	}
	
	/**
	 * Clear all entries
	 */
	public clear(): void {
		const oldEntries = [...this.entries];
		this.entries = [];
		
		// Emit change event with all entries removed
		this.emit('change', Object.freeze({ 
			added: [],
			removed: oldEntries
		}));
	}
	
	/**
	 * Get the most recent entry
	 */
	public getLatestEntry(): CombatLogEntry | null {
		return this.entries.length > 0 ? this.entries[this.entries.length - 1] : null;
	}
	
	/**
	 * Get entries of a specific type
	 */
	public getEntriesByType(type: CombatLogType): CombatLogEntry[] {
		return this.entries.filter(entry => entry.type === type);
	}
}