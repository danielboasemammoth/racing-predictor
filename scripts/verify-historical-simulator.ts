import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright'
import type { SimulationRace } from '../src/lib/betting/historical-simulator'
import { SIMULATION_PREFERENCES_KEY } from '../src/lib/betting/simulation-preferences'

const baseUrl = process.argv[2] ?? 'http://localhost:3021'
assert.ok(['localhost', '127.0.0.1'].includes(new URL(baseUrl).hostname), 'Use a local preview only')
const models = ['test-alpha', 'test-beta']
const races: SimulationRace[] = Array.from({ length: 30 }, (_, index) => ({
  id: `test-race-${index}`, start: new Date(Date.UTC(2026, 8, 20, 1) + index * 3600000).toISOString(),
  settledAt: new Date(Date.UTC(2026, 8, 20, 1, 10) + index * 3600000).toISOString(),
  venue: 'TEST DATA Flemington', state: 'VIC', number: index + 1, fieldSize: 8,
  selections: models.flatMap(model => Array.from({ length: 3 }, (_, rank) => ({
    id: `test-${model}-${rank}`, horse: `TEST Runner ${rank + 1}`, model, rank: rank + 1,
    predictedAt: '2026-09-19T00:00:00Z', winProbability: 0.4, top3Probability: rank === 2 ? 0.5 : 0.7,
    reliability: null, winOdds: 3, placeOdds: 2, winSource: 'tab' as const, placeSource: 'tab' as const,
    position: rank + 1, scratched: false, winIssue: null, placeIssue: null,
  }))),
})).reverse()
const manifest = {
  schema: 1, generatedAt: '2026-09-26T00:00:00Z', models,
  chunks: [`simulator/v1/${'a'.repeat(64)}.json`],
  races: races.map(race => ({ id: race.id, fingerprint: 'test' })),
}

async function main() {
  const browser = await chromium.launch({ channel: 'msedge', headless: true })
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true })
    let reportRequests = 0
    let reportStatus = 200
    const blockedRequests: string[] = []
    await context.route('**/*', async route => {
      const url = new URL(route.request().url())
      if (url.pathname.includes('/storage/v1/object/public/racing-reports/')) {
        reportRequests++
        return route.fulfill({ status: reportStatus, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(url.pathname.endsWith('manifest.json') ? manifest : races) })
      }
      if (url.searchParams.has('_rsc')) return route.abort()
      if (url.origin !== new URL(baseUrl).origin || url.pathname.startsWith('/api/')) {
        blockedRequests.push(url.origin + url.pathname)
        return route.abort()
      }
      return route.continue()
    })
    const page = await context.newPage()
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    await page.goto(`${baseUrl}/paper-betting`)
    const waitForCount = (count: number) => page.getByText(`Filtered bets (${count})`, { exact: true }).waitFor()
    const results = () => page.getByRole('region', { name: 'Simulation results', exact: true }).innerText()
    await waitForCount(240)
    assert.equal(await page.getByLabel('Completed races', { exact: true }).inputValue(), '500')
    assert.match(await results(), /75\.0%/)
    assert.match(await results(), /\$1,800\.00/)
    assert.equal(reportRequests, 2)
    await page.getByRole('checkbox', { name: 'WIN', exact: true }).uncheck()
    await waitForCount(120)
    await page.getByLabel('Flat stake', { exact: true }).fill('5')
    await page.getByLabel('PLACE predicted rank', { exact: true }).selectOption('1')
    await waitForCount(60)
    assert.match(await results(), /\$300\.00/)
    assert.match(await results(), /100\.0%/)
    const beforePagination = await results()
    await page.getByRole('button', { name: 'Next page', exact: true }).click()
    await page.getByText('Page 2 of 2', { exact: true }).waitFor()
    assert.equal(await results(), beforePagination)
    const downloadPromise = page.waitForEvent('download')
    await page.getByRole('button', { name: 'Export all filtered bets', exact: true }).click()
    const download = await downloadPromise
    const stream = await download.createReadStream()
    assert.ok(stream)
    const csvChunks: Buffer[] = []
    for await (const chunk of stream) csvChunks.push(Buffer.from(chunk))
    assert.equal(Buffer.concat(csvChunks).toString('utf8').split('\r\n').length, 61)
    await page.getByLabel('PLACE model', { exact: true }).selectOption('test-alpha')
    await waitForCount(30)
    await page.getByLabel('Starting bankroll per model', { exact: true }).fill('100')
    await page.getByRole('region', { name: 'Model comparison' }).getByText('$250.00', { exact: true }).waitFor()
    await page.getByLabel('Staking method', { exact: true }).selectOption('percent')
    assert.equal(await page.getByLabel('Flat stake', { exact: true }).isDisabled(), true)
    await page.getByLabel('PLACE reliability', { exact: true }).selectOption('10')
    await waitForCount(0)
    await page.getByRole('button', { name: 'Reset PLACE filters', exact: true }).click()
    await waitForCount(120)
    await page.getByLabel('Completed races', { exact: true }).selectOption('100')
    assert.equal(reportRequests, 2, 'Filters, staking, pagination and export must stay local')
    await page.getByLabel('WIN edge', { exact: true }).selectOption('10')
    await page.getByLabel('PLACE top-three probability', { exact: true }).selectOption('60')
    await page.getByLabel('PLACE venue', { exact: true }).selectOption('TEST DATA Flemington')
    await page.getByLabel('PLACE model', { exact: true }).selectOption('test-alpha')
    await page.getByLabel('Sort results', { exact: true }).selectOption('edge')
    await waitForCount(60)
    await page.waitForFunction(key => JSON.parse(window.localStorage.getItem(key) ?? '{}').sort === 'edge', SIMULATION_PREFERENCES_KEY)
    const saved = await page.evaluate(key => window.localStorage.getItem(key), SIMULATION_PREFERENCES_KEY)
    const filteredResults = await results()
    await page.reload()
    await waitForCount(60)
    assert.equal(await results(), filteredResults)
    assert.equal(await page.evaluate(key => window.localStorage.getItem(key), SIMULATION_PREFERENCES_KEY), saved)
    for (const [label, expected] of [['Completed races', '100'], ['Starting bankroll per model', '100'], ['Flat stake', '5'], ['Staking method', 'percent'], ['WIN edge', '10'], ['PLACE top-three probability', '60'], ['PLACE model', 'test-alpha'], ['PLACE venue', 'TEST DATA Flemington'], ['Sort results', 'edge']]) {
      assert.equal(await page.getByLabel(label, { exact: true }).inputValue(), expected)
    }
    assert.equal(await page.getByRole('checkbox', { name: 'WIN', exact: true }).isChecked(), false)
    await page.getByRole('button', { name: 'Reset PLACE filters', exact: true }).click()
    await waitForCount(120)
    await page.reload()
    await waitForCount(120)
    assert.equal(await page.getByLabel('PLACE top-three probability', { exact: true }).inputValue(), '50')
    assert.equal(await page.getByLabel('WIN edge', { exact: true }).inputValue(), '10')
    await mkdir('scripts/output', { recursive: true })
    for (const viewport of [{ name: 'desktop', width: 1440, height: 1000 }, { name: 'mobile', width: 390, height: 844 }]) {
      await page.setViewportSize(viewport)
      await page.evaluate(() => window.scrollTo(0, 0))
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false, `${viewport.name} page overflow`)
      await page.screenshot({ path: `scripts/output/simulator-${viewport.name}.png`, fullPage: false })
    }
    reportStatus = 522
    await page.getByRole('button', { name: 'Refresh report', exact: true }).click()
    await page.getByRole('alert').filter({ hasText: 'Showing the last successfully loaded report' }).waitFor()
    await waitForCount(120)
    reportStatus = 404
    await page.reload()
    await page.getByRole('alert').filter({ hasText: 'No simulator report published yet' }).waitFor()
    reportStatus = 200
    await page.evaluate(key => window.localStorage.setItem(key, '{broken'), SIMULATION_PREFERENCES_KEY)
    await page.reload()
    await waitForCount(240)
    assert.equal(await page.getByLabel('Completed races', { exact: true }).inputValue(), '500')
    await page.evaluate(key => {
      const saved = JSON.parse(window.localStorage.getItem(key)!)
      saved.filters.PLACE.model = 'retired-test-model'
      saved.filters.PLACE.venue = 'Absent test venue'
      window.localStorage.setItem(key, JSON.stringify(saved))
    }, SIMULATION_PREFERENCES_KEY)
    await page.reload()
    await waitForCount(120)
    assert.equal(await page.getByLabel('PLACE model', { exact: true }).inputValue(), 'retired-test-model')
    assert.equal(await page.getByLabel('PLACE venue', { exact: true }).inputValue(), 'Absent test venue')
    const blockedPage = await context.newPage()
    blockedPage.on('pageerror', error => errors.push(error.message))
    await blockedPage.addInitScript(() => {
      Object.defineProperty(window, 'localStorage', { get() { throw new DOMException('Storage blocked', 'SecurityError') } })
    })
    await blockedPage.goto(`${baseUrl}/paper-betting`)
    await blockedPage.getByText('Filtered bets (240)', { exact: true }).waitFor()
    await blockedPage.getByRole('checkbox', { name: 'WIN', exact: true }).uncheck()
    await blockedPage.getByText('Filtered bets (120)', { exact: true }).waitFor()
    await blockedPage.close()
    assert.deepEqual(blockedRequests, [], 'No source-table or betting API calls are expected')
    assert.deepEqual(errors, [])
    console.log('PASS: defaults, bankroll math, local filtering, CSV, pagination ROI, desktop/mobile layout, report failures, saved preferences, persistent resets and corrupt/blocked storage. No live Supabase requests were made.')
  } finally {
    await browser.close()
  }
}

main().catch(error => { console.error(error); process.exitCode = 1 })