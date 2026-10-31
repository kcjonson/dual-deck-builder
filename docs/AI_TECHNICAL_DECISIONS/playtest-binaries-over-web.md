# Playtest builds as downloadable binaries, not a web page

## Date
2026-10-25

## Context

Playtesting happens on the web build of main, mirrored to bearcavinteractive.com/playtest/dual-deckbuilder/ on every push ([prototype-ci.md](../../_legacy/docs/AI_TECHNICAL_DECISIONS/prototype-ci.md), `deploy-sftp.yml`). The game is migrating to C++ on the salal engine, and Kevin has decided WebAssembly is not an engine target, so there will be no browser build of the ported game. The channel playtesters use has to change before the port lands, or the port lands with no way to play it.

CI already packages Electron for Windows and macOS (`main.yml`, the `electron` job), nightly and when packaging files change, and keeps the result as a 7-day workflow artifact nobody downloads. Nothing is signed. Spec: [playtest-distribution.md](../specs/playtest-distribution.md).

## Options considered

1. **Keep the web channel until cutover, then work out distribution.**
   - Pros: nothing to build now.
   - Cons: the first native build arrives with no page, no hosting, no run instructions, and no tester who has ever installed anything; and the Electron app, which could have shaken all of that out, never ships.
2. **Ship the Electron app through GitHub Releases alone**, with the release page as the landing page.
   - Pros: no page to write; electron-updater is already pointed at it.
   - Cons: the release page is a developer's page (tags, source archives, checksums); the playtest URL testers know goes dead or stays a stale web game; the auto-updater can't update unsigned macOS apps anyway.
3. **Per-platform binaries on every push to main, a static landing page at the playtest URL, hosting behind a manifest (chosen).**

## Decision

Option 3. A build workflow packages each platform on every push to main, stamps it with the build number and SHA the web build already shows, and hands the archives to a publish step that uploads them and rewrites a `builds.json` manifest. The playtest URL becomes a static page that renders the manifest: latest build, one download per platform, how to run an unsigned build, previous builds. Per-PR builds are workflow artifacts behind the `playtest` label, and the per-PR web previews end. The web deploy keeps running, moved under `/web/`, until the C++ cutover. Builds are unsigned until certificates exist, and the page says so.

## Rationale

The expensive parts of a download channel are the ones that have nothing to do with Electron: hosting, retention, a page testers trust, instructions that survive Gatekeeper and SmartScreen, and a build number a bug report can cite. Doing them now, with an app CI already knows how to package, means the C++ build drops into a working channel by replacing one job's matrix. A manifest between the publish step and the page keeps the hosting decision reversible.

## Consequences

- Testers install something. Unsigned builds warn on first run on both platforms, and the macOS steps changed in macOS 15; the page has to carry the current steps, and the first downloads have to be tried on machines that didn't build them.
- Every push to main costs about 20 runner-minutes of packaging where it cost none unless packaging files changed. Caching electron-builder's downloads recovers some of it.
- The web build's save namespace moves with it (`campaign-save-and-load.md`), so browser campaigns are not visible to the moved build. Once, at the switch.
- `main.yml`'s nightly `electron` job becomes redundant once every push packages, and goes.
- The launch-time update check comes out of playtest builds; the landing page is the update channel until signing makes electron-updater usable, and the C++ build will not have electron-updater at all.
- Open for Kevin, in the spec: hosting (GitHub Releases or the SFTP host), certificates, whether the web deploy moves now, the Linux format, and whether PR builds stay behind the label.
