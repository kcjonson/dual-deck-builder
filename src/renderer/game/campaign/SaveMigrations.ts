import { readInteger } from './JsonReader';

/**
 * The campaign save's schema version. Bump it whenever the JSON `toJSON`
 * writes changes shape, and add the step that upgrades a save from the
 * version before.
 */
export const CAMPAIGN_SCHEMA_VERSION = 1;

/** Upgrades a parsed save from one schema version to the next. */
export type SaveMigration = (save: Readonly<Record<string, unknown>>) => Record<string, unknown>;

/**
 * A save written by a newer build than this one. It isn't damaged, just
 * unreadable here, so whoever catches this keeps it for the build that
 * wrote it.
 */
export class NewerSaveError extends RangeError {
	/** The save's schema version. */
	public readonly version: number;
	/** The newest version this build reads. */
	public readonly readable: number;

	constructor({ path, version, readable }: { path: string; version: number; readable: number }) {
		super(`${path}.schemaVersion is ${version}, newer than this build reads (${readable})`);
		this.name = 'NewerSaveError';
		this.version = version;
		this.readable = readable;
	}
}

/** The steps, keyed by the version each one upgrades from. Empty while 1 is the only version. */
export const CAMPAIGN_MIGRATIONS: Readonly<Record<number, SaveMigration>> = {};

export interface MigrateOptions {
	save: Readonly<Record<string, unknown>>;
	/** Where the save sits, for error messages. */
	path?: string;
	to?: number;
	migrations?: Readonly<Record<number, SaveMigration>>;
}

/**
 * A parsed save brought up to schema version `to` one step at a time, each
 * step's result stamped with the version it reached. Throws on a version
 * that isn't a positive integer, one newer than `to` (a `NewerSaveError`),
 * or one with a missing step between it and `to`.
 */
export function migrateSave({ save, path = 'Campaign', to = CAMPAIGN_SCHEMA_VERSION, migrations = CAMPAIGN_MIGRATIONS }: MigrateOptions): Readonly<Record<string, unknown>> {
	const from = readInteger(save.schemaVersion, `${path}.schemaVersion`, { min: 1 });
	if (from > to) throw new NewerSaveError({ path, version: from, readable: to });
	let migrated = save;
	for (let version = from; version < to; version += 1) {
		const migrate = migrations[version];
		if (!migrate) throw new RangeError(`${path}.schemaVersion ${from} can't be read: nothing upgrades a version ${version} save`);
		migrated = { ...migrate(migrated), schemaVersion: version + 1 };
	}
	return migrated;
}
