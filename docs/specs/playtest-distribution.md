# Playtest distribution

Status: drafted 2026-10-25, nothing built. Decision record: [playtest-binaries-over-web.md](../AI_TECHNICAL_DECISIONS/playtest-binaries-over-web.md). CI background: [prototype-ci.md](../../_legacy/docs/AI_TECHNICAL_DECISIONS/prototype-ci.md).

## Goal

Playtesters get the game by downloading an app for their machine from one URL, bearcavinteractive.com/playtest/dual-deckbuilder/, and that URL is a landing page: the game's name, the latest build's number and date, one download per platform, how to run it, and the builds before it. The game is moving to C++ on the salal engine and WebAssembly is not an engine target, so "open the URL and play" ends with the TypeScript build. The pipeline built here has to outlive Electron: a build job that leaves per-platform archives in a folder, a publish step that hosts them and rewrites the page, and nothing in between that cares what produced the archives.

## Current state

Every push to main builds the web bundle and mirrors it to the playtest URL over SFTP (`.github/workflows/deploy-sftp.yml:3-6`, `:31-35`, `:54-60`); a failed deploy opens a `main-broken` issue (`:62-68`). The mirror is `--delete` against the directory root (`:58`), so nothing else can live beside the web build there. Pull requests with the `playtest` label get the same under `<branch>/` (`deploy-pr-playtest.yml:14`, `:61`) with a comment linking it (`:65-75`), and `cleanup-pr.yml:31` removes the folder when the PR closes.

The deployed page is the game itself: `_legacy/public/index.html:42-43` is "Loading..." and a canvas. There is no landing page and no tester-facing document anywhere. The URL is written in `CLAUDE.md:18` and `:155-159`, `README.md:103` (as "the playtest site"), `prototype-ci.md:8`, `error-overlay.md:8`, and `campaign-save-and-load.md:25`; testers learn it by being sent it.

An Electron build already runs in CI, as a check and not a channel. `main.yml:181-223` packages Windows (NSIS) and macOS (dmg) on `windows-latest` and `macos-latest`, smokes the packaged app (`:215-216`, `_legacy/scripts/smoke-electron-package.mjs`), and uploads `release/` as a workflow artifact for 7 days (`:218-223`). It runs nightly, on dispatch, and on a push that touches `electron/`, `webpack/`, `build/`, the fonts, the smoke script, or the package files (`:61-72`); a gameplay change doesn't package. Workflow artifacts are zip-wrapped and need a GitHub login, so nobody plays from them. The configuration is `package.json:89-111`: productName "Dual Deckbuilder" (`:91`), mac dmg (`:99-103`), win nsis (`:104-107`), no Linux target, output `release/` (`:97`), and `publish` pointed at GitHub releases (`:108-111`), though no release has ever been published and the package scripts pass `--publish never` (`:15-17`). Electron 25.9.8 and electron-builder 24.13.3 (`package-lock.json`). Packaging took about 10 minutes per OS when it ran on every push (`prototype-ci.md:12`).

The build stamp is two webpack defines, `__BUILD_SHA__` and `__BUILD_NUMBER__`, read from `BUILD_SHA` and `BUILD_NUMBER` in production builds, the SHA falling back to `git rev-parse` and the number to null (`_legacy/webpack/webpack.common.js:11-27`, `:64-68`). The deploy workflows set both from `github.sha` and `github.run_number` (`deploy-sftp.yml:32-34`); the Electron renderer merges the same config (`_legacy/webpack/webpack.electron.js:67`) but `main.yml:207-211` sets neither, so a packaged app today reads "BUILD <sha>" with no number. The stamp prints on the splash (`SplashScreen.ts:55`), the main menu footer (`MainMenuScreen.ts:376`), and the error overlay (`_legacy/src/errorOverlay.ts:12`), formatted by `buildLabel.ts:16-20`. Every installer is version 1.0.0 (`package.json:3`).

The packaged app checks for updates on launch through electron-updater (`_legacy/electron/main.ts:4`, `:130-135`); with no releases the check fails and logs on every launch.

Nothing is signed. The repository's secrets are the five SFTP and host-key entries; there is no Apple Developer ID, no notarization credentials, no Windows certificate, and `package.json` carries no `hardenedRuntime`, entitlements, or `notarize` settings. `README.md:31` documents the `winCodeSign` symlink problem, which is electron-builder fetching its signing tools, not signing. An unsigned download warns on both platforms: SmartScreen's "Windows protected your PC", and Gatekeeper's "Apple could not verify", which on macOS 15 and later needs System Settings > Privacy & Security > Open Anyway rather than right-click Open.

## Target state

### Pipeline

One workflow, `playtest-build.yml` (name open), on push to main and on dispatch, waiting on none of `main.yml`'s checks, the way the web deploy doesn't today:

1. `build` is a matrix over the platforms. Each leg builds and packages with `BUILD_SHA=${{ github.sha }}` and `BUILD_NUMBER=${{ github.run_number }}` so the in-app stamp matches the page, and with the package version set per build (`--config.extraMetadata.version=1.0.<run_number>`) so installers differ and Windows installs over the previous build cleanly. Each leg renames its output to `WastelandWheels-<build>-<platform>-<arch>.<ext>` and uploads it as a workflow artifact. The existing smoke (`smoke-electron-package.mjs`) runs on each leg; a leg that fails doesn't publish, and the others still do.
2. `publish` downloads the artifacts, pushes them to the host under the build's folder or tag, writes the manifest (below), and mirrors the landing page. It reports through `report-main` as `playtest build`, so a broken channel is an issue like a broken deploy.

The publish step's inputs are a directory of archives, the build number, the SHA, and the date. Nothing in it names Electron, and the build matrix is the only part replaced at the C++ cutover. `main.yml`'s nightly `electron` job stays as the packaging check for pushes that didn't touch packaging; once every push to main packages, it can go.

Platforms: Windows x64 (NSIS installer, plus a portable zip if testers ask for one), macOS arm64 and x64 (dmg; `macos-latest` is arm64, so x64 is an explicit `--x64`), Linux if Kevin wants it (open decision 4). Playtest builds drop the launch-time update check (`_legacy/electron/main.ts:130-135`): electron-updater won't update an unsigned macOS app, and the landing page is the update channel.

Runner time is about 10 minutes per leg today with no cache beyond npm's. Caching electron-builder's downloads (`~/.cache/electron`, `~/.cache/electron-builder`, their Windows and macOS equivalents) with `actions/cache` takes a few minutes off each leg; worth doing in the first version since the matrix now runs on every push.

### Hosting

Two workable homes; Kevin picks (open decision 1). Either way the landing page is on the SFTP host at the playtest URL and the manifest tells it where the files are, so the choice can change later without touching the page.

- GitHub Releases, recommended. One prerelease per build, tag `playtest-<build>`, assets attached with `gh release create`. Storage and bandwidth are GitHub's, the repository is public so no login is needed to download, and `package.json`'s `publish` block already points here. Retention is `gh release delete` of tags older than the newest N in the same job. The cost is a tag per build in the repository and download URLs on github.com rather than the playtest domain.
- The SFTP host, under `/playtest/dual-deckbuilder/builds/<build>/`, by the same lftp mirror the web deploy uses. One domain, no new secrets. The cost is disk on a shared host (about 100 MB per platform per build, so roughly a gigabyte for five builds across three platforms), cleanup over SFTP, and upload time from the runner.

### Landing page

A static `index.html` at the playtest URL, checked in under `playtest/` at the repository root (outside `public/`, which webpack bundles) and mirrored by the publish step. It renders from `builds.json` beside it, which the publish step rewrites each build:

```json
{ "latest": 212, "builds": [ { "number": 212, "sha": "2f8d7a7", "date": "2026-10-25T19:46Z",
  "downloads": { "win-x64": "...", "mac-arm64": "...", "mac-x64": "...", "linux-x64": "..." } } ] }
```

The page shows: Wasteland Wheels; the latest build's number, date, and short SHA (the same "BUILD 212 - 2f8d7a7" the splash prints, so a bug report and a download line up); one button per platform, the viewer's platform first; "how to run" notes per platform, including the unsigned-build steps below and where saves live; the previous builds in the manifest with their downloads; and a link to the web build while it exists. No framework, no build step, a few hundred lines at most, so it survives the C++ port untouched. The app's product name is still "Dual Deckbuilder" (`package.json:91`); renaming it to match the page is its own small change.

### PR builds

`deploy-pr-playtest.yml` and `cleanup-pr.yml` go. A PR with the `playtest` label gets the same build matrix as a job in `pr.yml` (or its own workflow), uploading the archives as workflow artifacts with 7-day retention and commenting the run URL on the PR. Artifacts need a GitHub login, which the team has; a tester who needs a branch build gets the file forwarded. No per-branch folder on the host.

### Signing posture

Unsigned for now, said plainly on the landing page:

- Windows: SmartScreen on first run; More info > Run anyway. The installer and the game's exe both trip it.
- macOS: the dmg mounts, the app is blocked on first open; System Settings > Privacy & Security > Open Anyway, or `xattr -dr com.apple.quarantine "/Applications/Dual Deckbuilder.app"`. The first macOS build has to be downloaded and opened on a Mac that didn't build it before the page claims these steps work; a build with no signature at all can read as "damaged" on Apple Silicon, in which case the build leg ad-hoc signs (`codesign --force --deep --sign -`) before packaging.

Certificates later (open decision 2): an Apple Developer ID plus notarization (`APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`, the identity as `CSC_LINK` and `CSC_KEY_PASSWORD`) and a Windows OV or EV certificate or Azure Trusted Signing. electron-builder picks them up from those secrets once `hardenedRuntime` and `notarize` are added to the mac block; the C++ build signs with the same identities through `codesign` and `notarytool` and `signtool`. Nothing in the pipeline's shape changes when they arrive.

### The web deploy

Kept until the C++ cutover, since the TypeScript build is the differential-test oracle during the port, but moved out of the way: `deploy-sftp.yml` mirrors to `/playtest/dual-deckbuilder/web/` instead of the root, so the root is the landing page and the `--delete` mirror can't remove it. The page links the web build under the downloads, labelled as the build the port is checked against. The per-PR web previews end now.

Moving the web build changes its save namespace (`campaign-save-and-load.md:25`: saves key on the directory the page was served from), so every tester's browser campaign stops being visible to the moved build. It happens once, at the switch, and the landing page says so; the old saves stay in storage under the old key until the browser clears them.

## End state after the C++ port

The salal build (CMake presets `windows` and `default`; salal's `ci.yml` already builds on windows-latest, macos-latest, and ubuntu-latest) replaces the Electron matrix. Each leg's output is an archive of the native executable and its assets, named the same way, stamped the same way (build number and SHA baked in at configure time), handed to the same publish step, listed in the same manifest, and downloaded from the same page. `deploy-sftp.yml` and the web build are deleted at cutover and the web-build line leaves the page. Signing, when it exists, moves from electron-builder's settings to the build leg's own `codesign` and `signtool` calls with the same secrets.

## Open decisions for Kevin

1. Hosting: GitHub Releases (recommended) or a `builds/` folder on the SFTP host. Retention goes with it: the newest 10 builds on Releases, or 5 on the host.
2. Signing certificates: buy an Apple Developer ID and a Windows certificate now, or ship unsigned with the instructions above until the playtest audience grows past people who'll click through.
3. The web deploy: move it to `/web/` now and keep it until cutover (recommended), or leave the root as the web game and put the landing page at a new path until the port lands.
4. Linux: AppImage (one file, no install, the usual for playtests), deb, or none until a tester asks. The smoke script already finds a `linux-unpacked` build (`smoke-electron-package.mjs:31-32`), so the leg is cheap to add.
5. Whether a PR build needs the `playtest` label (recommended, since the matrix costs about 20 runner-minutes) or runs on every PR.

## Rollout order

1. Kevin settles decisions 1, 3, and 4; 2 and 5 can wait.
2. Landing page and manifest, deployed to the root, with the web build moved to `/web/` in the same change and a note to testers about saves. The page lists the web build only until the first binary build publishes.
3. The build workflow: the matrix with the stamp and per-build version, the update check removed, publish and manifest, retention, `report-main`.
4. The first macOS and Windows downloads opened on machines that didn't build them; the run instructions corrected from what happens.
5. Retire `deploy-pr-playtest.yml` and `cleanup-pr.yml`; add the label-gated PR build.
6. README, CLAUDE.md's deployment note, and the decision records that cite the URL updated to say what the URL is now.
7. Certificates and notarization when decision 2 says so.
