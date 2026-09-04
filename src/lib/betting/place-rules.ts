import type { RacingCategory } from '@/lib/puntersedge/types'

/**
 * How many finishing positions actually pay a place dividend, given the racing code and the
 * number of active (non-scratched) starters. This is NOT always 3 - verified live via PuntersEdge
 * results (see /memories/repo/puntersedge-api.md, 2026-09-04): AU greyhound racing standardly pays
 * only 1st-2nd regardless of field size (confirmed on two separate final results, both with 7-8
 * nominated starters), never 3rd or 4th. Horse racing (and harness, assumed to follow the same
 * long-standing industry convention - NOT independently verified against a live harness result)
 * scales with field size: 8+ starters pays 1st-2nd-3rd, 5-7 pays 1st-2nd, 4 or fewer is effectively
 * win-only. Never assume a runner "placed" just because it finished within some fixed top-N of
 * the field without checking this - that was the exact bug behind the wrong PLACE bet
 * settlements fixed in src/app/api/admin/puntersedge/settle/route.ts.
 */
export function paidPlacesCount(category: RacingCategory, activeFieldSize: number): 1 | 2 | 3 {
  if (category === 'greyhound') return activeFieldSize >= 5 ? 2 : 1
  // horse & harness
  if (activeFieldSize >= 8) return 3
  if (activeFieldSize >= 5) return 2
  return 1
}
