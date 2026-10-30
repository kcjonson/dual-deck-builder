/**
 * R5.20's resident texture set: which texture sits on which unit, and the one
 * condition under which a texture can split a GPU submission.
 *
 * A fixed set of resident textures (the font-role atlases, the icon atlas, the
 * UI art atlas) is bound to fixed units for the whole frame, and a draw selects
 * among them by slot index. The remaining units are dynamic: a draw that needs
 * a texture outside the resident set takes a free one, and only when none is
 * free does the submission split (`textureSlotsExhausted`, R13.13). Consecutive
 * draws that use different resident textures never split, which is the whole
 * point: a list row of icon, body label and mono value is one GPU draw.
 *
 * No GL here. A texture is an opaque key compared by identity, so the same set
 * works for a `TextureHandle`, a font atlas object, or a test's plain object,
 * and a linear scan over at most sixteen units needs no map and allocates
 * nothing per draw.
 */

export type TextureKey = object;

export interface ResidentTextureSetOptions {
	/** Texture units the backend's shader can sample; WebGL2 guarantees sixteen. */
	units: number;
	/** Bound to units 0..n-1, in this order, for the whole frame. */
	resident?: readonly TextureKey[];
}

export class ResidentTextureSet {
	private readonly slots: (TextureKey | null)[];
	private residentCount = 0;

	constructor({ units, resident = [] }: ResidentTextureSetOptions) {
		if (!Number.isInteger(units) || units < 1) {
			throw new Error(`ResidentTextureSet: units must be a positive integer, got ${units}`);
		}
		this.slots = new Array<TextureKey | null>(units).fill(null);
		this.resident = resident;
	}

	get unitCount(): number {
		return this.slots.length;
	}

	get residentUnits(): number {
		return this.residentCount;
	}

	get dynamicUnits(): number {
		return this.slots.length - this.residentCount;
	}

	/** What each unit holds right now, resident units first. */
	get bindings(): readonly (TextureKey | null)[] {
		return this.slots;
	}

	get resident(): readonly TextureKey[] {
		return this.slots.slice(0, this.residentCount) as TextureKey[];
	}

	/**
	 * Replaces the resident set, which happens between frames when an atlas
	 * loads (R2.17: never inside a flush). Dynamic bindings are dropped with it.
	 */
	set resident(resident: readonly TextureKey[]) {
		if (resident.length > this.slots.length) {
			throw new Error(
				`ResidentTextureSet: ${resident.length} resident textures do not fit in ${this.slots.length} units`,
			);
		}
		if (new Set(resident).size !== resident.length) {
			throw new Error('ResidentTextureSet: a texture is listed as resident twice');
		}
		this.slots.fill(null);
		for (let index = 0; index < resident.length; index++) this.slots[index] = resident[index];
		this.residentCount = resident.length;
	}

	isResident(texture: TextureKey): boolean {
		for (let index = 0; index < this.residentCount; index++) {
			if (this.slots[index] === texture) return true;
		}
		return false;
	}

	/** The unit `texture` is on, resident or dynamic, or -1 when it is on none. */
	slotOf(texture: TextureKey): number {
		for (let index = 0; index < this.slots.length; index++) {
			if (this.slots[index] === texture) return index;
		}
		return -1;
	}

	get hasFreeUnit(): boolean {
		for (let index = this.residentCount; index < this.slots.length; index++) {
			if (this.slots[index] === null) return true;
		}
		return false;
	}

	/**
	 * Puts a non-resident texture on the lowest free dynamic unit and returns
	 * it, or -1 when every dynamic unit is taken. The caller splits and calls
	 * `releaseDynamic` before trying again; this class never evicts on its own,
	 * because only the caller knows whether a draw is still open on the unit.
	 */
	bind(texture: TextureKey): number {
		const existing = this.slotOf(texture);
		if (existing !== -1) return existing;
		for (let index = this.residentCount; index < this.slots.length; index++) {
			if (this.slots[index] === null) {
				this.slots[index] = texture;
				return index;
			}
		}
		return -1;
	}

	/** Frees every dynamic unit. Resident units are untouched (R5.20). */
	releaseDynamic(): void {
		for (let index = this.residentCount; index < this.slots.length; index++) this.slots[index] = null;
	}
}
