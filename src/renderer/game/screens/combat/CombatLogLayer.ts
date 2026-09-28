import { Layer, LayerOptions } from '../../../engine/components/Layer';
import { Rectangle } from '../../../engine/components/Rectangle';
import { Stack } from '../../../engine/components/Stack';
import { Text } from '../../../engine/components/Text';
import { ScrollContainer } from '../../../engine/ui/ScrollContainer';
import { CombatLog, CombatLogEntry, CombatLogType } from '../../mechanics/CombatLog';

/**
 * The combat log drawer: a header, and the entries in a scroll container
 * that follows the newest entry (DDB-32). Entries are reconciled by id
 * (R8.27), so a change adds the new line and drops the ones the log's
 * rolling buffer dropped, rather than rebuilding every line.
 */
export class CombatLogLayer extends Layer {
	private combatLog: CombatLog;
	private background: Rectangle;
	private header: Rectangle;
	private title: Text;
	private scroller: ScrollContainer;
	private entryList: Stack;
	private unsubscriber: (() => void) | null = null;

	// Display properties
	private readonly entryHeight = 20;
	private readonly headerHeight = 30;
	private readonly padding = 10;
	private readonly fontSize = 14;

	constructor(options: LayerOptions & { x: number; y: number; width: number; height: number; combatLog: CombatLog }) {
		super(options);

		this.combatLog = options.combatLog;

		// Sized from the layer in the layout phase
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

		this.scroller = new ScrollContainer({
			id: 'combat_log_scroll',
			x: this.padding,
			y: this.headerHeight + 5,
			style: { padding: { top: 4, bottom: 4 } },
		});
		this.entryList = new Stack({ id: 'combat_log_entries', padding: { left: 5, right: 5 } });
		this.scroller.addChild(this.entryList);
		this.addChild(this.scroller);
	}

	/** The scroll container the entries are in. */
	public get scrollContainer(): ScrollContainer {
		return this.scroller;
	}

	/**
	 * The model subscription is registered on mount and released on unmount
	 * (R8.14), and the entries are reconciled with the model, which may have
	 * moved on while the layer was detached.
	 */
	protected onMount(): void {
		this.unsubscriber = this.combatLog.on('change', () => this.syncEntries());
		this.syncEntries();
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
		const width = this.getWidth();
		const height = this.getHeight();
		this.background.setSize(width, height);
		this.header.setWidth(width);
		this.title.setWidth(width);
		this.scroller.setSize(width - this.padding * 2, height - this.headerHeight - 15);
	}

	/**
	 * One line per entry, in the log's order, kept by entry id, then the
	 * newest line in view: the scroll container settles at its end after the
	 * layout the new lines cause.
	 */
	private syncEntries(): void {
		this.entryList.reconcileChildren(this.combatLog.entries, {
			key: (entry) => entry.id,
			create: (entry) => new Text(this.getPrefixForEntry(entry) + entry.message, {
				height: this.entryHeight,
				style: {
					fontSize: this.fontSize,
					color: this.getColorForEntry(entry),
					textAlign: 'left',
					whiteSpace: 'nowrap',
					textOverflow: 'ellipsis',
				},
			}),
		});
		this.scroller.scrollToBottom();
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
}
