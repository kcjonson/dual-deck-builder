# Playtest distribution

Status: drafted 2026-10-25, nothing built. Decision record: [playtest-binaries-over-web.md](../AI_TECHNICAL_DECISIONS/playtest-binaries-over-web.md). CI background: [prototype-ci.md](../../_legacy/docs/AI_TECHNICAL_DECISIONS/prototype-ci.md).

## Goal

Playtesters get the game by downloading an app for their machine from one URL, bearcavinteractive.com/playtest/dual-deckbuilder/, and that URL is a landing page: the game's name, the latest build's number and date, one download per platform, how to run it, and the builds before it. The game is C++ on the salal engine and WebAssembly is not an engine target, so there's no browser build to open at the URL. The pipeline is a build job that leaves per-platform archives in a folder, a publish step that hosts them and rewrites the page, and nothing in between that cares what produced the archives.

## The TypeScript build

The TypeScript proof of concept, frozen in `_legacy/`, was played at the URL as a web page: every push to main mirrored the web bundle to the URL's root over SFTP (`deploy-sftp.yml`), so the page there is the game itself, with no landing page, and a pull request labelled `playtest` got a copy under `<branch>/`. Its Electron app (a Windows NSIS installer, a macOS dmg) was packaged in CI as a check, never as a channel. Nothing was ever signed: there's no Apple Developer ID, no notarization credentials, and no Windows certificate.

## Target state

### Pipeline

One workflow, `playtest-build.yml` (name open), on push to main and on dispatch, waiting on none of the other checks:

1. `build` is a matrix over the platforms (below), on the runners and CMake presets salal's CI uses: `windows-latest` with the `windows` preset, `macos-latest` and `ubuntu-latest` with `default`. It builds Release, so salal's dev server isn't compiled in. Each leg passes the build number (`github.run_number`) and the SHA to CMake at configure time, and the build bakes them in, so the in-app stamp matches the page. Each leg archives the executable and its assets as `WastelandWheels-<build>-<platform>-<arch>.<ext>` and uploads the archive as a workflow artifact. A leg that fails doesn't publish, and the others still do.
2. `publish` downloads the artifacts, pushes them to the host under the build's folder or tag, writes the manifest (below), and mirrors the landing page. It reports through `report-main` as `playtest build`, so a broken channel is an issue like a broken check.

The publish step's inputs are a directory of archives, the build number, the SHA, and the date. Nothing in it knows how the archives were built.

Platforms: Windows x64, macOS arm64 and x64 (`macos-latest` is arm64, so x64 is built explicitly), Linux if Kevin wants it (open decision 3). The game has no update check; the landing page is the update channel.

Each leg caches vcpkg's binary packages and ccache between runs, as salal's CI does, so it doesn't rebuild every dependency from source.

### Hosting

Two workable homes; Kevin picks (open decision 1). Either way the landing page is on the SFTP host at the playtest URL and the manifest tells it where the files are, so the choice can change later without touching the page.

- GitHub Releases, recommended. One prerelease per build, tag `playtest-<build>`, assets attached with `gh release create`. Storage and bandwidth are GitHub's, and the repository is public so no login is needed to download. Retention is `gh release delete` of tags older than the newest N in the same job. The cost is a tag per build in the repository and download URLs on github.com rather than the playtest domain.
- The SFTP host, under `/playtest/dual-deckbuilder/builds/<build>/`, by an lftp mirror like the old web deploy's. One domain, no new secrets. The cost is disk on a shared host, cleanup over SFTP, and upload time from the runner.

### Landing page

A static `index.html` at the playtest URL, checked in under `playtest/` at the repository root and mirrored by the publish step. It renders from `builds.json` beside it, which the publish step rewrites each build:

```json
{ "latest": 212, "builds": [ { "number": 212, "sha": "2f8d7a7", "date": "2026-10-25T19:46Z",
  "downloads": { "win-x64": "...", "mac-arm64": "...", "mac-x64": "...", "linux-x64": "..." } } ] }
```

The page shows: Wasteland Wheels; the latest build's number, date, and short SHA (the same "BUILD 212 - 2f8d7a7" the splash prints, so a bug report and a download line up); one button per platform, the viewer's platform first; "how to run" notes per platform, including the unsigned-build steps below and where saves live; and the previous builds in the manifest with their downloads. No framework, no build step, a few hundred lines at most.

### PR builds

A PR with the `playtest` label gets the same build matrix, uploading the archives as workflow artifacts with 7-day retention and commenting the run URL on the PR. Artifacts need a GitHub login, which the team has; a tester who needs a branch build gets the file forwarded. No per-branch folder on the host.

### Signing posture

Unsigned for now, said plainly on the landing page:

- Windows: SmartScreen's "Windows protected your PC" on first run; More info > Run anyway.
- macOS: Gatekeeper's "Apple could not verify" blocks the app on first open. On macOS 15 and later that needs System Settings > Privacy & Security > Open Anyway rather than right-click Open, or `xattr -dr com.apple.quarantine` on the app. The first macOS build has to be downloaded and opened on a Mac that didn't build it before the page claims these steps work; a build with no signature at all can read as "damaged" on Apple Silicon, in which case the build leg ad-hoc signs (`codesign --force --deep --sign -`) before packaging.

Certificates later (open decision 2): an Apple Developer ID plus notarization, and a Windows OV or EV certificate or Azure Trusted Signing, kept as repository secrets. The build leg signs with them through `codesign` and `notarytool` on macOS and `signtool` on Windows. Nothing in the pipeline's shape changes when they arrive.

## Open decisions for Kevin

1. Hosting: GitHub Releases (recommended) or a `builds/` folder on the SFTP host. Retention goes with it: the newest 10 builds on Releases, or 5 on the host.
2. Signing certificates: buy an Apple Developer ID and a Windows certificate now, or ship unsigned with the instructions above until the playtest audience grows past people who'll click through.
3. Linux: AppImage (one file, no install, the usual for playtests), deb, or none until a tester asks. Salal's CI already builds on `ubuntu-latest`, so the leg is cheap to add.
4. Whether a PR build needs the `playtest` label (recommended, since every leg is a full native build) or runs on every PR.

## Rollout order

1. Kevin settles decisions 1 and 3; 2 and 4 can wait.
2. The landing page, the manifest, and the build workflow: the matrix with the stamp, publish and manifest, retention, `report-main`. The first publish puts the page at the root, in place of the web game.
3. The first macOS and Windows downloads opened on machines that didn't build them; the run instructions corrected from what happens.
4. The label-gated PR build.
5. Certificates and notarization when decision 2 says so.
