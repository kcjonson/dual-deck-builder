import { Layer } from '../../../engine/components/Layer';
import { Rectangle } from '../../../engine/components/Rectangle';
import { Text } from '../../../engine/components/Text';
import { Panel } from '../../../engine/ui/Panel';
import { CombatLog, CombatLogEntry, CombatLogType } from '../../mechanics/CombatLog';

/**
 * Visual representation of a log entry
 */
interface LogEntryVisual {
	id: string;
	text: Text;
	entry: CombatLogEntry;
}

/**
 * Combat log layer for displaying action history
 * Efficiently renders log entries by reusing text components
 */
export class CombatLogLayer extends Layer {
	private panel: Panel;
	private combatLog: CombatLog;
	private entryVisuals: Map<string, LogEntryVisual> = new Map();
	private unsubscriber: (() => void) | null = null;
	
	constructor({
		x, y, width, height,
		combatLog
	}: {
		x: number;
		y: number;
		width: number;
		height: number;
		combatLog: CombatLog;
	}) {
		super({ x, y, width, height });
		
		this.combatLog = combatLog;
		
		// Create background
		const background = new Rectangle({
			x: 0,
			y: 0,
			width,
			height,
			style: {
				backgroundColor: '#000000',
				borderColor: '#333333',
				borderWidth: 2,
				borderRadius: 8,
			}
		});
		this.addChild(background);
		
		// Create title
		const title = new Text('Combat Log', {
			x: 10,
			y: 5,
			style: {
				fontSize: 14,
				color: '#ffcc00',
				fontWeight: 'bold'
			}
		});
		this.addChild(title);
		
		// Create scrollable panel for log entries
		this.panel = new Panel({
			x: 5,
			y: 25,
			width: width - 10,
			height: height - 30,
			style: {
				backgroundColor: '#111111',
				borderColor: '#333333',
				borderWidth: 1,
				borderRadius: 4,
			}
		});
		this.addChild(this.panel);
		
		// Panel is not scrollable - no need to set content size
		
		// Subscribe to combat log events
		this.subscribeToEvents();
		
		// Initial render of any existing entries
		this.renderExistingEntries();
	}
	
	/**
	 * Subscribe to combat log model events
	 */
	private subscribeToEvents(): void {
		// Subscribe to the single change event
		this.unsubscriber = this.combatLog.on('change', (event: { added: CombatLogEntry[], removed: CombatLogEntry[] }) => {
			this.handleChange(event.added, event.removed);
		});
	}
	
	/**
	 * Render any existing entries in the combat log
	 */
	private renderExistingEntries(): void {
		this.combatLog.entries.forEach((entry, index) => {
			this.createEntryVisual(entry, index);
		});
		this.updateLayout();
	}
	
	/**
	 * Handle change event with batch updates
	 */
	private handleChange(added: CombatLogEntry[], removed: CombatLogEntry[]): void {
		// First, remove any entries that were removed
		removed.forEach(entry => {
			const visual = this.entryVisuals.get(entry.id);
			if (visual) {
				// Remove from panel
				this.panel.removeChild(visual.text);
				// Remove from map
				this.entryVisuals.delete(entry.id);
			}
		});
		
		// Then, add any new entries
		added.forEach(entry => {
			const index = this.combatLog.entries.indexOf(entry);
			if (index !== -1) {
				this.createEntryVisual(entry, index);
			}
		});
		
		// Update layout once for all changes
		this.updateLayout();
		
		// If entries were added, scroll to bottom
		if (added.length > 0) {
			// Scroll to bottom by setting scroll offset to max
			const contentHeight = this.panel.getContentSize().height;
			const panelHeight = this.panel.getHeight();
			if (contentHeight > panelHeight) {
				this.panel.setScrollOffset(0, contentHeight - panelHeight);
			}
		}
	}
	
	/**
	 * Create visual representation for an entry
	 */
	private createEntryVisual(entry: CombatLogEntry, index: number): void {
		// Get color based on type and driver
		const color = this.getColorForEntry(entry);
		
		// Create text component
		const text = new Text(entry.message, {
			x: 5,
			y: 0, // Will be positioned by updateLayout
			style: {
				fontSize: 12,
				color,
				whiteSpace: 'normal',
				textOverflow: 'visible'
			}
		});
		
		// Set width for wrapping
		text.setWidth(this.panel.getWidth() - 15);
		
		// Add to panel
		this.panel.addChild(text);
		
		// Store visual
		this.entryVisuals.set(entry.id, {
			id: entry.id,
			text,
			entry
		});
	}
	
	/**
	 * Update layout of all entries
	 */
	private updateLayout(): void {
		let yOffset = 5;
		const lineHeight = 18;
		
		// Position each entry based on current order in combat log
		this.combatLog.entries.forEach(entry => {
			const visual = this.entryVisuals.get(entry.id);
			if (visual) {
				visual.text.setPosition(5, yOffset);
				
				// Calculate height accounting for wrapped text
				const textHeight = Math.max(lineHeight, visual.text.getHeight ? visual.text.getHeight() : lineHeight);
				yOffset += textHeight + 2;
			}
		});
		
		// Update panel content size
		this.panel.setContentSize(this.panel.getWidth() - 10, yOffset + 5);
	}
	
	/**
	 * Get color for log entry based on type and driver
	 */
	private getColorForEntry(entry: CombatLogEntry): string {
		// If driver-specific action, use driver colors
		if (entry.driver && entry.type === CombatLogType.ACTION) {
			return entry.driver === 1 ? '#66bbff' : '#66ff99'; // Blue for D1, Green for D2
		}
		
		// Otherwise use type-based colors
		return this.getColorForType(entry.type);
	}
	
	/**
	 * Get color for log entry type
	 */
	private getColorForType(type: CombatLogType): string {
		switch (type) {
			case CombatLogType.ACTION:
				return '#ffffff'; // White for actions
			case CombatLogType.DAMAGE:
				return '#ff6666'; // Red for damage
			case CombatLogType.HEAL:
				return '#66ff66'; // Green for healing
			case CombatLogType.STATUS:
				return '#ffff66'; // Yellow for status effects
			case CombatLogType.TURN:
				return '#66ccff'; // Blue for turn changes
			case CombatLogType.INFO:
			default:
				return '#cccccc'; // Gray for info
		}
	}
	
	/**
	 * Handle resize
	 */
	public setSize(width: number, height: number): this {
		super.setSize(width, height);
		
		// Update background
		const background = this.getChildren()[0] as Rectangle;
		if (background) {
			background.setSize(width, height);
		}
		
		// Update panel
		this.panel.setSize(width - 10, height - 30);
		
		// Update all text max widths and layout
		this.entryVisuals.forEach(visual => {
			visual.text.setWidth(this.panel.getWidth() - 15);
		});
		this.updateLayout();
		return this;
	}
	
	/**
	 * Clean up subscriptions
	 */
	public cleanup(): void {
		if (this.unsubscriber) {
			this.unsubscriber();
			this.unsubscriber = null;
		}
	}
}