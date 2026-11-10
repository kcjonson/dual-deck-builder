# Abandoning a run: leaving a fight forfeits it

## Date
2026-11-09

## Context

The battle menu offered Keep fighting and Main menu, and Main menu left the fight unsaved, so Continue started it again from its first turn (call 65). Quitting the game did the same. A fight going badly could be retried that way as often as the player liked. The TypeScript's battle menu had one item, Abandon the run, which ended the fight lost (`Battle.forfeit`) and failed the run (call 84, [mvp-supply-run.md](./mvp-supply-run.md)). Kevin decided on 2026-11-09 that leaving forfeits, from the menu or by quitting, and the spec has it now ([Compound and Supply Runs](../specs/Compound%20and%20Supply%20Runs.md), A failed run).

## Options considered

Where the forfeit lives:

1. **An action `apply` takes,** ending the fight lost in the battle rules, as `Battle.forfeit` did. The battle would end lost with drivers still aboard, which no end condition means, and how a fight ends would have to know a campaign's run can be given up.
2. **The combat bridge (chosen).** `CampaignFight::abandoned` says the crew gave the fight up, and `writeBackFight` writes it back as a lost fight whatever the battle state says. The fight never ends in the rules; the battle scene hands it back unfinished.

How a quit is caught:

1. **Save the fight,** or the actions played in it, so Continue rebuilds the state the quit left. That's the battle state in the save, or a save on every card played, for the one case of a quit.
2. **A mark on the run (chosen).** `Run::fighting` is set as the fight opens, saved before the battle shows, and cleared by the write-back. Continue that finds it rebuilds the fight from the same seed, which `nextFightSeed` already made the same fight, and abandons it at its opening.

## Decision

**What it costs** is a lost fight's cost, as the TypeScript had it. Whoever's still alive flees and is missing, as a driver who crashed out with nobody to pick them up is, carrying the HP and the damage the fight left; whoever's down is dead and takes their run deck; the cargo, the cards won, everyone the run found, and every escort that came along are lost; the run counts as failed; and the campaign ends when nobody is left at the compound. The run scene ends the day after it, as after any failed run (call 64). The log says "A run was abandoned: Road Warrior 1 is dead and Interceptor 1 is missing." where a lost run's says "A run was lost:", then the same cargo line. `RunLost::abandoned` carries it to the debrief.

**The menu.** Its key and Escape open "Abandon the run?" over the fight, Keep fighting first and focused, Abandon the run beside it, and above them what it costs: who flees, who's down and dies, the cargo and the escorts lost with the run, who it found stays missing, and that the day ends or, for the compound's last drivers, the campaign. The scene works it out by writing the fight back abandoned on a copy of the campaign, so the warning and the write-back can't disagree. Escape's order is as it was: a drag, a waiting card, an open log, then the menu. Abandon the run hands the fight to the run marked abandoned, the run writes it back through `endRunFight`, and the debrief opens, "Abandoned on the road to Millbrook", its story starting "The crew abandoned the fight." (call 88).

**The save.** `beginRunFight` builds the fight and marks the run fighting, and the run scene saves before it pushes the battle. The JSON writes `fighting` only while it's set and reads it as optional, so a save made outside a fight is what it was, a save from before reads as no fight in progress, which is what it meant, and `kSaveVersion` stays 6. The reader refuses the mark on a run that hasn't left. The run scene entered with the mark set, from Continue through the loading scene or from the menu holding the session already, calls `abandonFightInProgress`, then ends the day and opens the debrief.

## Rationale

The bridge is where a fight's result turns into the campaign's, and an abandoned fight's result is the campaign's only: the battle has nothing to do but stop. A flag on the fight it hands back keeps one path from the battle scene to the debrief, the one a lost fight already takes. The mark costs one field, written only while it's set, against a fight state no save has held.

## Consequences

- A quit gives the fight up at its opening, since the save doesn't hold the fight: every seat flees with what they went in with, so a driver down when the game quit goes missing rather than dying, and the fight's damage is undone. The run is lost either way, so a quit can't retry a fight, but it can spare a downed driver. Closing that means saving the fight or its actions.
- A save made mid-fight by this build doesn't load in a build from before it, which refuses the field it doesn't read and calls the save damaged rather than another format.
- There's no Main menu or Settings in the fight any more: the way out of a fight is through it or forfeiting the run.
- A fight the bridge didn't build, the battle tests' bare one with no run out, is still handed back abandoned, and its warning is the general one.
