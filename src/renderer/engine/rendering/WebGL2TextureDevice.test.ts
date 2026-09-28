import { TextureDescription, TextureStore } from '../gpu/TextureStore';
import { WebGL2TextureDevice } from './WebGL2TextureDevice';

interface GlCall {
	name: string;
	args: unknown[];
}

/** Records every call; constants are distinct numbers derived from their names. */
function recordingGl(): { gl: WebGL2RenderingContext; calls: GlCall[]; constant: (name: string) => number } {
	const calls: GlCall[] = [];
	const constants = new Map<string, number>();
	const constant = (name: string): number => {
		let value = constants.get(name);
		if (value === undefined) {
			value = 0x2000 + constants.size;
			constants.set(name, value);
		}
		return value;
	};
	let objects = 0;
	const gl = new Proxy({}, {
		get(_target, property: string) {
			if (/^[A-Z0-9_]+$/.test(property)) return constant(property);
			return (...args: unknown[]) => {
				calls.push({ name: property, args });
				return property === 'createTexture' ? { texture: ++objects } : undefined;
			};
		},
	});
	return { gl: gl as WebGL2RenderingContext, calls, constant };
}

const COLOR: TextureDescription = { width: 4, height: 2, content: 'color', label: 'art' };
const MASK: TextureDescription = { width: 4, height: 2, content: 'mask', label: 'atlas' };
/** Stands in for a canvas or an image: anything that is not a `Uint8Array`. */
const DOM_SOURCE = { width: 4, height: 2 } as unknown as TexImageSource;

describe('WebGL2TextureDevice (R15.18, R15.19)', () => {
	it('allocates immutable storage and never re-specifies it', () => {
		const { gl, calls, constant } = recordingGl();
		const device = new WebGL2TextureDevice({ gl });
		const texture = device.allocate(COLOR);
		device.upload(texture, COLOR, new Uint8Array(4 * 2 * 4));

		const storage = calls.filter((call) => call.name === 'texStorage2D');
		expect(storage).toEqual([{ name: 'texStorage2D', args: [constant('TEXTURE_2D'), 1, constant('RGBA8'), 4, 2] }]);
		expect(calls.some((call) => call.name === 'texImage2D')).toBe(false);
		const [sub] = calls.filter((call) => call.name === 'texSubImage2D');
		expect(sub.args.slice(0, 5)).toEqual([constant('TEXTURE_2D'), 0, 0, 0, 4]);
	});

	it('binds on the upload unit, which no draw samples, and leaves it unbound', () => {
		const { gl, calls, constant } = recordingGl();
		const device = new WebGL2TextureDevice({ gl });
		device.upload(device.allocate(COLOR), COLOR, DOM_SOURCE);

		const units = calls.filter((call) => call.name === 'activeTexture').map((call) => call.args[0]);
		expect(new Set(units)).toEqual(new Set([constant('TEXTURE0') + 31]));
		const binds = calls.filter((call) => call.name === 'bindTexture');
		expect(binds.at(-1)?.args[1]).toBeNull();
	});

	it('turns colour management off, and premultiplies a colour DOM source but not a mask', () => {
		const { gl, calls, constant } = recordingGl();
		const device = new WebGL2TextureDevice({ gl });
		const premultiply = () => calls
			.filter((call) => call.name === 'pixelStorei' && call.args[0] === constant('UNPACK_PREMULTIPLY_ALPHA_WEBGL'))
			.map((call) => call.args[1]);

		device.upload(device.allocate(COLOR), COLOR, DOM_SOURCE);
		device.upload(device.allocate(MASK), MASK, DOM_SOURCE);
		// Texels in a `Uint8Array` are premultiplied already (R5.18).
		device.upload(device.allocate(COLOR), COLOR, new Uint8Array(4 * 2 * 4));
		expect(premultiply()).toEqual([true, false, false]);

		const conversion = calls.filter((call) => call.name === 'pixelStorei' && call.args[0] === constant('UNPACK_COLORSPACE_CONVERSION_WEBGL'));
		expect(conversion.map((call) => call.args[1])).toEqual([constant('NONE'), constant('NONE'), constant('NONE')]);
	});

	it('deletes a texture the store frees', () => {
		const { gl, calls } = recordingGl();
		const store = new TextureStore({ device: new WebGL2TextureDevice({ gl }) });
		const handle = store.create({ width: 2, height: 2, label: 'x' });
		const native = store.native(handle);
		store.release(handle);
		expect(calls.filter((call) => call.name === 'deleteTexture').map((call) => call.args[0])).toEqual([native]);
	});
});
