/**
 * Models closed for good by whatever owns them, each with the error that
 * says why. A campaign that's over closes its driver records and its convoy,
 * which are models of their own (`Campaign.end`). Kept apart from both
 * sides, so a mechanics model can refuse without knowing what closed it.
 */
const closed = new WeakMap<object, (action: string) => Error>();

/** Closes these models: from now on `refuseIfClosed` throws `refusal(action)` for each. */
export function closeModels({ models, refusal }: { models: readonly object[]; refusal: (action: string) => Error }): void {
	models.forEach(model => closed.set(model, refusal));
}

/** Throws, before `action` changes anything, when the model has been closed. */
export function refuseIfClosed({ model, action }: { model: object; action: string }): void {
	const refusal = closed.get(model);
	if (refusal !== undefined) throw refusal(action);
}
