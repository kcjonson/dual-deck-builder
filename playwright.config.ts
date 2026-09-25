import { createHash } from 'node:crypto';
import { defineConfig } from '@playwright/test';

/**
 * The screenshot harness of R14.5, R15.33 and R15.36.
 *
 * Two projects, because R15.33 keeps baselines per backend: `chromium` drives
 * the dev server in a headless Chromium, `electron` drives the same dev server
 * inside the Electron shell the game actually ships in. Software-rendered
 * pixels differ from hardware output and Electron's Chromium is not the
 * bundled one, so a golden is only ever meaningful next to the project and the
 * platform that produced it (see `snapshotPathTemplate`).
 */

/**
 * R15.33, verbatim and unconditional. Chromium removed the automatic
 * SwiftShader fallback from version 137, so headless context creation fails
 * without these; `Renderer` throws on a null context and `src/index.ts`
 * swallows that into a console.error, which reaches a screenshot as a plain
 * black page rather than as a failure. The console assertions in
 * `tests/visual/support/harness.ts` are the second guard against that.
 */
export const SWIFTSHADER_ARGS = [
	'--use-gl=angle',
	'--use-angle=swiftshader-webgl',
	'--enable-unsafe-swiftshader',
];

/**
 * R13.37's fixed viewport. 1440x882 is the size the phase 0 perf baseline was
 * captured at - the default in `scripts/perf-capture.mjs`, which is where the
 * number lives, since the baseline JSON records samples and no viewport - so a
 * screenshot and a frame time in that table describe the same frame.
 */
export const FIXED_VIEWPORT = { width: 1440, height: 882 };

/**
 * A worktree-stable dev-server port. Several worktrees of this repo run at
 * once and webpack's configured 9000 is first-come-first-served, so the port
 * is derived from this checkout's path: stable across restarts here, different
 * in a sibling worktree, and `reuseExistingServer: false` below turns a
 * collision into a loud failure rather than a silent attach to someone else's
 * server serving someone else's code.
 */
const DEV_SERVER_PORT = Number(process.env.DDB_VISUAL_PORT)
	|| 9100 + (createHash('sha256').update(__dirname).digest()[0] % 100);

export const BASE_URL = `http://127.0.0.1:${DEV_SERVER_PORT}`;

/**
 * R14.5: baselines come from the CI runner image and local runs never update
 * a committed one. Two mechanisms, because a convention is not a mechanism.
 *
 * This is the first: any argument beginning with `-u` or `--update-snapshots`
 * refuses to run unless the caller is the baseline job in
 * `.github/workflows/visual.yml`, which sets VISUAL_BASELINE_RUNNER on a
 * `workflow_dispatch` input and nothing else does. Both spellings are matched
 * by prefix rather than by equality because the flag carries an optional mode
 * and commander accepts it attached: `-uall`, `-uchanged`, `-umissing` and
 * `--update-snapshots=changed` all rewrite baselines, and a check for the two
 * bare forms walks straight past every one of them. The second lives in that
 * workflow: a gate job that fails any pull request whose diff touches a file
 * under `tests/visual/__screenshots__` in a commit the baseline job did not
 * write.
 *
 * A local run is still useful because `{platform}` in `snapshotPathTemplate`
 * is a directory segment, not a filename suffix: this machine writes
 * `__screenshots__/chromium/win32/scene-buttons.png` and compares against
 * that, never against the `.../chromium/linux/...` file CI committed, and
 * `.gitignore` keeps every non-linux directory out of the repository. So
 * "local runs compare and never update" holds for the committed baselines
 * exactly, while a developer keeps a machine-local baseline to compare their
 * own change against.
 */
const updatingSnapshots = process.argv.some((argument) => argument.startsWith('-u')
	|| argument.startsWith('--update-snapshots'));
if (updatingSnapshots && !process.env.VISUAL_BASELINE_RUNNER) {
	throw new Error(
		'R14.5: screenshot baselines are produced by the CI runner image only. '
			+ 'Run the "Visual" workflow with update_baselines=true instead of '
			+ '--update-snapshots locally.',
	);
}

export default defineConfig({
	testDir: './tests/visual',
	// Software GL is CPU-bound and the whole suite is a handful of specs;
	// one worker keeps frame pacing off the list of things that can vary.
	workers: 1,
	fullyParallel: false,
	forbidOnly: !!process.env.CI,
	// A retry here is a report, not a silencer: both configured reporters mark
	// a test that passed on retry as flaky, and a flaky screenshot is the
	// symptom this suite exists to surface. Locally 0, because a developer
	// watching a red run does not want it papered over before they see it.
	retries: process.env.CI ? 1 : 0,
	// Stated rather than inherited. A capture is a page load, a navigate and a
	// settle; the slowest of them locally is 1.7 s, and a software-rendered
	// Linux runner under xvfb is several times slower than that. 60 s is the
	// margin, written down so that a timeout reads as an infrastructure
	// failure instead of arriving disguised as a pixel regression.
	timeout: 60_000,
	reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list'], ['html', { open: 'never' }]],
	snapshotPathTemplate: '{testDir}/__screenshots__/{projectName}/{platform}/{arg}{ext}',
	// On CI a missing golden is a failure, not an invitation to mint one, so a
	// pull request can never pass by writing the picture it was supposed to be
	// checked against. Locally the first run mints this machine's own baseline
	// under its own {platform} directory, which .gitignore keeps out of the
	// repository; the second run onwards is a real comparison, which is the
	// signal a developer actually wants from a local run.
	updateSnapshots: process.env.CI && !process.env.VISUAL_BASELINE_RUNNER ? 'none' : 'missing',
	expect: {
		// toHaveScreenshot takes two matching captures before it compares, and
		// retries the comparison until this expires. That retry loop is the
		// right place for a slow settle to be absorbed, rather than the pixel
		// tolerance below.
		timeout: 15_000,
		toHaveScreenshot: {
			// R14.5 and R15.36: a tolerance, never exact equality. The two
			// numbers do different jobs and both were measured against real
			// mutations rather than chosen for comfort.
			//
			// `threshold` is depth: pixelmatch's per-pixel YIQ distance,
			// maxDelta = 35215 * threshold^2. A uniform neutral shift of d
			// levels scores 0.5053 * d^2, so the smallest colour change the
			// suite can see is the smallest d that clears maxDelta. At 0.01
			// maxDelta is 3.52 and that d is 3: shifting the main-menu
			// background by +2 per channel produced 0 differing pixels and by
			// +3 produced 1,166,829. It is deliberately not the 0.2 this
			// harness shipped with, where maxDelta is 1408 and the cliff sits
			// at d = 53: at 0.2, setting Button.normalColor to hoverColor and
			// brightening a button fill by 5% each produced exactly zero
			// differing pixels.
			//
			// `maxDiffPixels` is area, and it is absolute because the viewport
			// is pinned: a ratio at 1440x882 is an obscured way of writing an
			// absolute number, and the one it used to write (0.001, 1270 px)
			// was larger than several real regressions. Measured at threshold
			// 0.01: a 3 px shift of one 300x60 button is 874 px, a dropped
			// character in an 18 px label 512, a one-character typo in the
			// 64 px title 604, a 1 px font-size change on a 24 px label 3,213,
			// an 80x30 button removed 1,973. 200 is below all of them with
			// room to spare, and consecutive local runs differ by 0 px, so it
			// is headroom for cross-runner wobble rather than cover for one.
			//
			// `maxDiffPixelRatio` is kept for two reasons. R14.5 names it
			// specifically, so dropping it would be a conformance gap for no
			// gain. And Playwright takes the smaller of the two: at the pinned
			// viewport 200 wins, but a capture of a smaller region (an element
			// shot, if one is ever added) would be far too loosely served by
			// 200 px, and there the ratio binds.
			//
			// Widening either of these is not the fix for a flaky golden.
			threshold: 0.01,
			maxDiffPixels: 200,
			maxDiffPixelRatio: 0.0002,
			animations: 'disabled',
			caret: 'hide',
			scale: 'css',
		},
	},
	use: {
		baseURL: BASE_URL,
		// Off, not retain-on-failure. A trace of a canvas application records a
		// blank DOM, so it answers nothing a screenshot failure asks, and
		// tracing an Electron context added a teardown failure of its own
		// during verification. What a red run actually needs is already
		// attached: Playwright's expected, actual and diff images, plus the
		// harness's own tree.json.
		trace: 'off',
	},
	projects: [
		{
			name: 'chromium',
			testMatch: /web\/.*\.spec\.ts$/,
			use: {
				browserName: 'chromium',
				viewport: FIXED_VIEWPORT,
				// R13.37's fixed device pixel ratio. FontAtlas, Renderer.resize,
				// Layer and Panel all multiply by window.devicePixelRatio, so an
				// unpinned ratio changes the backing store, the glyph raster and
				// the scissor rectangles all at once.
				deviceScaleFactor: 1,
				launchOptions: { args: SWIFTSHADER_ARGS },
			},
		},
		{
			name: 'electron',
			testMatch: /electron\/.*\.spec\.ts$/,
		},
	],
	webServer: {
		// A development build: `build:web` forces NODE_ENV=production, which
		// drops __DEV_TOOLS__ and the whole gallery entry, so a production
		// bundle has neither the scenes nor the hooks this harness drives.
		// --no-hot removes the HMR websocket and its reload timing;
		// --no-client-overlay stops a compile error painting a DOM panel over
		// the canvas, which would otherwise be baked into a golden.
		command: `npm start -- --port ${DEV_SERVER_PORT} --no-hot --no-client-overlay`,
		url: BASE_URL,
		reuseExistingServer: false,
		timeout: 180_000,
		stdout: 'ignore',
		stderr: 'pipe',
	},
});
