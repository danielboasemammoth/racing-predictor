/**
 * Harville (1973): derives place probabilities for a race field from win probabilities alone -
 * the standard technique for estimating a place market when only win probabilities are known,
 * without fabricating new data. `paidPlaces` must reflect how many finishing positions actually
 * pay a place dividend for this field (see src/lib/betting/place-rules.ts) - it is NOT always 3
 * (e.g. AU greyhound racing standardly pays only 1st-2nd, verified live) - passing the wrong count
 * silently overprices the place market.
 */
export function harvillePlaceProbabilities(winProbabilities: number[], paidPlaces: 1 | 2 | 3): number[] {
  const n = winProbabilities.length
  if (n === 0) return []
  if (n <= paidPlaces) return winProbabilities.map(() => 1) // whole field places when the field is no bigger than the number of paid places
  if (paidPlaces === 1) return winProbabilities.slice()

  return winProbabilities.map((pi, i) => {
    let secondProb = 0
    let thirdProb = 0
    for (let j = 0; j < n; j++) {
      if (j === i) continue
      const pj = winProbabilities[j]
      if (pj >= 1) continue
      secondProb += pj * (pi / (1 - pj))

      if (paidPlaces === 3) {
        for (let k = 0; k < n; k++) {
          if (k === i || k === j) continue
          const pk = winProbabilities[k]
          const remaining = 1 - pj - pk
          if (remaining <= 1e-9) continue
          thirdProb += pj * (pk / (1 - pj)) * (pi / remaining)
        }
      }
    }
    return Math.min(1, Math.max(0, pi + secondProb + thirdProb))
  })
}
