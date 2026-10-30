# Wasteland Wheels docs

Wasteland Wheels is a roguelike deckbuilder with vehicular combat in a post-apocalyptic setting. The core mechanic is the "Symbiotic Driver System": the player controls two drivers and their vehicles at once.

It started as a TypeScript proof of concept, now frozen under [_legacy/](../_legacy/). The C++ version on the salal engine is the early alpha. These docs describe the game as it should be; the alpha keeps what worked in the concept and changes what should change, with no compatibility of any kind with the TypeScript build.

Work, status and progress are tracked on Specboard, not in this repo.

## Design specs

The specs in [specs/](./specs/) say how the game plays and looks:

1. [Compound and Supply Runs](./specs/Compound%20and%20Supply%20Runs.md)
2. [Area Map Generation](./specs/Area%20Map%20Generation.md)
3. [Runs and Encounters](./specs/Runs%20and%20Encounters.md)
4. [Balance Simulation](./specs/Balance%20Simulation.md)
5. [Battle Screen Design](./specs/Battle%20Screen%20Design.md)
6. [Combat Rules](./specs/Combat%20Rules.md)
7. [Card System Design](./specs/Card%20System%20Design.md)
8. [Game Flow and UI Specification](./specs/Game%20Flow%20and%20UI%20Specification.md)
9. [Gameplay Mechanics and Style](./specs/Gameplay%20Mechanics%20and%20Style.md)
10. [AI System Technical Design](./specs/AI%20System%20Technical%20Design.md)
11. [Faction Concepts](./specs/Faction%20Concepts.md)
12. [UI Art Direction](./specs/UI%20Art%20Direction.md)
13. [Playtest distribution](./specs/playtest-distribution.md)

## Everything else

- [AI_TECHNICAL_DECISIONS/](./AI_TECHNICAL_DECISIONS/README.md): one record per decision about how the game works, indexed by area.
- [gameplay-calls.md](./gameplay-calls.md): the provisional gameplay calls made so work isn't blocked, numbered, each pending until Kevin approves or changes it. None goes into a spec until approved.
- [technical/](./technical/): how the C++ game is built and worked on: the port plan and the `/debug` protocol.
- [ui-rendering-spec/](./ui-rendering-spec/README.md): the backend-agnostic UI rendering specification salal's `ui` is decided against, rule by rule (rules cited as R3.14).
- [design/](./design/): mocks, wireframes and art the specs embed.
- [research/](./research/README.md): genre research, comparable games and naming.
- [testing/](./testing/README.md): the testing strategy.
- [_legacy/docs/](../_legacy/docs/): the TypeScript engine's decision records, the old dev log and hub, and the spec's resolved reviews, kept for history.
