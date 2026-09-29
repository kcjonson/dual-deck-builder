import { spawnSync } from 'child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';

/**
 * visual.yml's provenance gate, run in throwaway repositories. Each case
 * builds a `main` and a branch, then runs the script the way the job does,
 * with `main` as the base.
 */

const SCRIPT = resolve(__dirname, 'check-baseline-provenance.sh');
const GOLDEN = 'tests/visual/__screenshots__/chromium/linux/screen-x.png';
const OTHER = 'tests/visual/__screenshots__/chromium/linux/screen-y.png';
const BOT = { name: 'github-actions[bot]', email: 'github-actions[bot]@users.noreply.github.com' };
const HAND = { name: 'Someone', email: 'someone@example.com' };
const MINT = 'Update screenshot baselines [visual-baseline]';

let repo: string;

// Each case runs a dozen git processes. The slowest take 15 s on an idle
// machine and several times that when parallel suites load it; the timeout
// only has to catch a hang.
jest.setTimeout(120_000);

function git(args: string[], who = HAND): string {
	const result = spawnSync('git', args, {
		cwd: repo,
		encoding: 'utf8',
		env: {
			...process.env,
			GIT_AUTHOR_NAME: who.name,
			GIT_AUTHOR_EMAIL: who.email,
			GIT_COMMITTER_NAME: who.name,
			GIT_COMMITTER_EMAIL: who.email,
			GIT_CONFIG_GLOBAL: '/dev/null',
			GIT_CONFIG_NOSYSTEM: '1',
		},
	});
	if (result.status !== 0) throw new Error(`git ${args.join(' ')}: ${result.stderr}`);
	return result.stdout.trim();
}

function write(path: string, content: string): void {
	mkdirSync(join(repo, path, '..'), { recursive: true });
	writeFileSync(join(repo, path), content);
}

function commit(path: string, content: string, subject: string, who = HAND): void {
	write(path, content);
	git(['add', path]);
	git(['commit', '-q', '-m', subject], who);
}

function check(): { status: number | null; output: string } {
	const result = spawnSync('bash', [SCRIPT, 'main'], { cwd: repo, encoding: 'utf8' });
	return { status: result.status, output: result.stdout + result.stderr };
}

beforeEach(() => {
	repo = mkdtempSync(join(tmpdir(), 'provenance-'));
	git(['init', '-q', '-b', 'main']);
	commit('README', 'repo', 'Start');
	commit(GOLDEN, 'ci pixels 0', MINT, BOT);
	git(['checkout', '-q', '-b', 'feature']);
});

afterEach(() => {
	rmSync(repo, { recursive: true, force: true });
});

describe('check-baseline-provenance', () => {
	it('passes a branch that changes no baseline', () => {
		commit('src.ts', 'code', 'Change code');
		expect(check()).toMatchObject({ status: 0 });
	});

	it('passes a baseline the mint set last', () => {
		commit('src.ts', 'code', 'Change code');
		commit(GOLDEN, 'ci pixels 1', MINT, BOT);
		expect(check()).toMatchObject({ status: 0 });
	});

	it('fails a hand-edited baseline', () => {
		commit(GOLDEN, 'local pixels', 'Update the golden');
		const result = check();
		expect(result.status).toBe(1);
		expect(result.output).toContain(GOLDEN);
	});

	it('passes a hand edit a later mint overwrote, since the bytes that merge are the mint\'s', () => {
		commit(GOLDEN, 'local pixels', 'Update the golden');
		commit(GOLDEN, 'ci pixels 1', MINT, BOT);
		expect(check()).toMatchObject({ status: 0 });
	});

	it('fails a revert of a mint, which puts the hand-edited bytes back', () => {
		commit(GOLDEN, 'local pixels', 'Update the golden');
		commit(GOLDEN, 'ci pixels 1', MINT, BOT);
		git(['revert', '--no-edit', 'HEAD']);
		const result = check();
		expect(result.status).toBe(1);
		expect(result.output).toContain('Revert "Update screenshot baselines [visual-baseline]"');
	});

	it('fails the mint subject typed by someone else', () => {
		commit(GOLDEN, 'local pixels', MINT);
		expect(check().status).toBe(1);
	});

	it('fails a subject that only contains the marker', () => {
		commit(GOLDEN, 'local pixels', `Tweak ${MINT}`, BOT);
		expect(check().status).toBe(1);
	});

	it('passes a merge of main that brings main\'s own new baselines', () => {
		commit(GOLDEN, 'ci pixels 1', MINT, BOT);
		git(['checkout', '-q', 'main']);
		commit(OTHER, 'main ci pixels', MINT, BOT);
		git(['checkout', '-q', 'feature']);
		git(['merge', '-q', '--no-edit', 'main']);
		expect(check()).toMatchObject({ status: 0 });
	});

	it('fails a merge that hand-edits a baseline the branch changes', () => {
		commit(GOLDEN, 'ci pixels 1', MINT, BOT);
		git(['checkout', '-q', 'main']);
		commit('src.ts', 'main code', 'Main change');
		git(['checkout', '-q', 'feature']);
		git(['merge', '-q', '--no-commit', 'main']);
		write(GOLDEN, 'edited during the merge');
		git(['add', GOLDEN]);
		git(['commit', '-q', '--no-edit']);
		expect(check().status).toBe(1);
	});

	it('fails a deleted baseline', () => {
		git(['rm', '-q', GOLDEN]);
		git(['commit', '-q', '-m', 'Drop the golden']);
		expect(check().status).toBe(1);
	});
});
