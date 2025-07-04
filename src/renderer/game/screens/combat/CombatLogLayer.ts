import { Layer } from '../../../engine/components/Layer';
import { Rectangle } from '../../../engine/components/Rectangle';
import { Text } from '../../../engine/components/Text';
import { CombatLog, CombatLogEntry, CombatLogType } from '../../mechanics/CombatLog';
import { Panel } from '../../../engine/ui/Panel';

/**
 * Combat log display layer showing recent battle events
 * Fixed to properly handle Model change events
 */
export class CombatLogLayer extends Layer {
	private combatLog: CombatLog;
	private panel: Panel;
	private entryVisuals: Map<string, { text: Text, entry: CombatLogEntry }> = new Map();
	private unsubscriber: (() => void) | null = null;
	
	// Display properties
	private readonly entryHeight = 20;
	private readonly padding = 10;
	private readonly fontSize = 14;
	
	constructor(options: {
		x: number;
		y: number;
		width: number;
		height: number;
		combatLog: CombatLog;
	}) {
		super({
			x: options.x,
			y: options.y,
			width: options.width,
			height: options.height,
		});
		
		this.combatLog = options.combatLog;
		
		// Create background
		const background = new Rectangle({
			x: 0,
			y: 0,
			width: this.getWidth(),
			height: this.getHeight(),
			style: {
				backgroundColor: 'rgba(0, 0, 0, 0.8)',
				borderColor: '#4a4a5a',
				borderWidth: 2,
			},
		});
		this.addChild(background);
		
		// Create header
		const header = new Rectangle({
			x: 0,
			y: 0,
			width: this.getWidth(),
			height: 30,
			style: {
				backgroundColor: '#2a2a3a',
				borderColor: '#4a4a5a',
				borderWidth: 1,
			},
		});
		this.addChild(header);
		
		const title = new Text('Combat Log', {
			style: {
				fontSize: 16,
				color: '#ffffff',
				textAlign: 'center',
				fontWeight: 'bold',
			},
		});
		title.setPosition(Math.floor(this.getWidth() / 2), 15);
		this.addChild(title);
		
		// Create scrollable panel for entries
		this.panel = new Panel({
			x: this.padding,
			y: 35,
			width: this.getWidth() - this.padding * 2,
			height: this.getHeight() - 45,
			style: {
				backgroundColor: 'transparent',
			},
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
		// Subscribe to the change event - Model emits the full state
		this.unsubscriber = this.combatLog.on('change', () => {
			// For now, just re-render all entries
			this.handleFullUpdate();
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
	 * Handle full update by re-rendering all entries
	 */
	private handleFullUpdate(): void {
		// Clear existing visuals
		this.entryVisuals.forEach(visual => {
			this.panel.removeChild(visual.text);
		});
		this.entryVisuals.clear();
		
		// Re-render all entries
		this.renderExistingEntries();
		
		// Scroll to bottom to show latest entries
		this.scrollToBottom();
	}
	
	/**
	 * Create visual representation of a log entry
	 */
	private createEntryVisual(entry: CombatLogEntry, _index: number): void {
		// Skip if entry already exists
		if (this.entryVisuals.has(entry.id)) {
			return;
		}
		
		const color = this.getColorForEntry(entry);
		const prefix = this.getPrefixForEntry(entry);
		const fullText = prefix + entry.message;
		
		const text = new Text(fullText, {
			style: {
				fontSize: this.fontSize,
				color: color,
				textAlign: 'left',
			},
		});
		
		// Position will be set by updateLayout
		this.panel.addChild(text);
		
		// Store the visual
		this.entryVisuals.set(entry.id, { text, entry });
	}
	
	/**
	 * Update layout of all entries
	 */
	private updateLayout(): void {
		// Get entries in order
		const orderedEntries = Array.from(this.entryVisuals.values())
			.sort((a, b) => {
				const indexA = this.combatLog.entries.indexOf(a.entry);
				const indexB = this.combatLog.entries.indexOf(b.entry);
				return indexA - indexB;
			});
		
		// Position each entry
		orderedEntries.forEach((visual, index) => {
			visual.text.setPosition(5, index * this.entryHeight + this.fontSize);
		});
		
		// Update panel content size for scrolling
		const totalHeight = Math.max(
			orderedEntries.length * this.entryHeight,
			this.panel.getHeight()
		);
		this.panel.setContentSize(this.panel.getWidth(), totalHeight);
	}
	
	/**
	 * Get color for entry based on type
	 */
	private getColorForEntry(entry: CombatLogEntry): string {
		switch (entry.type) {
			case CombatLogType.INFO:
				return '#ffffff';
			case CombatLogType.ACTION:
				return '#88cc88';
			case CombatLogType.DAMAGE:
				return '#cc8888';
			case CombatLogType.HEAL:
				return '#88cccc';
			case CombatLogType.TURN:
				return '#cccc88';
			case CombatLogType.STATUS:
				return '#8888cc';
			case CombatLogType.MISS:
				return '#cc88cc';
			case CombatLogType.ARMOR:
				return '#88cc88';
			case CombatLogType.RESOURCE:
				return '#ccaa88';
			case CombatLogType.POSITION:
				return '#88ccaa';
			case CombatLogType.BATTLE_START:
				return '#88ff88';
			case CombatLogType.BATTLE_END:
				return '#ff8888';
			default:
				return '#aaaaaa';
		}
	}
	
	/**
	 * Get prefix for entry based on driver and turn
	 */
	private getPrefixForEntry(entry: CombatLogEntry): string {
		let prefix = '';
		
		// Add turn number if available
		if (entry.turn !== undefined) {
			prefix += `[Turn ${entry.turn}] `;
		}
		
		// Add driver identifier if available
		if (entry.driver === 1) {
			prefix += '[Driver 1] ';
		} else if (entry.driver === 2) {
			prefix += '[Driver 2] ';
		}
		
		return prefix;
	}
	
	/**
	 * Scroll to bottom of log
	 */
	private scrollToBottom(): void {
		// TODO: Implement scrolling when Panel supports it
	}
	
	/**
	 * Unmount event subscriptions
	 */
	public unmount(): void {
		if (this.unsubscriber) {
			this.unsubscriber();
			this.unsubscriber = null;
		}
	}
	
	/**
	 * Handle resize
	 */
	protected onResized(): void {
		// Update background
		const background = this.children[0] as Rectangle;
		if (background) {
			background.setSize(this.getWidth(), this.getHeight());
		}
		
		// Update header
		const header = this.children[1] as Rectangle;
		if (header) {
			header.setWidth(this.getWidth());
		}
		
		// Update title position
		const title = this.children[2] as Text;
		if (title) {
			title.setPosition(Math.floor(this.getWidth() / 2), 15);
		}
		
		// Update panel
		if (this.panel) {
			this.panel.setSize(
				this.getWidth() - this.padding * 2,
				this.getHeight() - 45
			);
			this.updateLayout();
		}
	}
}