// Temporary: which launch flags keep the packaged app alive on the Windows runner.
import { join, resolve } from 'node:path';
import { _electron as electron } from '@playwright/test';

const exe = join(resolve(import.meta.dirname, '..', 'release', 'win-unpacked'), 'Dual Deckbuilder.exe');
const sets = [
	[],
	['--disable-gpu-sandbox'],
	['--disable-gpu', '--disable-gpu-sandbox'],
	['--in-process-gpu'],
	['--use-angle=swiftshader'],
	['--disable-gpu', '--disable-software-rasterizer'],
	['--no-sandbox'],
];
for (const args of sets) {
	for (let attempt = 1; attempt <= 2; attempt++) {
		let crashes = 0;
		let fatal = false;
		const app = await electron.launch({ executablePath: exe, args, timeout: 60000 });
		app.process().stderr?.on('data', (d) => {
			const s = String(d);
			crashes += (s.match(/GPU process exited unexpectedly/g) ?? []).length;
			if (s.includes('FATAL')) fatal = true;
		});
		let verdict;
		try {
			const page = await app.firstWindow({ timeout: 60000 });
			await page.waitForLoadState('domcontentloaded', { timeout: 60000 });
			await page.waitForTimeout(25000);
			const webgl2 = await page.evaluate(() => !!document.createElement('canvas').getContext('webgl2'));
			verdict = `alive, webgl2=${webgl2}`;
		} catch (error) {
			verdict = `died: ${String(error.message).split('\n')[0]}`;
		}
		await app.close().catch(() => undefined);
		console.log(`PROBE [${args.join(' ') || 'none'}] #${attempt}: ${verdict}, gpu crashes ${crashes}, fatal ${fatal}`);
	}
}
