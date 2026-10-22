// WHAT:     the motivation-score pill markup in one place.
// WHY:      it was a private function at the bottom of app/data/page.tsx;
//           REPO_MAP §7.2 names the pill as a three-copy dedupe target, and
//           the /listing/[id] page shows the same pill — so it is a real
//           component now (REFACTOR_PLAN §5 Phase 3). Markup is verbatim.
// INPUTS:   a motivation score.
// OUTPUTS:  the coloured pill span — palette and foreground from lib/scores.
// CALLERS:  app/data/page.tsx, app/listing/[id]/page.
//
// NOTE: the map legend chips and the SideCard header badge are deliberately
// NOT this component: the legend is text-only and the card badge is not
// pill-shaped, so unifying them would change rendered markup.
// Verified by: NOTHING (gap) — nothing diffs the legend/badge markup against
//   this pill; the split is a deliberate call, not a checked invariant.

import type { MotivationScore } from "@/lib/api-types";
import { SCORE_COLORS, SCORE_PILL_TEXT } from "@/lib/scores";

export default function ScorePill({ score }: { score: MotivationScore }) {
  return (
    <span
      className="inline-block rounded-full px-2 py-0.5 text-xs font-medium"
      style={{ background: SCORE_COLORS[score], color: SCORE_PILL_TEXT[score] }}
    >
      {score}
    </span>
  );
}
