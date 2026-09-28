import { Layer, LayerOptions } from '../../../engine/components/Layer';
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
	private background: Rectangle;
	private header: Rectangle;
	private title: Text;
	private panel: Panel;
	private entryVisuals: Map<string, { text: Text, entry: CombatLogEntry }> = new Map();
	private unsubscriber: (() => void) | null = null;

	// Display properties
	private readonly entryHeight = 20;
	private readonly headerHeight = 30;
	private readonly padding = 10;
	private readonly fontSize = 14;

	constructor(options: LayerOptions & { x: number; y: number; width: number; height: number; combatLog: CombatLog }) {
		super(options);

		this.combatLog = options.combatLog;

		// Sized from the layer by placeChrome, in the layout phase
		this.background = new Rectangle({
			style: {
				backgroundColor: 'rgba(0, 0, 0, 0.8)',
				borderColor: '#4a4a5a',
				borderWidth: 2,
			},
		});
		this.addChild(this.background);

		this.header = new Rectangle({
			height: this.headerHeight,
			style: {
				backgroundColor: '#2a2a3a',
				borderColor: '#4a4a5a',
				borderWidth: 1,
			},
		});
		this.addChild(this.header);

		// Centred in the header
		this.title = new Text('Combat Log', {
			height: this.headerHeight,
			style: {
				fontSize: 16,
				color: '#ffffff',
				textAlign: 'center',
				verticalAlign: 'middle',
				whiteSpace: 'nowrap',
				fontWeight: 'bold',
			},
		});
		this.addChild(this.title);

		// The entries' panel; not scrollable yet
		this.panel = new Panel({
			x: this.padding,
			y: this.headerHeight + 5,
			style: {
				backgroundColor: 'transparent',
			},
		});
		this.addChild(this.panel);
	}

	/**
	 * The model subscription is registered on mount and released on unmount
	 * (R8.14), and the entries are rebuilt from the model, which may have
	 * moved on while the layer was detached.
	 */
	protected onMount(): void {
		this.unsubscriber = this.combatLog.on('change', () => this.handleFullUpdate());
		this.handleFullUpdate();
	}

	/** The model subscription; input is released by the base. */
	protected onUnmount(): void {
		if (this.unsubscriber) {
			this.unsubscriber();
			this.unsubscriber = null;
		}
	}

	/** The layout phase: the layer was sized (R8.18). */
	protected layoutChildren(): void {
		this.placeChrome();
		this.updateLayout();
	}

	private placeChrome(): void {
		const width = this.getWidth();
		const height = this.getHeight();
		this.background.setSize(width, height);
		this.header.setWidth(width);
		this.title.setWidth(width);
		this.panel.setSize(width - this.padding * 2, height - this.headerHeight - 15);
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
}
