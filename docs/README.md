# Wasteland Wheels docs

Wasteland Wheels is a roguelike deckbuilder with vehicular combat in a post-apocalyptic setting. The core mechanic is the "Symbiotic Driver System": the player controls two drivers and their vehicles at once. TypeScript and WebGL, shipped for the web and as an Electron desktop app.

Work, status, and progress are tracked on Specboard, not in this repo: https://specboard.io/projects/6b4e4cdd-15bc-4001-8280-706838168f2e

## Design specs

The specs in [specs/](./specs/) are the source of truth for how the game plays and looks:

1. [Compound and Supply Runs](./specs/Compound%20and%20Supply%20Runs.md)
2. [Area Map Generation](./specs/Area%20Map%20Generation.md)
3. [Battle Screen Design](./specs/Battle%20Screen%20Design.md)
4. [Combat Rules](./specs/Combat%20Rules.md)
5. [Card System Design](./specs/Card%20System%20Design.md)
6. [Game Flow and UI Specification](./specs/Game%20Flow%20and%20UI%20Specification.md)
7. [Gameplay Mechanics and Style](./specs/Gameplay%20Mechanics%20and%20Style.md)
8. [AI System Technical Design](./specs/AI%20System%20Technical%20Design.md)
9. [Faction Concepts](./specs/Faction%20Concepts.md)
10. [UI rendering engine implementation](./specs/ui-rendering-engine-implementation.md)

## Everything else

- [AI_TECHNICAL_DECISIONS/](./AI_TECHNICAL_DECISIONS/): one record per architectural decision, with the context, the options, and why one won.
- [ui-rendering-spec/](./ui-rendering-spec/README.md): the backend-agnostic UI rendering specification the engine implements (rules cited as R3.14).
- [design/](./design/): mocks and wireframe screenshots the specs embed.
- [research/](./research/README.md): genre research, comparable games, naming, and the first spec draft.
- [AI_DEVELOPMENT_LOG.md](./AI_DEVELOPMENT_LOG.md) and [AI_DEVELOPMENT_HUB.md](./AI_DEVELOPMENT_HUB.md): deprecated and frozen. The old in-repo work log and status hub, kept for history; Specboard replaced both.
