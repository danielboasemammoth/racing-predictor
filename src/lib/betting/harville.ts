/**
 * Harville (1973): derives place (top-3) probabilities for a race field from win probabilities
 * alone - the standard technique for estimating a place market when only win probabilities are
 * known, without fabricating new data. Does not model the exact number of paid places for a
 * given field size (TAB typically pays 2 places for smaller fields, 3 for 8+) - always computes
 * a top-3 probability; treat as an approximation of the place market, not its exact terms.
 */
export function harvilleTop3Probabilities(winProbabilities: number[]): number[] {
  const n = winProbabilities.length
  if (n === 0) return []
  if (n <= 3) return winProbabilities.map(() => 1) // whole field places when there are 3 or fewer runners

  return winProbabilities.map((pi, i) => {
    let secondProb = 0
    let thirdProb = 0
    for (let j = 0; j < n; j++) {
      if (j === i) continue
      const pj = winProbabilities[j]
      if (pj >= 1) continue
      secondProb += pj * (pi / (1 - pj))

      for (let k = 0; k < n; k++) {
        if (k === i || k === j) continue
        const pk = winProbabilities[k]
        const remaining = 1 - pj - pk
        if (remaining <= 1e-9) continue
        thirdProb += pj * (pk / (1 - pj)) * (pi / remaining)
      }
    }
    return Math.min(1, Math.max(0, pi + secondProb + thirdProb))
  })
}
