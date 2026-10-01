import { expect, it } from 'vitest'
import { bestRacingComOdds, racingComProviderLabel } from './racing-com-odds'

it('distinguishes verified provider products from unmapped codes and missing attribution', () => {
  expect(racingComProviderLabel('SB2')).toBe('Sportsbet (SB2)')
  expect(racingComProviderLabel('BTOTE')).toBe('Sportsbet BT+ WIN (BTOTE)')
  expect(racingComProviderLabel('BTOTESP_PB3')).toBe('PointsBet BT+SP (BTOTESP_PB3)')
  expect(racingComProviderLabel('BTOTESP')).toBe('Unmapped Racing.com code: BTOTESP')
  expect(racingComProviderLabel('toString')).toBe('Unmapped Racing.com code: toString')
  expect(racingComProviderLabel()).toBe('Provider not recorded')
})

it('retains the provider of the best price independently for each market', () => {
  expect(bestRacingComOdds({ sectional_times: { odds: [
    { provider: 'provider-a', win: 5, place: 2 },
    { provider: 'provider-b', win: 4, place: 3 },
  ] } })).toEqual({ win: 5, place: 3, winProvider: 'provider-a', placeProvider: 'provider-b' })
})

it('does not attribute an unlabelled best price to a lower-priced named provider', () => {
  expect(bestRacingComOdds({ sectional_times: { odds: [
    { provider: 'known', win: 4 }, { win: 5 },
  ] } })).toEqual({ win: 5, winProvider: undefined })
})

it('keeps the first provider on equal prices and preserves empty metadata behavior', () => {
  expect(bestRacingComOdds({ sectional_times: { odds: [{ provider: 'first', win: 5 }, { provider: 'second', win: 5 }] } }).winProvider).toBe('first')
  expect(bestRacingComOdds({ sectional_times: null })).toEqual({})
})