# Combat log content: the record and the player's line

Date: 2026-10-02. Tickets: DDB-140, DDB-123 (epic DDB-127).

## Context

The combat log drawer showed whatever `Battle` logged. That log is the simulator's and the tests' record: it dumps both teams' hands and status at the start of each turn ("=== ENEMY TEAM HANDS ==="), tags drivers with their seat ("Player1 The Road Warrior"), and appends before-and-after numbers ("(Structure: 30/30 -> 24/30, Armor: 5/5 -> 0/5)"). The screen also logged card plays and turn changes on its own, so some events appeared twice, and two layers each added a driver prefix ("[Driver 1] [D1] played ..."). Battle Screen Design section 8 wants log lines that read as prose, wrap in a 320 px drawer, and carry one prefix.

About a hundred tests assert the record's exact wording, the AI evaluator and the battle simulator read it, and the enemy turn is being rebuilt in parallel (DDB-112), so rewriting the record was not an option.

## Options

1. Rewrite Battle's messages as player prose. Breaks the record's consumers and collides with DDB-112.
2. Clean the record in the log model with regular expressions (strip seat tags and parentheticals). Brittle: a new message shape slips through silently.
3. Keep the record and let each message carry the player's version where it differs, with the record-only lines typed so the screen can leave them out.

## Decision

Option 3.

- `BattleMessage.line` is the player's line when it differs from `message`. Producers build the line first and append the record's detail to it, so the two can't drift: `damage_dealt`, heals, armor, shield, statuses with a speed change, adrenaline gains, card plays, deaths, seat changes, draws, burned cards, and escort dividends.
- A new `debug` type marks the team status and hand dumps. They stay in `getMessages()`.
- `CombatLog.addBattleMessage` maps each message type to a log type or to nothing. Nothing for `debug`, `battle_start` (the screen names the matchup), `turn_start` and `turn_end` (the screen logs "Your turn" and "The raiders' turn" once each), and `adrenaline_remaining` (End Turn warns before it happens).
- The turn is the one prefix, drawn in the drawer as a mono tag beside the wrapping text. Entries no longer carry a driver; the line names whoever acted, by driver name for your plays and by vehicle name for a raider's, since the vehicle is what the road shows.
- The log keeps 100 lines now that the drawer scrolls.

## Consequences

- A new Battle message that has seat tags or stat dumps needs a `line`, or the player sees the record. The CombatLog test plays a turn and fails on any line with a seat tag, a stat dump, or a debug header, which catches the common cases.
- Rejected plays ("Cannot play card: ...") still reach the log as `general` lines. They are player-facing and the screen guards most of them anyway.
- The menu button draws disabled: no pause menu exists yet, and inventing one was out of scope. It was filed as DDB-264. The wave group shows wave 1 of 1 until reinforcement waves exist (Combat Rules: "once there is one").
- F6 stays as an undocumented alias for L, for playtesters who learned it before the top bar had a LOG key.
