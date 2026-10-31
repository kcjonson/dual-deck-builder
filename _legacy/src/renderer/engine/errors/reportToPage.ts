/**
 * Hands an error the engine caught, so it could keep going, to the page the
 * way the browser hands it an uncaught one: the console logs it and the
 * window's `error` listeners, the error overlay among them (DDB-538), hear
 * it. The caller still logs where it was caught. A no-op where the platform
 * has no `reportError` (Node, so Jest).
 */
export function reportToPage(error: unknown): void {
	if (typeof globalThis.reportError === 'function') globalThis.reportError(error);
}
