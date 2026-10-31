// Stands in for spawnMapWorker, whose `new URL(..., import.meta.url)` only webpack can resolve: no worker, so the client runs in-process.
module.exports = { spawnMapWorker: () => null };
