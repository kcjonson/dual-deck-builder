#!/usr/bin/env bash
# R14.5's provenance gate, run by visual.yml's baseline-provenance job on a
# pull request: every screenshot baseline the branch changes has to have been
# set last by the Visual workflow's own mint commit.
#
#   scripts/check-baseline-provenance.sh <base-ref>     e.g. origin/main
#
# Per file, not per commit: a merge of the base branch that brings the base's
# own new baselines is TREESAME only to its base-side parent, which the range
# excludes, so a whole-directory log would list that merge as if it had minted
# them. A file only the base changed is not in the diff at all; a merge that
# hand-edits a file the branch does change is that file's last setter and is
# caught.
#
# The last setter has to be the mint commit exactly: author and committer
# github-actions[bot] and the subject the mint job writes, compared whole. A
# substring match on the marker let `git revert` of a mint through, whose
# subject is 'Revert "Update screenshot baselines [visual-baseline]"' and whose
# content is whatever the mint replaced. This authenticates nothing (an author
# and a subject can be typed); it stops the accident, and the Screenshots job
# comparing against the CI render is the backstop behind it.
set -euo pipefail

BASE="${1:?usage: check-baseline-provenance.sh <base-ref>}"
BASELINES='tests/visual/__screenshots__'
BOT='github-actions[bot] <github-actions[bot]@users.noreply.github.com>'
MINT_SUBJECT='Update screenshot baselines [visual-baseline]'

# Two dots for the log, three for the diff: the diff wants the merge base, the
# log wants the commits this branch adds on top of it.
changed=$(git diff --name-only "$BASE...HEAD" -- "$BASELINES")
if [ -z "$changed" ]; then
	echo "No baseline files touched."
	exit 0
fi
echo "Baseline files touched by this pull request:"
echo "$changed"

offenders=""
while IFS= read -r file; do
	last=$(git log -1 --format='%H%x09%an <%ae>%x09%cn <%ce>%x09%s' "$BASE..HEAD" -- "$file")
	IFS=$'\t' read -r sha author committer subject <<<"$last" || true
	if [ "${author:-}" != "$BOT" ] || [ "${committer:-}" != "$BOT" ] || [ "${subject:-}" != "$MINT_SUBJECT" ]; then
		offenders="${offenders}${file}: ${sha:-no commit} ${author:-} \"${subject:-}\""$'\n'
	fi
done <<<"$changed"

if [ -n "$offenders" ]; then
	echo
	echo "R14.5: screenshot baselines are produced by the CI runner image only."
	echo "These files were last set by a commit other than the Visual workflow's mint:"
	echo "$offenders"
	echo "Run the Visual workflow with update_baselines=true on this branch instead."
	exit 1
fi
echo "Every changed baseline was last set by the Visual workflow's mint."
