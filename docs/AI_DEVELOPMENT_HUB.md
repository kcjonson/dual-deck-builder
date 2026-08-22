# Wasteland Wheels Development Hub

This document is a place for multiple AI workers (such as Claude and Claude Code) to store status, open questions, technical decisions and more. This should be formatted for the workers to read, and isn't particularly for a human audience.

=========================================

## Current state (verified survey, 2026-08-22)

Development stopped 2025-07-03. On 2026-08-22 the whole project was re-surveyed: `npm test` (128/128 pass), `npm run lint` (0 errors, 9 warnings), `npm run build:web` (compiles), plus a live click-through of the running game and a full code audit. Everything below is verified against the code or the running app, not carried forward from old status notes.

A dated warning about this doc's history: all entries previously dated "December 2024" or "January 2025" describe work actually done June/July 2025 (the repo's first commit is 2025-05-17). The AI that wrote them used its assumed date instead of the real one. See the correction note at the top of [AI_DEVELOPMENT_LOG.md](./AI_DEVELOPMENT_LOG.md).

### Working (verified by running it)

- Main menu → driver selection → combat flow. Cards play, adrenaline is spent and resets, cards leave the hand, End Turn works, the enemy AI (AggressiveFlankerAI) takes its turn and deals damage, turn counter advances. No console errors.
- Combat mechanics in `Battle.ts` are far more complete than old docs claimed: range calculation and validation, hit calculation (gunnery vs evade, `always_hits`, Headshot evade modifier), flanking damage bonus, Vulnerable, formula-based ram damage, position-based and same-vehicle targeting restrictions, driver-only targeting, half damage to occupants after armor depletion, driver escape on vehicle destruction. `docs/MISSING_COMBAT_FEATURES.md` was obsolete on nearly every line and has been deleted.
- The AI stack: RandomAI, AggressiveFlankerAI, MCTSAI, SalvageAI, RammingAI, all wired through `AIController`.
- Both standalone HTML harnesses: `/battle.html` (AI vs AI and human battle simulator, runs a full battle to completion with log) and `/evalai.html` (round-robin AI tournament UI).
- ScreenManager with lazy screen creation, mount/unmount lifecycle, text batching with the F5 performance overlay.

### Built but broken (exists, doesn't work right)

- **Battle-end double navigation**: `CombatScreen.ts:180-193` navigates to `battleResultScreen` on the `battleEnded` event AND `CombatScreen.ts:687` → `handleBattleEnd():731` navigates again with the same data. Both fire on the same card play.
- **`Battle.endCombat()` is never called in production** (`Battle.ts:1288`). Only tests call it, so post-combat flanking loss and the `combatEnded` event never happen in the real game.
- **Vehicle targeting highlights are dead**: `ui/Vehicle.ts:346-360` subscribes to per-property events (`'targetableVehicleIds'`, `'focusedVehicleId'`, `'isTargeting'`) that `Model` never emits — `Model.ts` only emits `'change'`. Dimming of untargetable vehicles doesn't update. `CombatModel.targetVehicle():128` hand-emits its own event as a workaround for the same gap.
- **Combat screen rendering bugs** (seen live): card titles render twice (an icon-placeholder label overprints the title, e.g. "RaRamming Speed2"), the hand row overflows the bottom of the viewport, the "Turn N" text and phase banner overlap, the main-menu title is horizontally off-center, and the driver-selection deck preview cards clip through the driver-cycle button.
- **The Electron build is broken** and has been since roughly the start: `webpack.electron.js` merges the web config so the `main` entry becomes the Electron main-process bundle yet is injected into `index.html`, the `renderer` entry is injected nowhere; `electron/main.ts:8` requires `electron-squirrel-startup` which isn't a dependency; `electron/` is excluded from `tsconfig.json` so it's never type-checked; the preload IPC bridge whitelists channels that have no `ipcMain` handlers and nothing in `src/` uses `window.electron`; `electron/forge.config.js` is an orphaned template with placeholder URLs (the project uses electron-builder).
- **Production web deploys ship a development bundle**: `build:web` never sets `NODE_ENV=production`, so webpack builds in `development` mode with `eval-source-map`, and that is what `deploy-sftp.yml` uploads.
- **CI shell injection**: `cleanup-pr.yml:19-21` interpolates `github.head_ref` directly into an SSH shell command; a crafted branch name executes arbitrary commands on the deploy server. `deploy-pr-playtest.yml:38` has the same class of issue in a github-script template literal.
- **`public/cards.json` is a stale fork** of `src/renderer/game/data/cards.json` (missing headshot/ram/oil_slick/etc., contains cards the real file doesn't). The webpack copy of the real file happens to win on the dev server; in other setups the stale one could be served.

### In progress / never built (unfinished, not broken)

- Settings and Credits: buttons exist, click logs "not implemented" (`MainMenuScreen.ts:92,106`).
- Panel scrolling: scrollbars draw but don't scroll; five overflow methods are explicit no-op stubs (`Panel.ts:369-399`). Blocks combat-log scrolling (`CombatLogLayer.ts:248`).
- BattleResultScreen: no battle statistics display, Continue is hard-wired to main menu instead of a reward/map screen (`BattleResultScreen.ts:95,115`).
- Enemy intent display is a hardcoded placeholder (`CombatScreen.ts:417`); per-driver fuel not implemented (`:396`); card detail popup missing (`:536`); hand layer gets a flat card array instead of per-driver grouping (`:376`); card fanning and discard animations missing (`PlayerHandLayer.ts:316-330`).
- Splash fade in/out blocked on component opacity support (`SplashScreen.ts:111`).
- AI types `'defensive'` and `'balanced'` are declared and shown in the simulator UI but silently fall back to RandomAI (`AIController.ts:54-57`).
- Movement cards, enemy wave spawning, status-effect display, card effect previews, map navigation, garage/shop, events, meta-progression, save/load: not started (tracked in the Game feature roadmap epic on Specboard).

## Task tracking: Specboard

As of 2026-08-22 this project's planning lives on Specboard, not in this file: https://specboard.io/projects/6b4e4cdd-15bc-4001-8280-706838168f2e

The board holds six epics migrated from this doc and the survey findings:

- **Security and correctness fixes** — the P0 defects (CI shell injection, dev-mode prod deploys, battle-end double navigation, endCombat never called, dead Model listeners, the Electron decision)
- **Dead code purge** — the zero-risk deletions
- **Toolchain modernization** — Node/ESLint/tsconfig/Jest/webpack/CI/dependency upgrades
- **Code convention cleanup** — constructors, accessors, logging, indentation
- **Combat UI and gameplay debt** — the rendering bugs seen live plus half-built features
- **Game feature roadmap (Game Flow spec)** — map, garage, events, waves, co-op, save/load; each task promotes to its own epic when picked up

AI workers: query and update the board via the Specboard MCP tools (get_items / create_item / update_item). Keep item status accurate in real time; don't recreate task lists in this document. The "Current state" section above is survey context, not a tracker — the board is canonical.

## Project Overview

Wasteland Wheels is a roguelike deckbuilder game with vehicular combat in a post-apocalyptic setting. Core mechanic: "Symbiotic Driver System" where players control two drivers/vehicles simultaneously.

**Tech Stack**: TypeScript, WebGL, Electron (currently broken, see the Security and correctness epic on Specboard), Jest
**Target Audience**: Fans of Slay the Spire, Monster Train, and roguelike deckbuilders

## Design Documents

1. **Game Flow & UI Specification**: https://docs.google.com/document/d/1_upnszasO-9eSIFPNWSSRZaVI2S1Twrncfmia8nd0_o/edit
2. **Card System Design**: https://docs.google.com/document/d/1sxDkXcnRwJJIlJuhzfcxGPifUZILoEGBRVjLpMQJg2s/edit
3. **AI System Technical Design**: https://docs.google.com/document/d/14WuPue2Gqol9Sgk5yZ8XwOQRP2C6Df15y9lPkSPBJUo/edit
4. **Combat System Rules**: https://docs.google.com/document/d/1hgqkxYuYSTBc9UwzbVRdG_Zax52XE2wm4f3d4ITCF5E/edit
5. **Faction Concepts**: https://docs.google.com/document/d/19BvQVuFcwBvIAIsBMRwizA6N2XNISriVatACgtXG0I4/edit
6. **Deckbuilder Mechanics Research**: https://docs.google.com/document/d/1E3Qp0LmnvUZnojtIPwYEEani7meb5YlMZLStoiG_vJU/edit
7. **Software Specification**: https://docs.google.com/document/d/1cJBy1w2YWI0fzmmo7qyMRgg9Xm6t5RO9zpij4y3XwXM/edit

Local copies of several specs live in [docs/specs/](./specs/).

## Code Style Guidelines

- Follow existing TypeScript patterns in codebase
- Use existing component hierarchy where possible
- Maintain separation between data (JSON) and logic (TypeScript classes)
- Include JSDoc comments for public methods
- Write tests for critical systems (card loading, combat logic)
- See root CLAUDE.md for conventions: tabs, named-param constructors, ES6 getters

## Development Progress

For the chronological log of completed tasks, see: [AI Development Log](./AI_DEVELOPMENT_LOG.md)
