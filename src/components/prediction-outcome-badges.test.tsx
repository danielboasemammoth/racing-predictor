import { expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { PredictionOutcomeBadges } from './prediction-outcome-badges'

const predictions = ['first', 'second', 'third'].map((horse_id, index) => ({ horse_id, predicted_position: index + 1 }))
const entries = predictions.map(horse => ({ horse_id: horse.horse_id, finishing_position: horse.predicted_position }))

it('shows all three exact matches and podium hits', () => {
  const html = renderToStaticMarkup(<PredictionOutcomeBadges predictions={predictions} entries={entries} />)
  expect(html).toContain('Winner predicted correctly')
  expect(html).toContain('2nd place predicted correctly')
  expect(html).toContain('3rd place predicted correctly')
  expect(html).toContain('Podium hits: 3/3')
})

it('distinguishes unordered podium hits from exact second and third positions', () => {
  const swapped = [entries[0], { ...entries[1], finishing_position: 3 }, { ...entries[2], finishing_position: 2 }]
  const html = renderToStaticMarkup(<PredictionOutcomeBadges predictions={predictions} entries={swapped} />)
  expect(html).toContain('Winner predicted correctly')
  expect(html).toContain('2nd place missed')
  expect(html).toContain('3rd place missed')
  expect(html).toContain('Podium hits: 3/3')
})

it('handles dead heats by ID and excludes scratched runners', () => {
  const results = [{ horse_id: 'other', finishing_position: 1 }, entries[0], { ...entries[1], status: 'scratched' }, entries[2]]
  const html = renderToStaticMarkup(<PredictionOutcomeBadges predictions={predictions} entries={results} />)
  expect(html).toContain('Winner predicted correctly')
  expect(html).not.toContain('2nd place')
  expect(html).toContain('Podium hits: 2/3')
})

it('shows a missed winner without manufacturing missing finishing positions', () => {
  const html = renderToStaticMarkup(<PredictionOutcomeBadges predictions={predictions} entries={[{ horse_id: 'other', finishing_position: 1 }]} />)
  expect(html).toContain('Winner missed')
  expect(html).not.toContain('2nd place')
  expect(html).not.toContain('3rd place')
  expect(html).toContain('Podium hits: 0/3')
})

it('omits badges when predictions or results are absent', () => {
  expect(renderToStaticMarkup(<PredictionOutcomeBadges predictions={[]} entries={entries} />)).toBe('')
  expect(renderToStaticMarkup(<PredictionOutcomeBadges predictions={predictions} entries={[]} />)).toBe('')
  expect(renderToStaticMarkup(<PredictionOutcomeBadges predictions={predictions} entries={[{ horse_id: 'first', finishing_position: null }]} />)).toBe('')
})