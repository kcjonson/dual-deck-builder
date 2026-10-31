# The rules core, opponents, and content packs

## Date
2026-10-30

## Context

The C++ alpha needs a shape for the game's rules and its AI before the first module ports, and Kevin wants two things the TypeScript never planned for: mods and expansions, and each opponent its own thing.

What the TypeScript does:

- Cards are data. `cards.json` holds about 50 cards built from about 11 effect types (damage, apply_status, change_position, draw, shield, resource, heal, armor, draw_fire), plus named conditions and bonuses ([movement-cards.md](./movement-cards.md)). A switch in `Battle.ts` resolves them.
- What an effect means is worked out again in every place that needs it: the battle, `BoardProjection`, `AimPreview`, intents, movement, the card validator, and the AIs, each with its own switch on effect types. movement-cards.md lists the cost.
- One AI strategy plans for the whole enemy team, set per fight (`CombatBridge`'s `enemyAI`), from eight hardcoded classes. Raiders differ by vehicle, deck, and a looter or killer target preference.
- `MCTSAI` scores single plays with UCB1 over a heuristic and never plays a battle out, since the TypeScript state can't be copied cheaply.

salal has no scripting runtime and keeps Lua out of its dependencies (salal `docs/extraction.md`). Worldsim hosts Lua 5.4 through sol2, for its asset generators only.

"Mods" already means Vehicle Mods, the game's relics, so the content mechanism is called packs.

## Options considered

1. **Port the shape as it is.** Effects as data with a C++ interpreter, one strategy per fight from a fixed list.
   - Pros: the least work.
   - Cons: keeps the duplicated effect logic; mods reach only what data can say; opponents stay interchangeable.
2. **Script everything.** Every card and every opponent is a Lua script.
   - Pros: mods can do anything the base game does.
   - Cons: the base game pays the scripting cost for the rare card that needs it; every preview, projection, and AI estimate depends on scripts behaving; slower inside a search; bugs cross a language boundary.
3. **Data first, C++ building blocks, Lua as the escape hatch, all content in packs (chosen).**

## Decision

**The battle is a value.** `BattleState` holds vehicles, drivers, decks, the road grid, statuses, and the fight's randomness. Objects refer to each other by id, not pointer, so copying the whole fight is cheap.

**Randomness is counters, not live streams.** salal's `foundation::Rng` can't be copied, on purpose (a copy would replay its stream), so a state that copies can't hold one. It holds `RandomStreams` instead: a root seed and how many events each named stream has had. Each random event, a shuffle or a hit check, gets its own `Rng` forked from the seed by the stream's name and that count, so a copy draws exactly what the original would, and streams never move each other.

**The rules are two functions.** `legalActions(state)` lists what can be done; `apply(state, action)` does it and returns the events it caused. It's deterministic, and it's the only place effects are interpreted. The planning projection, the aim preview, and the AI's lookahead are `apply` on a copy, reading the events back.

**Effects are parsed once.** Card JSON becomes a typed `std::variant` of effects at load, and an unknown effect, field, or condition fails the load naming the file. A card whose logic data can't say names a script; the script reads a read-only view of the fight and emits the same basic operations data effects use (damage, move, apply a status, draw), which `apply` executes. A script never changes the state itself, so events, previews, and determinism stay in one place.

The card format is the TypeScript's, tidied so it can be read strictly: fields in camelCase, a condition with a parameter written as an object (`{"type": "caster_row", "row": "ahead"}`), a bonus as `{"value", "condition"}`, a ram's formula as numbers instead of a string matched by substring, and `"duration": "fight"` instead of -1.

**Each opponent is its own folder** in a pack, `packs/base/opponents/scav_bike/`, named for its id: an `opponent.json` (class, skills, vehicle, deck, intent tier, target preference) and its behavior. The behavior names a C++ policy and its weights (the personalities in [AI System Technical Design](../specs/AI%20System%20Technical%20Design.md)), or a `behavior.lua`. Every raider plans with its own behavior; nothing is set per fight.

**A behavior is a policy:** `choose(view, legalActions, rng)` returns an action, and may play candidates out on copies of the fight. The balance sim's player stand-ins are policies too.

**Content is packs.** The base game is `packs/base/`; an expansion or a mod is another pack. A pack has a manifest, `pack.json` (id, name, version, the packs it requires), and folders for cards, drivers, escorts, opponents, encounters, factions, events, the map, the campaign, art, and scripts. Cards, drivers, escorts, and encounters are arrays in any number of `.json` files in their folder. Packs load in order and add content or override it by id. A pack can only override content from a pack it requires, directly or through another, so two packs overriding the same id without one requiring the other fails the load, naming both. Every reference between content (a deck's cards, an escort's signature card) has to resolve once all packs are in. The TypeScript's data files move into `packs/base/`.

**Lua is hosted by the game**, Lua 5.4 through sol2 as worldsim does, in its own library. The rules define the script interfaces and never depend on Lua; the scripting library implements them and the app wires them up. Scripts get Lua's base, table, string, and math libraries, without `math.random`, `io`, `os`, or loading files outside their pack. Randomness comes in through the game's RNG, and game numbers are integers, so seeds reproduce.

**Libraries:**

- `libs/rules`: the state, `apply`, effects, the pack loader, map generation, and the campaign. Links `salal::foundation` only.
- `libs/ai`: the policies. It depends on the rules, and the rules never depend on it.
- `libs/scripting`: the Lua host. It depends on the rules, and the rules never depend on it.

## Rationale

Every card today is data, and keeping the base game in data keeps it fast, inspectable, and testable without a script runtime in the loop. One interpreter ends the duplicated effect logic. A fight that's cheap to copy lets the preview and the AI play moves out instead of re-deriving them, and that is also what makes scripts safe for the AI: it never has to read a script, only run it on a copy.

Packs make expansions and mods one mechanism from the first module, which costs little now and a great deal to retrofit once content assumes one folder. Lua lets a modder add logic the game doesn't have without a compiler, while the base game stays in C++.

## Consequences

- The Lua host is its own step, built when the first card or opponent needs it or before mod support, whichever comes first. Until then, logic that data can't say becomes a new C++ building block.
- A mod can only emit operations the game has; a new kind of operation needs a game update.
- A scripted behavior is slower than a C++ one inside a search, so a script opponent may get less lookahead.
- The pack format becomes a contract the day mods ship. Until then it changes freely, as everything in the alpha does.
- A save names the packs it was made with, and loading one whose packs are missing fails loud.
- How mods are distributed, installed, or trusted is open, and out of scope until mod support is planned.
- AI System Technical Design's per-fight strategy is replaced by per-opponent behavior, and the spec says so.
