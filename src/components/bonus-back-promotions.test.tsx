import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it } from 'vitest'
import { BonusBackPromotionBadge, BonusBackPromotions } from './bonus-back-promotions'

it('renders the normal homepage content without waiting for promotion confirmations', () => {
  const markup = renderToStaticMarkup(createElement(BonusBackPromotions, { races: [] },
    createElement('main', null, 'Predictions', createElement(BonusBackPromotionBadge, { raceId: 'race' }))))

  expect(markup).toContain('<main>Predictions</main>')
  expect(markup).not.toContain('Loading confirmations')
  expect(markup).not.toContain('Promotion confirmations unavailable')
})
