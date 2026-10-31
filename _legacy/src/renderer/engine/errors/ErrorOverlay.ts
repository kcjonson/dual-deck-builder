import {
	ErrorReport,
	ErrorSource,
	SHOWN_STACK_LINES,
	describeError,
	describeErrorEvent,
	formatDetails,
	sameFailure,
	sourceLabel,
} from './errorReport';

/** Distinct failures kept for Copy details; past it they are only counted. */
const MAX_REPORTS = 20;

export const ERROR_OVERLAY_ID = 'error-overlay';

const COLORS = {
	backdrop: 'rgba(8, 6, 4, 0.72)',
	panel: '#211d19',
	text: '#f1eadf',
	dim: '#b5ab9d',
	accent: '#e0574f',
	button: '#3a332c',
	buttonBorder: '#5a5047',
};

export interface ErrorOverlayOptions {
	/** The build stamp the report names, e.g. "build 142 - 2f8d7a7". */
	build: string;
	/** What a playtester should do with it. */
	hint: string;
}

/**
 * A DOM panel over the canvas that says the game failed and how, for a
 * playtester who never opens the console. It is plain DOM styled through the
 * CSSOM, so it shows when WebGL is what failed, and a Content Security Policy
 * that forbids inline styles still lets it draw.
 *
 * The first failure since the panel last closed is the one shown, since the
 * rest are usually its consequences; later ones are counted, and Copy details
 * carries all of them. Nothing here swallows a failure: the window listeners
 * leave the default alone, so the browser still logs the error to the console
 * (and the boot smoke still fails on it), and `report` is for failures the
 * caller has already logged.
 */
export class ErrorOverlay {
	private readonly build: string;
	private readonly hint: string;
	private readonly reports: ErrorReport[] = [];
	/** Failures past MAX_REPORTS. */
	private dropped = 0;
	private root: HTMLElement | null = null;
	private label: HTMLElement | null = null;
	private more: HTMLElement | null = null;

	constructor({ build, hint }: ErrorOverlayOptions) {
		this.build = build;
		this.hint = hint;
	}

	/** Shows uncaught errors and unhandled rejections; returns the function that stops listening. */
	install(): () => void {
		window.addEventListener('error', this.handleError);
		window.addEventListener('unhandledrejection', this.handleRejection);
		return () => {
			window.removeEventListener('error', this.handleError);
			window.removeEventListener('unhandledrejection', this.handleRejection);
		};
	}

	/** Shows a failure the caller caught, e.g. a startup that threw. */
	report({ error, source }: { error: unknown; source: ErrorSource }): void {
		this.add(describeError({ error, source, base: pageBase() }));
	}

	/** Whether the panel is up. */
	get visible(): boolean {
		return this.root !== null;
	}

	private handleError = (event: ErrorEvent): void => {
		this.add(describeErrorEvent({ event, base: pageBase() }));
	};

	private handleRejection = (event: PromiseRejectionEvent): void => {
		this.add(describeError({ error: event.reason, source: 'rejection', base: pageBase() }));
	};

	private add(report: ErrorReport): void {
		// The overlay must never be what throws next: a failure drawing it is
		// logged and the original error still stands in the console.
		try {
			const repeat = this.reports.find((existing) => sameFailure(existing, report));
			if (repeat) repeat.count += 1;
			else if (this.reports.length < MAX_REPORTS) this.reports.push(report);
			else this.dropped += 1;
			if (!this.root) this.open();
			this.updateCounts();
		} catch (error) {
			console.error('ErrorOverlay: could not show the error', error);
		}
	}

	private open(): void {
		const shown = this.reports[0];
		const root = element({ tag: 'div', style: {
			position: 'fixed',
			inset: '0',
			zIndex: '1000',
			display: 'flex',
			alignItems: 'center',
			justifyContent: 'center',
			padding: '16px',
			boxSizing: 'border-box',
			background: COLORS.backdrop,
		} });
		root.id = ERROR_OVERLAY_ID;
		// The game hears keys on the window and context menus on the document;
		// neither should act on what was meant for the panel.
		for (const type of ['keydown', 'keyup', 'contextmenu']) root.addEventListener(type, (event) => event.stopPropagation());

		const panel = element({ tag: 'div', style: {
			width: '100%',
			maxWidth: '760px',
			maxHeight: '100%',
			overflow: 'auto',
			boxSizing: 'border-box',
			padding: '20px 24px',
			borderTop: `4px solid ${COLORS.accent}`,
			borderRadius: '6px',
			background: COLORS.panel,
			color: COLORS.text,
			font: '15px/1.45 system-ui, -apple-system, "Segoe UI", Arial, sans-serif',
			boxShadow: '0 12px 40px rgba(0, 0, 0, 0.6)',
			userSelect: 'text',
		} });
		panel.setAttribute('role', 'alertdialog');
		panel.setAttribute('aria-modal', 'true');
		panel.setAttribute('aria-labelledby', `${ERROR_OVERLAY_ID}-title`);
		panel.setAttribute('aria-describedby', `${ERROR_OVERLAY_ID}-message`);

		this.label = element({ tag: 'div', style: { color: COLORS.accent, fontSize: '12px', fontWeight: '600', letterSpacing: '0.06em', textTransform: 'uppercase' } });
		const title = element({ tag: 'div', text: 'Something went wrong', style: { margin: '4px 0 12px', fontSize: '22px', fontWeight: '700' } });
		title.id = `${ERROR_OVERLAY_ID}-title`;
		const message = element({ tag: 'div', text: shown.message, style: { whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', fontWeight: '600' } });
		message.id = `${ERROR_OVERLAY_ID}-message`;
		panel.append(this.label, title, message);

		if (shown.stack.length > 0) {
			const frames = shown.stack.slice(0, SHOWN_STACK_LINES);
			if (shown.stack.length > frames.length) frames.push('...');
			panel.append(element({ tag: 'pre', text: frames.join('\n'), style: {
				margin: '10px 0 0',
				padding: '10px 12px',
				overflowX: 'auto',
				borderRadius: '4px',
				background: 'rgba(0, 0, 0, 0.35)',
				color: COLORS.dim,
				font: '12px/1.5 ui-monospace, Consolas, Menlo, monospace',
				whiteSpace: 'pre',
			} }));
		}

		this.more = element({ tag: 'div', style: { marginTop: '10px', color: COLORS.dim, fontSize: '13px' } });
		const hint = element({ tag: 'p', text: this.hint, style: { margin: '16px 0 4px' } });
		const build = element({ tag: 'div', text: this.build, style: { color: COLORS.dim, font: '12px ui-monospace, Consolas, Menlo, monospace' } });

		const copy = button({ text: 'Copy details', onClick: () => this.copyDetails(copy) });
		const reload = button({ text: 'Reload', onClick: () => window.location.reload() });
		const close = button({ text: 'Close', onClick: () => this.close() });
		const actions = element({ tag: 'div', style: { display: 'flex', flexWrap: 'wrap', gap: '8px', marginTop: '16px' } });
		actions.append(copy, reload, close);

		panel.append(this.more, hint, build, actions);
		root.append(panel);
		document.body.append(root);
		this.root = root;
		// Not Reload: an Enter meant for the game would lose the report.
		copy.focus();
	}

	private updateCounts(): void {
		const [shown, ...rest] = this.reports;
		if (this.label) this.label.textContent = shown.count > 1 ? `${sourceLabel(shown.source)} (x${shown.count})` : sourceLabel(shown.source);
		if (!this.more) return;
		const later = rest.reduce((sum, report) => sum + report.count, 0) + this.dropped;
		this.more.textContent = later === 0
			? ''
			: `${later} more ${later === 1 ? 'error' : 'errors'} after this one; Copy details has ${this.dropped > 0 ? `the first ${MAX_REPORTS}` : 'them'}.`;
		this.more.style.display = later === 0 ? 'none' : 'block';
	}

	private close(): void {
		this.root?.remove();
		this.root = null;
		this.label = null;
		this.more = null;
		this.reports.length = 0;
		this.dropped = 0;
	}

	private copyDetails(trigger: HTMLButtonElement): void {
		const text = formatDetails({
			reports: this.reports,
			build: this.build,
			page: window.location.href,
			userAgent: navigator.userAgent,
			time: new Date().toISOString(),
		});
		const done = (copied: boolean) => {
			trigger.textContent = copied ? 'Copied' : 'Copy failed: select the text instead';
		};
		// The async clipboard needs a secure context, which a playtest served
		// over plain http is not; execCommand still works there.
		if (navigator.clipboard?.writeText) {
			navigator.clipboard.writeText(text).then(() => done(true), () => done(copyWithSelection(text)));
		} else {
			done(copyWithSelection(text));
		}
	}
}

function pageBase(): string {
	return document.baseURI.replace(/[^/]*$/, '');
}

function copyWithSelection(text: string): boolean {
	const area = document.createElement('textarea');
	area.value = text;
	Object.assign(area.style, { position: 'fixed', top: '0', left: '0', opacity: '0' });
	document.body.append(area);
	area.select();
	try {
		return document.execCommand('copy');
	} catch {
		return false;
	} finally {
		area.remove();
	}
}

function element({ tag, text, style }: { tag: string; text?: string; style: Partial<CSSStyleDeclaration> }): HTMLElement {
	const node = document.createElement(tag);
	if (text !== undefined) node.textContent = text;
	Object.assign(node.style, style);
	return node;
}

function button({ text, onClick }: { text: string; onClick: () => void }): HTMLButtonElement {
	const node = element({ tag: 'button', text, style: {
		padding: '7px 14px',
		border: `1px solid ${COLORS.buttonBorder}`,
		borderRadius: '4px',
		background: COLORS.button,
		color: COLORS.text,
		font: 'inherit',
		fontSize: '14px',
		cursor: 'pointer',
	} }) as HTMLButtonElement;
	node.type = 'button';
	node.addEventListener('click', onClick);
	return node;
}
