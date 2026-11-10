# Playtest distribution

Status: drafted 2026-10-25; Kevin settled the open decisions 2026-11-09 (below). The pipeline is `.github/workflows/playtest-build.yml`, the page `playtest/index.html`. Decision record: [playtest-binaries-over-web.md](../AI_TECHNICAL_DECISIONS/playtest-binaries-over-web.md). CI background: [prototype-ci.md](https://github.com/kcjonson/dual-deck-builder/blob/0a912c7457093b893b47656277b0894e8f50a48b/_legacy/docs/AI_TECHNICAL_DECISIONS/prototype-ci.md).

## Goal

Playtesters get the game by downloading an app for their machine from one URL, bearcavinteractive.com/playtest/dual-deckbuilder/, and that URL is a landing page: the game's name, the latest build's number and date, one download per platform, how to run it, and the builds before it. The game is C++ on the salal engine and WebAssembly is not an engine target, so there's no browser build to open at the URL. The pipeline is a build job that leaves per-platform archives in a folder, a publish step that hosts them and rewrites the page, and nothing in between that cares what produced the archives.

## The TypeScript build

The TypeScript proof of concept, removed at the C++ cutover on 2026-11-09, was played at the URL as a web page: every push to main mirrored the web bundle to the URL's root over SFTP (`deploy-sftp.yml`), so the page there was the game itself, with no landing page, and a pull request labelled `playtest` got a copy under `<branch>/`. Its Electron app (a Windows NSIS installer, a macOS dmg) was packaged in CI as a check, never as a channel. Nothing was ever signed: there's no Apple Developer ID, no notarization credentials, and no Windows certificate.

## Target state

### Pipeline

One workflow, `playtest-build.yml`, on every push to main, on dispatch, and on pull requests labelled `playtest`, waiting on none of the other checks:

1. `build` is a matrix over the platforms (below), set up as salal's CI is (vcpkg through `lukka/run-vcpkg` at salal's tool commit, ccache, MSVC through `msvc-dev-cmd` on Windows, Ninja). It builds Release, so salal's dev server isn't compiled in: the Windows leg configures with the `windows` preset and builds with `windows-release`, the macOS legs use `release` for both. Each leg passes the build number (`github.run_number`) and the SHA to CMake at configure time as `DDB_BUILD_NUMBER` and `DDB_BUILD_SHA`, and the build bakes them in, so the in-app stamp matches the page. `scripts/package.mjs` archives the executable and its assets as `WastelandWheels-<build>-<platform>-<arch>.zip`, and the leg uploads it as a workflow artifact. A leg that fails doesn't publish, and the others still do.
2. `publish`, on a push to main only, downloads the artifacts, creates the build's release (below), prunes old ones, rewrites the manifest, and mirrors the landing page. It reports through `report-main` as `playtest build`, so a broken channel is an issue like a broken check; a leg that failed counts as broken even when the rest published.

The publish step's inputs are a directory of archives, the build number, the SHA, and the date. Nothing in it knows how the archives were built.

Platforms: Windows x64 on `windows-latest`, macOS arm64 on `macos-26`, and macOS x64 on `macos-26-intel`, GitHub's Intel image. The x64 leg passes `-DCMAKE_OSX_ARCHITECTURES=x86_64 -DVCPKG_TARGET_TRIPLET=x64-osx` anyway, so it moves to cross-compiling on arm64 unchanged when the Intel images go (salal's build-time tools would then run under Rosetta). The macOS legs set `MACOSX_DEPLOYMENT_TARGET` to 14.0, which CMake and the vcpkg ports read, so a build runs on macOS 14 and later rather than only on the runner's version. No Linux. The game has no update check; the landing page is the update channel.

Each leg caches vcpkg's binary packages and ccache between runs, as salal's CI does, so it doesn't rebuild every dependency from source. The vcpkg cache is keyed per leg and kept apart from any Debug CI's, since the deployment target isn't part of vcpkg's ABI hash.

### Hosting

GitHub Releases. One prerelease per build, tag `playtest-<build>` at the build's commit, the archives attached with `gh release create`. Storage and bandwidth are GitHub's, and the repository is public so no login is needed to download. Retention is the newest 10: the publish job deletes `playtest-*` prereleases older than that, and their tags, with `gh release delete --cleanup-tag`. The cost is a tag per build in the repository and download URLs on github.com rather than the playtest domain.

The landing page is on the SFTP host at the playtest URL and the manifest tells it where the files are, so hosting can move (to a `builds/` folder on the SFTP host, say) without touching the page.

### Landing page

A static `index.html` at the playtest URL, checked in under `playtest/` at the repository root and mirrored by the publish step to the URL's root, where it replaces the web game; the web bundle's files there go, and any folder under the root stays. It renders from `builds.json` beside it, which the publish step rebuilds from the repository's `playtest-*` releases every run, so nothing but the releases carries over between runs:

```json
{ "latest": 212, "builds": [ { "number": 212, "sha": "2f8d7a7c...", "date": "2026-10-25T19:46:12Z",
  "downloads": { "win-x64": { "url": "...", "size": 41234567 }, "mac-arm64": { ... }, "mac-x64": { ... } } } ] }
```

The page shows: Wasteland Wheels; the latest build's number, date, and short SHA (the same "BUILD 212 - 2f8d7a7" the splash prints, so a bug report and a download line up); one button per platform, the viewer's platform first; "how to run" notes per platform, including the unsigned-build steps below and where saves live; and the previous builds in the manifest with their downloads. A platform a build is missing (its leg failed) says so and points at the newest build that has one. With no manifest or no builds it says the first build hasn't been published yet. No framework, no build step, a few hundred lines at most.

### PR builds

A PR with the `playtest` label gets the same build matrix, uploading the archives as workflow artifacts with 7-day retention and commenting the run URL on the PR. Each push to the PR replaces its running builds. Artifacts need a GitHub login, which the team has; a tester who needs a branch build gets the file forwarded. No per-branch folder on the host and no release.

### Signing posture

Unsigned, said plainly on the landing page:

- Windows: SmartScreen's "Windows protected your PC" on first run; More info > Run anyway.
- macOS: Gatekeeper's "Apple could not verify" blocks the app on first open. On macOS 15 and later that needs System Settings > Privacy & Security > Open Anyway rather than right-click Open, or `xattr -dr com.apple.quarantine` on the app. The first macOS build has to be downloaded and opened on a Mac that didn't build it before the page claims these steps work; a build with no signature at all can read as "damaged" on Apple Silicon, in which case the build leg ad-hoc signs (`codesign --force --deep --sign -`) before packaging.

Certificates later: an Apple Developer ID plus notarization, and a Windows OV or EV certificate or Azure Trusted Signing, kept as repository secrets. The build leg signs with them through `codesign` and `notarytool` on macOS and `signtool` on Windows. Nothing in the pipeline's shape changes when they arrive.

## Open decisions

Kevin settled all four on 2026-11-09:

1. Hosting: GitHub Releases, one prerelease per build tagged `playtest-<build>`, keeping the newest 10.
2. Signing: unsigned, with the instructions above, until the playtest audience grows past people who'll click through.
3. Platforms: Windows x64, macOS arm64, and macOS x64. No Linux.
4. PR builds: only on PRs labelled `playtest`, the build matrix alone, archives as 7-day workflow artifacts and a comment with the run URL; nothing published. Every push to main runs the workflow.

## Rollout order

1. The landing page, the manifest, and the build workflow: the matrix with the stamp, publish and manifest, retention, `report-main`, and the label-gated PR build. The first publish puts the page at the root, in place of the web game.
2. The first macOS and Windows downloads opened on machines that didn't build them; the run instructions corrected from what happens.
3. Certificates and notarization when the signing decision changes.
