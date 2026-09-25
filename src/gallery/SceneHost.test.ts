import { SceneHost } from './SceneHost';
import type { GalleryScene } from './registry';
import { Layer } from '../renderer/engine/components/Layer';
import { Panel } from '../renderer/engine/ui/Panel';
import { Button } from '../renderer/engine/ui/Button';
import { Text } from '../renderer/engine/components/Text';
import { Input } from '../renderer/engine/ui/Input';
import { InputSystem } from '../renderer/engine/input/InputSystem';
import { RendererContext } from '../renderer/engine/rendering/RendererContext';
import { DrawApi, NullBackend } from '../renderer/engine/draw';

const VIEWPORT = { width: 1440, height: 882 };

/**
 * The seven per-component maps InputSystem.unregisterComponent clears. They are
 * private, so this test reaches them through a cast: a public accessor would
 * exist for this test alone, and the leak it guards against (a scene switch
 * that detaches a subtree without unmounting it) is invisible from outside.
 * InputSystem.unmount would clear them too, but it also touches window, which
 * the node test environment does not have.
 */
const REGISTRATION_MAPS = [
	'mouseOverComponents',
	'mouseOutComponents',
	'mouseDownComponents',
	'mouseUpComponents',
	'wheelComponents',
	'keyDownComponents',
	'hoveredComponents',
] as const;

function registrations(): Array<{ size: number; clear(): void }> {
	const system = InputSystem.getInstance() as unknown as Record<string, { size: number; clear(): void }>;
	return REGISTRATION_MAPS.map((key) => system[key]);
}

function registrationCount(): number {
	return registrations().reduce((total, map) => total + map.size, 0);
}

function findById(root: Layer, id: string): Layer | null {
	if (root.id === id) return root;
	for (const child of root.debugChildren) {
		const found = findById(child, id);
		if (found) return found;
	}
	return null;
}

function findByType(root: Layer, type: string): Layer | null {
	if (root.getComponentType() === type) return root;
	for (const child of root.debugChildren) {
		const found = findByType(child, type);
		if (found) return found;
	}
	return null;
}

/**
 * Stands in for a developer section: a Panel that builds interactive children
 * and only then announces how tall it turned out, which is the shape all eight
 * real sections have and the reason a registry entry cannot carry a size.
 */
function interactiveScene(name: string, { x, y, width }: { x: number; y: number; width: number }): Panel {
	const panel = new Panel({ id: `scene_${name}`, width, height: 10, scrollable: true });
	panel.setPosition(x, y);
	panel.addChild(new Button('press me', { id: `${name}_button`, width: 120, height: 40 }));
	panel.addChild(new Input('type here', { id: `${name}_input`, width: 200, height: 40 }));
	panel.addChild(new Text('unsized label', { id: `${name}_label` }));
	panel.setSize(width, 260);
	return panel;
}

/** Counts the calls SceneHost makes into the tree. */
class CountingLayer extends Layer {
	public updates = 0;
	public renders = 0;

	public update(deltaTime: number): void {
		this.updates++;
		super.update(deltaTime);
	}

	public render(): void {
		this.renders++;
		super.render();
	}
}

const interactiveScenes: GalleryScene[] = [
	{ name: 'alpha', factory: (options) => interactiveScene('alpha', options) },
	{ name: 'beta', factory: (options) => interactiveScene('beta', options) },
];

function makeHost(scenes: readonly GalleryScene[]): SceneHost {
	return new SceneHost({ scenes, viewport: () => ({ ...VIEWPORT }) });
}

beforeEach(() => {
	for (const map of registrations()) map.clear();
	InputSystem.setFocus(null);
	InputSystem.getInstance().paused = false;
});

describe('mounting', () => {
	it('mounts the named scene and nothing else', () => {
		const host = makeHost(interactiveScenes);
		expect(host.mount('beta')).toBe(true);
		expect(host.sceneName).toBe('beta');
		expect(host.root.getChildren()).toHaveLength(1);
	});

	it('rejects an unknown name and leaves the mounted scene alone', () => {
		const host = makeHost(interactiveScenes);
		host.mount('alpha');
		expect(host.mount('gamma')).toBe(false);
		expect(host.sceneName).toBe('alpha');
		expect(host.root.getChildren()).toHaveLength(1);
	});

	// The height exists only once the constructor has run, so the host reads it
	// off the constructed scene rather than off the registry entry.
	it('reports the scene extent it could not have known in advance', () => {
		const host = makeHost(interactiveScenes);
		host.mount('alpha');
		expect(host.status().content).toEqual({ width: VIEWPORT.width - 80, height: 260 });
	});

	it('has no content before a scene is mounted', () => {
		expect(makeHost(interactiveScenes).status().content).toBeNull();
	});

	// Text takes its size from Layer.layout(), which no frame ever calls, so
	// without the host's layout pass every label reports w = h = 0 to the tree
	// snapshot and the lint's zero-or-negative-size rule fires on all of them.
	it('lays the scene out so text is not reported as zero-sized', () => {
		const host = makeHost(interactiveScenes);
		host.mount('alpha');

		const label = findById(host.root, 'alpha_label');
		expect(label).not.toBeNull();
		expect(label?.getWidth()).toBeGreaterThan(0);
		expect(label?.getHeight()).toBeGreaterThan(0);
	});
});

describe('switching scenes', () => {
	// An Input registers a mouse-down and a keydown handler from its
	// constructor and a scrollable Panel registers a wheel handler, so a switch
	// that detached without unmounting would add a whole scene's worth of
	// registrations every time and keep hit-testing scenes nobody can see.
	it('does not grow the InputSystem registrations across repeated switches', () => {
		const host = makeHost(interactiveScenes);
		host.mount('alpha');
		const afterFirstMount = registrationCount();
		expect(afterFirstMount).toBeGreaterThan(0);

		for (let index = 0; index < 20; index++) {
			host.mount(index % 2 === 0 ? 'beta' : 'alpha');
			expect(registrationCount()).toBe(afterFirstMount);
		}
	});

	it('leaves nothing registered after unmounting', () => {
		const host = makeHost(interactiveScenes);
		host.mount('alpha');
		host.unmount();
		expect(registrationCount()).toBe(0);
		expect(host.sceneName).toBeNull();
		expect(host.root.getChildren()).toHaveLength(0);
	});

	it('clears focus so a switched-away input does not keep the keyboard', () => {
		const host = makeHost(interactiveScenes);
		host.mount('alpha');
		const input = findById(host.root, 'alpha_input') as Input;
		InputSystem.setFocus(input);
		expect(InputSystem.getFocus()).toBe(input);

		host.mount('beta');
		expect(InputSystem.getFocus()).toBeNull();
	});

	it('reload re-enters the scene, and does nothing when none is mounted', () => {
		const host = makeHost(interactiveScenes);
		expect(host.reload()).toBe(false);

		host.mount('alpha');
		const before = host.root.getChildren()[0];
		const registered = registrationCount();

		expect(host.reload()).toBe(true);
		expect(host.sceneName).toBe('alpha');
		expect(host.root.getChildren()[0]).not.toBe(before);
		expect(registrationCount()).toBe(registered);
	});

});

describe('resize', () => {
	function resizableHost(viewport: { width: number; height: number }): SceneHost {
		return new SceneHost({ scenes: interactiveScenes, viewport: () => ({ ...viewport }) });
	}

	it('re-enters on a real resize, because a section lays itself out from the width it was built with', () => {
		const viewport = { width: 1440, height: 882 };
		const host = resizableHost(viewport);
		host.mount('alpha');
		expect(host.status().content?.width).toBe(1360);

		viewport.width = 900;
		host.resize();
		expect(host.status().content?.width).toBe(820);
		expect(host.root.getWidth()).toBe(900);
	});

	// The browser fires resize for a zoom, a devicePixelRatio change, and on
	// some platforms a window move. Re-entering on those would swap every
	// instance a harness is holding for no reason at all.
	it('does not re-enter when the viewport did not change', () => {
		const host = resizableHost({ width: 1440, height: 882 });
		host.mount('alpha');
		const before = host.root.getChildren()[0];

		host.resize();
		host.resize();

		expect(host.root.getChildren()[0]).toBe(before);
	});

	it('re-enters when only the height changed', () => {
		const viewport = { width: 1440, height: 882 };
		const host = resizableHost(viewport);
		host.mount('alpha');
		const before = host.root.getChildren()[0];

		viewport.height = 600;
		host.resize();

		expect(host.root.getChildren()[0]).not.toBe(before);
		expect(host.root.getHeight()).toBe(600);
	});

	// R13.32 pause and R13.35 injected input both promise a still scene. A
	// remount underneath a paused harness would hand it detached components.
	it('defers a resize while paused and applies it on resume', () => {
		const viewport = { width: 1440, height: 882 };
		const host = resizableHost(viewport);
		host.mount('alpha');
		const before = host.root.getChildren()[0];

		host.paused = true;
		viewport.width = 900;
		host.resize();

		expect(host.root.getChildren()[0]).toBe(before);
		expect(host.status().content?.width).toBe(1360);

		host.paused = false;

		expect(host.root.getChildren()[0]).not.toBe(before);
		expect(host.status().content?.width).toBe(820);
	});

	it('does not re-enter on resume when the window never moved', () => {
		const host = resizableHost({ width: 1440, height: 882 });
		host.mount('alpha');
		const before = host.root.getChildren()[0];

		host.paused = true;
		host.paused = false;

		expect(host.root.getChildren()[0]).toBe(before);
	});

	it('keeps the root current when nothing is mounted', () => {
		const viewport = { width: 1440, height: 882 };
		const host = resizableHost(viewport);

		viewport.width = 640;
		host.resize();

		expect(host.root.getWidth()).toBe(640);
		expect(host.sceneName).toBeNull();
	});
});

describe('resolution', () => {
	it('reports a name the URL asked for and got', () => {
		const host = makeHost(interactiveScenes);
		expect(host.mountFromSearch('?scene=beta')).toEqual({ status: 'requested', name: 'beta' });
		expect(host.status()).toMatchObject({ scene: 'beta', requested: 'beta', resolution: 'requested' });
	});

	it('reports the default as a default rather than as a request', () => {
		const host = makeHost(interactiveScenes);
		expect(host.mountFromSearch('')).toEqual({ status: 'default', name: 'alpha' });
		expect(host.status()).toMatchObject({ scene: 'alpha', requested: null, resolution: 'default' });
	});

	// The substitution a screenshot harness has to be able to refuse: it asked
	// for one scene, it is looking at another, and only status() says so.
	it('reports a substituted scene as unknown, naming what was asked for', () => {
		const host = makeHost(interactiveScenes);
		expect(host.mountFromSearch('?scene=gamma')).toEqual({ status: 'unknown', requested: 'gamma' });
		expect(host.status()).toMatchObject({ scene: 'alpha', requested: 'gamma', resolution: 'unknown' });
	});

	it('mounts nothing and claims nothing when the registry is empty', () => {
		const host = makeHost([]);
		expect(host.mountFromSearch('?scene=alpha')).toEqual({ status: 'empty' });
		expect(host.status()).toMatchObject({ scene: null, requested: null, resolution: null });
	});

	it('treats a direct mount as a request, since it got the name it asked for', () => {
		const host = makeHost(interactiveScenes);
		host.mount('beta');
		expect(host.status()).toMatchObject({ scene: 'beta', requested: 'beta', resolution: 'requested' });
	});

	it('keeps the substitution across a reload and a resize', () => {
		const viewport = { width: 1440, height: 882 };
		const host = new SceneHost({ scenes: interactiveScenes, viewport: () => ({ ...viewport }) });
		host.mountFromSearch('?scene=gamma');

		host.reload();
		expect(host.status()).toMatchObject({ requested: 'gamma', resolution: 'unknown' });

		viewport.width = 900;
		host.resize();
		expect(host.status()).toMatchObject({ scene: 'alpha', requested: 'gamma', resolution: 'unknown' });
	});

	it('forgets how the scene was chosen once it is unmounted', () => {
		const host = makeHost(interactiveScenes);
		host.mountFromSearch('?scene=gamma');
		host.unmount();
		expect(host.status()).toMatchObject({ scene: null, requested: null, resolution: null });
	});
});

describe('pause', () => {
	let countingScene: CountingLayer;

	const countingScenes: GalleryScene[] = [
		{
			name: 'counting',
			factory: () => {
				countingScene = new CountingLayer({ id: 'counting', width: 100, height: 100 });
				return countingScene as unknown as Panel;
			},
		},
	];

	beforeAll(() => {
		// R14.1: the whole render path runs with no canvas and no GL over the
		// null backend, so a scene that grows a background or a clip keeps
		// working here instead of failing on a stub that answers nothing.
		RendererContext.getInstance().draw = new DrawApi({
			backend: new NullBackend(),
			development: false,
		});
	});

	it('skips update and keeps rendering', () => {
		const host = makeHost(countingScenes);
		host.mount('counting');

		host.update(0.016);
		host.render();
		expect(countingScene.updates).toBe(1);
		expect(countingScene.renders).toBe(1);

		host.paused = true;
		for (let index = 0; index < 5; index++) {
			host.update(0.016);
			host.render();
		}

		expect(countingScene.updates).toBe(1);
		expect(countingScene.renders).toBe(6);
		expect(host.status()).toMatchObject({ paused: true, updates: 1, renders: 6 });
	});

	it('resumes updating', () => {
		const host = makeHost(countingScenes);
		host.mount('counting');
		host.paused = true;
		host.update(0.016);
		host.paused = false;
		host.update(0.016);

		expect(countingScene.updates).toBe(1);
		expect(host.paused).toBe(false);
	});

	// R13.35: injected input is ignored while paused. Input reaches components
	// from DOM listeners rather than from the frame loop, so pausing the loop
	// alone would not stop it; the host has to gate the InputSystem too.
	it('gates the InputSystem, not just the loop', () => {
		const host = makeHost(countingScenes);
		expect(InputSystem.getInstance().paused).toBe(false);

		host.paused = true;
		expect(InputSystem.getInstance().paused).toBe(true);

		host.paused = false;
		expect(InputSystem.getInstance().paused).toBe(false);
	});
});

describe('status and roots', () => {
	// R13.33. The serializer walks debugChildren, so handing it the container
	// is enough for a Panel scene to report its background and content layer
	// rather than the content layer's children one level too shallow.
	it('hands the tree snapshot one root holding the scene', () => {
		const host = makeHost(interactiveScenes);
		host.mount('alpha');

		const roots = host.roots();
		expect(roots).toHaveLength(1);
		expect(roots[0]).toBe(host.root);
		expect(roots[0].id).toBe('gallery_root');
		expect(roots[0].debugChildren[0].id).toBe('scene_alpha');
		expect(findByType(roots[0], 'Input')).not.toBeNull();
	});

	it('lists the scenes it can mount', () => {
		expect(makeHost(interactiveScenes).status()).toMatchObject({
			scene: null,
			scenes: ['alpha', 'beta'],
			viewport: VIEWPORT,
		});
	});
});
