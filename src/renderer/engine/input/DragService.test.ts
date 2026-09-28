/**
 * @jest-environment jsdom
 */
import { Component, ComponentOptions } from '../components/Component';
import type { MountContext } from '../components/MountContext';
import { createTestContext } from '../components/testing';
import { injectInput } from '../debug/inputInjection';
import type { PlatformInput } from './Dispatcher';
import { dragThreshold } from './DragService';
import type { AnyUiEvent, PointerType } from './events';
import { NO_MODIFIERS } from './events';
import { PointerAdapter } from './PointerAdapter';

/**
 * Chapter 9.11's drag tests (R9.12), driven through the dispatcher's queue
 * as the adapter and the injection hook feed it: nothing here calls a
 * component's handler or the service's hooks directly.
 */

const log: string[] = [];

class Probe extends Component {
	/** Calls `accept()` when a drag event of this type passes through. */
	public accepts: 'dragenter' | 'dragover' | null = null;
	public dragOnDown = false;
	public threshold: number | undefined;
	public lastEnd: { dropped: boolean; dropTarget: string | null } | null = null;
	public dropActiveChanges: boolean[] = [];

	constructor(options: ComponentOptions) {
		super(options);
	}

	public handleEvent(event: AnyUiEvent): void {
		super.handleEvent(event);
		if (event.currentTarget === this) log.push(`${event.type}:${this.id}`);
		if (event.type === 'pointerdown' && this.dragOnDown) {
			context.drag.start({ event, source: this, data: { card: this.id }, threshold: this.threshold });
		}
		if ((event.type === 'dragenter' || event.type === 'dragover') && event.type === this.accepts) event.accept();
		if (event.type === 'dragend' && event.currentTarget === this) {
			this.lastEnd = { dropped: event.dropped, dropTarget: event.dropTarget?.id ?? null };
		}
	}

	protected onDropActiveChange(active: boolean): void {
		this.dropActiveChanges.push(active);
	}
}

class Container extends Probe {
	protected get defaultPointerEvents(): 'passthrough' {
		return 'passthrough';
	}
}

let context: MountContext;

beforeEach(() => {
	log.length = 0;
	context = createTestContext();
});

function pointer(phase: 'down' | 'move' | 'up' | 'cancel', x: number, y: number, pointerType: PointerType = 'mouse'): PlatformInput {
	return {
		kind: 'pointer',
		phase,
		x,
		y,
		pointerId: 1,
		pointerType,
		isPrimary: true,
		button: phase === 'move' ? -1 : 0,
		buttons: phase === 'down' || phase === 'move' ? 1 : 0,
		pressure: phase === 'up' ? 0 : 0.5,
		modifiers: NO_MODIFIERS,
	};
}

function send(...inputs: PlatformInput[]): void {
	for (const input of inputs) {
		context.dispatcher.enqueue(input);
		context.dispatcher.dispatchPending();
		context.clock.advance(1);
	}
}

function only(...types: string[]): string[] {
	return log.filter((entry) => types.some((type) => entry.startsWith(`${type}:`)));
}

const DRAG_TYPES = ['dragenter', 'dragover', 'dragleave', 'drop', 'dragend'];

/**
 * A 600 by 400 table: a card at 10,10 (100 by 140) and two enemies on the
 * right, the first with a portrait child so bubbling shows.
 */
function table(): { root: Container; card: Probe; enemy: Probe; portrait: Probe; other: Probe } {
	const root = new Container({ id: 'root', width: 600, height: 400 });
	const card = new Probe({ id: 'card', x: 10, y: 10, width: 100, height: 140 });
	card.dragOnDown = true;
	const enemy = new Probe({ id: 'enemy', x: 300, y: 10, width: 100, height: 100 });
	const portrait = new Probe({ id: 'portrait', x: 10, y: 10, width: 40, height: 40 });
	enemy.addChild(portrait);
	const other = new Probe({ id: 'other', x: 300, y: 200, width: 100, height: 100 });
	root.addChild(card);
	root.addChild(enemy);
	root.addChild(other);
	root.mount(context);
	return { root, card, enemy, portrait, other };
}

describe('threshold (R9.12a)', () => {
	it('keeps a press under the threshold a click, with no drag events', () => {
		const { card } = table();
		const threshold = dragThreshold('mouse');
		send(pointer('down', 50, 50), pointer('move', 50 + threshold, 50), pointer('up', 50 + threshold, 50));

		expect(only('click')).toEqual(['click:card', 'click:root']);
		expect(only(...DRAG_TYPES)).toEqual([]);
		expect(card.lastEnd).toBeNull();
		expect(context.drag.isDragging).toBe(false);
	});

	it('goes active one pixel past the mouse token and then never clicks', () => {
		table();
		send(pointer('down', 50, 50), pointer('move', 50 + dragThreshold('mouse') + 1, 50));
		expect(context.drag.isDragging).toBe(true);

		send(pointer('up', 50, 50));
		expect(only('click')).toEqual([]);
		expect(context.drag.isDragging).toBe(false);
	});

	it('uses the wider touch token for a finger', () => {
		table();
		expect(dragThreshold('touch')).toBeGreaterThan(dragThreshold('mouse'));
		send(pointer('down', 50, 50, 'touch'), pointer('move', 50 + dragThreshold('mouse') + 1, 50, 'touch'));
		expect(context.drag.isDragging).toBe(false);
		send(pointer('move', 50 + dragThreshold('touch') + 1, 50, 'touch'));
		expect(context.drag.isDragging).toBe(true);
	});

	it('honours a threshold given to start', () => {
		const { card } = table();
		card.threshold = 30;
		send(pointer('down', 50, 50), pointer('move', 70, 50));
		expect(context.drag.isDragging).toBe(false);
		send(pointer('move', 90, 50));
		expect(context.drag.isDragging).toBe(true);
	});

	it('refuses a second drag while one is in progress', () => {
		const { card } = table();
		send(pointer('down', 50, 50));
		const event = { type: 'pointerdown', pointerId: 2, pointerType: 'mouse', screen: { x: 0, y: 0 } };
		expect(context.drag.start({ event: event as never, source: card, data: null })).toBe(false);
	});
});

describe('ghost and targeting (R9.12b)', () => {
	it('promotes the source to the drag layer, out of hit testing, following the pointer with the press offset', () => {
		const { card } = table();
		send(pointer('down', 50, 50), pointer('move', 80, 90));

		expect(card.layer).toBe('drag');
		expect(card.pointerEvents).toBe('none');
		expect(card.transform.translate).toEqual([30, 40]);
		expect(card.screenBounds).toEqual({ x: 40, y: 50, width: 100, height: 140 });
	});

	it('moves a ghost under a scaled parent by the pointer travel in that parent', () => {
		const root = new Container({ id: 'root', width: 600, height: 400, transform: { scale: 2, origin: [0, 0] } });
		const card = new Probe({ id: 'card', x: 10, y: 10, width: 50, height: 50 });
		card.dragOnDown = true;
		root.addChild(card);
		root.mount(context);

		send(pointer('down', 40, 40), pointer('move', 100, 60));

		expect(card.transform.translate).toEqual([30, 10]);
	});

	it('puts the ghost back when the drag ends', () => {
		const { card } = table();
		card.layer = 'raised';
		card.transform = { rotate: 0.1 };
		send(pointer('down', 50, 50), pointer('move', 200, 200), pointer('up', 200, 200));

		expect(card.layer).toBe('raised');
		expect(card.pointerEvents).toBe('auto');
		expect(card.transform.rotate).toBe(0.1);
		expect(card.transform.translate).toEqual([0, 0]);
	});

	it('delivers enter, over on each move, and leave to what is under the pointer, bubbling', () => {
		table();
		send(pointer('down', 50, 50), pointer('move', 320, 30), pointer('move', 325, 30), pointer('move', 380, 80));

		expect(only(...DRAG_TYPES)).toEqual([
			'dragenter:portrait',
			'dragenter:enemy',
			'dragenter:root',
			'dragover:portrait',
			'dragover:enemy',
			'dragover:root',
			'dragover:portrait',
			'dragover:enemy',
			'dragover:root',
			'dragleave:portrait',
			'dragleave:enemy',
			'dragleave:root',
			'dragenter:enemy',
			'dragenter:root',
			'dragover:enemy',
			'dragover:root',
		]);
	});

	// 9.11: capture suppresses the enemy's pointerenter, which is why drag
	// events exist at all.
	it('reaches the enemy under a captured drag that hears no pointerenter', () => {
		table();
		send(pointer('down', 50, 50), pointer('move', 380, 80));

		expect(only('pointerenter')).not.toContain('pointerenter:enemy');
		expect(only('dragenter')).toContain('dragenter:enemy');
	});

	it('hands every target the data given to start', () => {
		const { enemy } = table();
		const seen: unknown[] = [];
		enemy.onDragEnter = (event) => seen.push(event.data);
		send(pointer('down', 50, 50), pointer('move', 380, 80));

		expect(seen).toEqual([{ card: 'card' }]);
	});

	it('re-targets under a still pointer when the target moves away', () => {
		const { enemy } = table();
		send(pointer('down', 50, 50), pointer('move', 380, 80));
		log.length = 0;

		enemy.x = 500;
		enemy.invalidateLayout();
		send();
		context.dispatcher.dispatchPending();

		// The root is passthrough, so nothing is under the pointer now.
		expect(only(...DRAG_TYPES)).toEqual(['dragleave:enemy', 'dragleave:root']);
		expect(context.drag.current?.target).toBeNull();
	});
});

describe('accept and drop (R9.12c)', () => {
	it('drops on an accepting target: dropActive while over, drop, then dragend dropped', () => {
		const { card, enemy } = table();
		enemy.accepts = 'dragenter';
		send(pointer('down', 50, 50), pointer('move', 380, 80));

		expect(enemy.dropActive).toBe(true);
		expect(context.drag.canDrop).toBe(true);
		expect(context.drag.current?.acceptor).toBe(enemy);

		log.length = 0;
		send(pointer('up', 380, 80));

		expect(only(...DRAG_TYPES, 'click')).toEqual(['drop:enemy', 'drop:root', 'dragend:card', 'dragend:root']);
		expect(card.lastEnd).toEqual({ dropped: true, dropTarget: 'enemy' });
		expect(enemy.dropActive).toBe(false);
		expect(enemy.dropActiveChanges).toEqual([true, false]);
	});

	it('accepts from dragover as well as dragenter', () => {
		const { enemy } = table();
		enemy.accepts = 'dragover';
		send(pointer('down', 50, 50), pointer('move', 380, 80));

		expect(enemy.dropActive).toBe(true);
	});

	it('lets an ancestor accept for a child: the drop lands on the child and bubbles to it', () => {
		const { card, enemy } = table();
		enemy.accepts = 'dragenter';
		send(pointer('down', 50, 50), pointer('move', 320, 30));
		expect(enemy.dropActive).toBe(true);

		// Portrait to the enemy's own area: a new target, the same acceptor, no flicker.
		send(pointer('move', 380, 80));
		expect(enemy.dropActiveChanges).toEqual([true]);

		send(pointer('move', 320, 30));
		log.length = 0;
		send(pointer('up', 320, 30));

		expect(only('drop')).toEqual(['drop:portrait', 'drop:enemy', 'drop:root']);
		expect(card.lastEnd).toEqual({ dropped: true, dropTarget: 'enemy' });
	});

	it('moves dropActive from one target to the next', () => {
		const { enemy, other } = table();
		enemy.accepts = 'dragenter';
		other.accepts = 'dragenter';
		send(pointer('down', 50, 50), pointer('move', 380, 80), pointer('move', 380, 280));

		expect(enemy.dropActive).toBe(false);
		expect(other.dropActive).toBe(true);
	});

	it('ends with dragleave and dragend not dropped over a target that did not accept', () => {
		const { card } = table();
		send(pointer('down', 50, 50), pointer('move', 380, 80));
		expect(context.drag.canDrop).toBe(false);
		log.length = 0;
		send(pointer('up', 380, 80));

		expect(only(...DRAG_TYPES)).toEqual(['dragleave:enemy', 'dragleave:root', 'dragend:card', 'dragend:root']);
		expect(card.lastEnd).toEqual({ dropped: false, dropTarget: null });
	});

	it('targets where the release lands when it differs from the last move', () => {
		const { card, other } = table();
		other.accepts = 'dragenter';
		send(pointer('down', 50, 50), pointer('move', 380, 80), pointer('up', 380, 280));

		expect(card.lastEnd).toEqual({ dropped: true, dropTarget: 'other' });
	});
});

describe('cancellation (R9.12d)', () => {
	it('ends with dragend not dropped on pointercancel, and nothing drops', () => {
		const { card, enemy } = table();
		enemy.accepts = 'dragenter';
		send(pointer('down', 50, 50), pointer('move', 380, 80), pointer('cancel', 380, 80));

		expect(only('drop', 'click')).toEqual([]);
		expect(card.lastEnd).toEqual({ dropped: false, dropTarget: null });
		expect(enemy.dropActive).toBe(false);
		expect(card.layer).toBeNull();
		expect(context.drag.isDragging).toBe(false);
	});

	it('ends on window blur', () => {
		const { card } = table();
		send(pointer('down', 50, 50), pointer('move', 380, 80), { kind: 'blur' });

		expect(card.lastEnd).toEqual({ dropped: false, dropTarget: null });
	});

	it('ends when the source releases its capture', () => {
		const { card } = table();
		send(pointer('down', 50, 50), pointer('move', 380, 80));
		context.dispatcher.releasePointer(1);

		expect(card.lastEnd).toEqual({ dropped: false, dropTarget: null });
		expect(context.drag.isDragging).toBe(false);
	});

	it('ends when the source unmounts, with pointercancel first', () => {
		const { root, card } = table();
		send(pointer('down', 50, 50), pointer('move', 380, 80));
		log.length = 0;
		root.removeChild(card);

		expect(log.filter((entry) => entry.endsWith(':card'))).toEqual(['pointercancel:card', 'dragend:card', 'lostpointercapture:card']);
		expect(context.drag.isDragging).toBe(false);
	});

	it('forgets a target that unmounts, without events to it, and targets on', () => {
		const { card, root, enemy, other } = table();
		enemy.accepts = 'dragenter';
		other.accepts = 'dragenter';
		send(pointer('down', 50, 50), pointer('move', 380, 80));
		log.length = 0;
		root.removeChild(enemy);

		expect(context.drag.canDrop).toBe(false);
		expect(context.drag.current?.target).toBeNull();
		expect(only(...DRAG_TYPES)).toEqual([]);

		send(pointer('move', 380, 280), pointer('up', 380, 280));
		expect(card.lastEnd).toEqual({ dropped: true, dropTarget: 'other' });
	});

	it('cancel() ends the drag, and the release that follows neither drops nor clicks', () => {
		const { card, enemy } = table();
		enemy.accepts = 'dragenter';
		send(pointer('down', 50, 50), pointer('move', 380, 80));
		context.drag.cancel();

		expect(card.lastEnd).toEqual({ dropped: false, dropTarget: null });
		expect(enemy.dropActive).toBe(false);
		send(pointer('move', 50, 50), pointer('up', 50, 50));
		expect(only('drop', 'click')).toEqual([]);
	});

	it('cancel() on a candidate still under the threshold stops it clicking', () => {
		const { card } = table();
		send(pointer('down', 50, 50));
		context.drag.cancel();
		send(pointer('up', 50, 50));

		expect(only('click')).toEqual([]);
		expect(card.lastEnd).toBeNull();
	});
});

describe('isDragging for tooltips (R9.12e)', () => {
	it('reports the active drag and tells listeners when it starts and ends', () => {
		table();
		const changes: boolean[] = [];
		const unsubscribe = context.drag.onDraggingChange((dragging) => changes.push(dragging));

		send(pointer('down', 50, 50));
		expect(context.drag.isDragging).toBe(false);
		expect(context.drag.current).toBeNull();

		send(pointer('move', 380, 80));
		expect(context.drag.isDragging).toBe(true);
		expect(context.drag.current?.target?.id).toBe('enemy');

		send(pointer('up', 380, 80));
		unsubscribe();
		send(pointer('down', 50, 50), pointer('move', 380, 80), pointer('up', 380, 80));

		expect(changes).toEqual([true, false]);
	});
});

describe('through the injection hook (R13.35)', () => {
	it('drags a card onto an enemy with down, move, up', () => {
		const canvas = document.createElement('canvas');
		document.body.appendChild(canvas);
		const adapter = new PointerAdapter({ dispatcher: context.dispatcher });
		adapter.attach(canvas);
		try {
			const { card, enemy } = table();
			enemy.accepts = 'dragenter';
			const target = { canvas, dispatcher: context.dispatcher };
			for (const command of ['down,50,50', 'move,200,60', 'move,380,80', 'up,380,80']) {
				expect(injectInput(target, [command]).ok).toBe(true);
				context.dispatcher.dispatchPending();
			}

			expect(card.lastEnd).toEqual({ dropped: true, dropTarget: 'enemy' });
			expect(only('click')).toEqual([]);
		} finally {
			adapter.detach();
			canvas.remove();
		}
	});
});
