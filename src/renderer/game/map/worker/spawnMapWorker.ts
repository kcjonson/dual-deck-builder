/**
 * Starts a generation worker. webpack 5 sees `new Worker(new URL(...,
 * import.meta.url))` and bundles mapWorker.ts and what it imports into a
 * chunk of its own, loaded beside the page's bundle in the web build and
 * from file:// in the packaged Electron renderer alike.
 *
 * tsconfig compiles to CommonJS, where TypeScript rejects `import.meta` but
 * emits it untouched, and webpack resolves it at build time. Jest runs that
 * CommonJS as it is, so jest.config.js maps this module to a stub that
 * spawns nothing, and the client runs in-process there.
 */
export function spawnMapWorker(): Worker | null {
	// @ts-expect-error TS1343: import.meta under module commonjs, which webpack resolves at build time
	return new Worker(new URL('./mapWorker.ts', import.meta.url), { name: 'map-generation' });
}
