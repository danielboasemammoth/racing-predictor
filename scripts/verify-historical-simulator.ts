import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright'
import type { SimulationRace } from '../src/lib/betting/historical-simulator'
import { SIMULATION_PREFERENCES_KEY } from '../src/lib/betting/simulation-preferences'
import { SAVED_STRATEGIES_KEY } from '../src/lib/betting/saved-strategies'
import { TAB_PLACE_TRIAL } from '../src/lib/betting/tab-place-research'

const baseUrl = process.argv[2] ?? 'http://localhost:3021'
assert.ok(['localhost', '127.0.0.1'].includes(new URL(baseUrl).hostname), 'Use a local preview only')
const models = ['test-alpha', 'test-beta']
const races: SimulationRace[] = Array.from({ length: 30 }, (_, index) => ({
  id: `test-race-${index}`, start: new Date(Date.UTC(2026, 8, 20, 1) + index * 3600000).toISOString(),
  settledAt: '2026-10-01T00:00:00Z',
  venue: 'TEST DATA Flemington', state: 'VIC', number: index + 1, fieldSize: 8,
  selections: models.flatMap(model => Array.from({ length: 3 }, (_, rank) => ({
    id: `test-${model}-${rank}`, horse: `TEST Runner ${rank + 1}`, model, rank: rank + 1,
    predictedAt: '2026-09-19T00:00:00Z', winProbability: 0.4, top3Probability: rank === 2 ? 0.5 : 0.7,
    reliability: null, winOdds: 3, placeOdds: 2, winSource: 'tab' as const, placeSource: 'tab' as const,
    tabQuotedAt: new Date(Date.UTC(2026, 8, 20, 0, 58, 30) + index * 3600000).toISOString(),
    tabCapturedAt: new Date(Date.UTC(2026, 8, 20, 0, 59) + index * 3600000).toISOString(),
    position: rank + 1, scratched: false, winIssue: null, placeIssue: null,
  }))),
})).reverse()
for (const selection of races[0].selections.filter(selection => selection.rank === 3)) {
  selection.top3Probability = 0.7
  selection.winIssue = 'Changed field; deductions unverified'
  selection.placeIssue = 'Top-three probability does not match paid places'
}
for (const selection of races[0].selections.slice(0, 2)) {
  selection.winSource = 'racing_com'
  selection.placeSource = 'racing_com'
}
races[0].selections[0].winProvider = 'SB2'
races[0].selections[0].placeProvider = 'PB3'
races[0].decisionSelections = [{ ...races[0].selections[0], winOdds: 5, placeOdds: 3, winProbability: 0.3,
  winSource: 'tab_decision', placeSource: 'tab_decision', evaluatedAt: new Date(Date.parse(races[0].start) - 30 * 60_000).toISOString(),
  tabCapturedAt: new Date(Date.parse(races[0].start) - 30.5 * 60_000).toISOString(),
  tabQuotedAt: new Date(Date.parse(races[0].start) - 31 * 60_000).toISOString() }]
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
    await page.getByRole('region', { name: 'Prospective TAB PLACE research', exact: true }).getByText(/No eligible trial results in this window.*does not identify TAB as its source/).waitFor()
    assert.equal(await page.getByLabel('Completed races', { exact: true }).inputValue(), '500')
    assert.match(await results(), /75\.0%/)
    assert.match(await results(), /\$1,800\.00/)
    assert.match(await results(), /4 excluded \(hidden/)
    assert.equal(await page.getByRole('region', { name: 'Filtered bets', exact: true }).getByText('EXCLUDED', { exact: true }).count(), 0)
    await page.getByRole('columnheader', { name: 'Odds provider', exact: true }).waitFor()
    await page.getByRole('cell', { name: 'Sportsbet (SB2)', exact: true }).waitFor()
    await page.getByRole('cell', { name: 'PointsBet (PB3)', exact: true }).waitFor()
    assert.equal(await page.getByRole('cell', { name: 'Provider not recorded', exact: true }).count(), 2)
    await page.getByLabel('WIN odds source', { exact: true }).selectOption('racing_com')
    await page.getByLabel('PLACE odds source', { exact: true }).selectOption('racing_com')
    await waitForCount(4)
    const providerDownload = page.waitForEvent('download')
    await page.getByRole('button', { name: 'Export all filtered bets', exact: true }).click()
    const providerStream = await (await providerDownload).createReadStream()
    assert.ok(providerStream)
    const providerChunks: Buffer[] = []
    for await (const chunk of providerStream) providerChunks.push(Buffer.from(chunk))
    const providerCsv = Buffer.concat(providerChunks).toString('utf8')
    assert.match(providerCsv, /"Odds provider"/)
    assert.match(providerCsv, /"racing_com","Sportsbet \(SB2\)","3"/)
    assert.match(providerCsv, /"racing_com","PointsBet \(PB3\)","2"/)
    assert.match(providerCsv, /"Provider not recorded"/)
    await page.getByLabel('WIN odds source', { exact: true }).selectOption('')
    await page.getByLabel('PLACE odds source', { exact: true }).selectOption('')
    await waitForCount(240)
    await page.getByLabel('Starting bankroll per model', { exact: true }).fill('50')
    await page.getByLabel('Flat stake', { exact: true }).fill('1')
    await page.getByRole('region', { name: 'Model comparison' }).getByText('$140.00', { exact: true }).first().waitFor()
    assert.match(await results(), /\$240\.00/)
    assert.match(await results(), /\$180\.00/)
    assert.match(await results(), /0 unfunded/)
    await page.getByLabel('Starting bankroll per model', { exact: true }).fill('500')
    await page.getByLabel('Flat stake', { exact: true }).fill('10')
    await page.getByRole('region', { name: 'Model comparison' }).getByText('$1,400.00', { exact: true }).first().waitFor()
    for (const market of ['WIN', 'PLACE']) {
      for (const threshold of [-2, -5, -10, -15, -20]) {
        await page.getByLabel(`${market} edge`, { exact: true }).selectOption({ label: `> ${threshold} pts` })
        assert.equal(await page.getByLabel(`${market} edge`, { exact: true }).inputValue(), String(threshold))
      }
      await page.getByLabel(`${market} edge`, { exact: true }).selectOption('0')
    }
    const expectedReportRequests = process.argv.includes('--development') ? 4 : 2
    assert.equal(reportRequests, expectedReportRequests)
    await page.getByLabel('WIN odds source', { exact: true }).selectOption({ label: 'TAB at decision time' })
    await waitForCount(121)
    await page.getByRole('status').filter({ hasText: '1 of 30 races have frozen decision observations' }).waitFor()
    assert.equal(await page.getByRole('region', { name: 'Filtered bets', exact: true }).getByText('TAB decision', { exact: true }).count(), 1)
    const decisionExportPromise = page.waitForEvent('download')
    await page.getByRole('button', { name: 'Export all filtered bets', exact: true }).click()
    const decisionStream = await (await decisionExportPromise).createReadStream()
    assert.ok(decisionStream)
    const decisionChunks: Buffer[] = []
    for await (const chunk of decisionStream) decisionChunks.push(Buffer.from(chunk))
    const decisionCsv = Buffer.concat(decisionChunks).toString('utf8')
    assert.match(decisionCsv, /Decision time/)
    assert.match(decisionCsv, /tab_decision/)
    assert.match(decisionCsv, /"tab_decision","TAB","5"/)
    assert.ok(decisionCsv.includes(races[0].decisionSelections![0].evaluatedAt!))
    await page.getByLabel('WIN odds source', { exact: true }).selectOption('')
    await waitForCount(240)
    await page.getByRole('button', { name: 'Apply legacy internal WIN policy', exact: true }).click()
    assert.equal(await page.getByLabel('WIN reliability', { exact: true }).inputValue(), '80')
    assert.equal(await page.getByLabel('WIN maximum odds', { exact: true }).inputValue(), '15')
    await page.getByRole('button', { name: 'Reset WIN filters', exact: true }).click()
    await page.getByRole('button', { name: 'Apply legacy internal PLACE policy', exact: true }).click()
    assert.equal(await page.getByLabel('PLACE runner scope', { exact: true }).inputValue(), '0')
    assert.equal(await page.getByLabel('PLACE minimum field size', { exact: true }).inputValue(), '8')
    await page.getByRole('button', { name: 'Reset PLACE filters', exact: true }).click()
    await waitForCount(240)
    await page.getByRole('button', { name: 'Apply historical profit WIN preset', exact: true }).click()
    await waitForCount(240)
    await page.getByLabel('WIN edge', { exact: true }).selectOption('-5')
    await page.getByLabel('WIN odds source', { exact: true }).selectOption('tab_decision')
    await page.getByLabel('Strategy name', { exact: true }).fill('Browser regression strategy')
    await page.getByRole('button', { name: 'Save settings', exact: true }).click()
    await page.getByLabel('WIN edge', { exact: true }).selectOption('10')
    await page.getByLabel('WIN odds source', { exact: true }).selectOption('tab')
    await page.getByRole('button', { name: 'Load saved settings', exact: true }).click()
    assert.equal(await page.getByLabel('WIN edge', { exact: true }).inputValue(), '-5')
    assert.equal(await page.getByLabel('WIN odds source', { exact: true }).inputValue(), 'tab_decision')
    const realPage = await context.newPage()
    realPage.on('pageerror', error => errors.push(error.message))
    await realPage.goto(`${baseUrl}/real-betting`)
    await realPage.getByRole('button', { name: 'Apply as draft', exact: true }).click()
    await realPage.waitForFunction(() => window.localStorage.getItem('real-betting:draft:v1')?.includes('Browser regression strategy'))
    const draft = await realPage.evaluate(() => window.localStorage.getItem('real-betting:draft:v1'))
    assert.ok(draft)
    assert.equal(JSON.parse(draft).strategy.preferences.filters.WIN.minEdge, -5)
    await page.getByLabel('WIN edge', { exact: true }).selectOption('0')
    await page.getByLabel('WIN odds source', { exact: true }).selectOption('')
    assert.equal(await realPage.evaluate(() => window.localStorage.getItem('real-betting:draft:v1')), draft)
    assert.equal(JSON.parse((await page.evaluate(key => window.localStorage.getItem(key), SAVED_STRATEGIES_KEY))!)[0].preferences.filters.WIN.minEdge, -5)
    const configDownloadPromise = realPage.waitForEvent('download')
    await realPage.getByRole('button', { name: 'Export runner config', exact: true }).click()
    const configDownload = await configDownloadPromise
    const configStream = await configDownload.createReadStream()
    assert.ok(configStream)
    const configChunks: Buffer[] = []
    for await (const chunk of configStream) configChunks.push(Buffer.from(chunk))
    const config = JSON.parse(Buffer.concat(configChunks).toString('utf8'))
    assert.equal(config.mode, 'disabled')
    assert.equal(config.enabled, false)
    assert.equal(config.appUrl, new URL(baseUrl).origin)
    assert.equal(config.strategy.preferences.filters.WIN.minEdge, -5)
    assert.equal(config.strategy.preferences.filters.WIN.source, 'tab_decision')
    for (const viewport of [{ name: 'desktop', width: 1440, height: 1000 }, { name: 'mobile', width: 390, height: 844 }]) {
      await realPage.setViewportSize(viewport)
      assert.equal(await realPage.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false)
      await mkdir('scripts/output', { recursive: true })
      await realPage.screenshot({ path: `scripts/output/real-betting-${viewport.name}.png` })
    }
    await realPage.close()
    await page.getByLabel('WIN field size', { exact: true }).selectOption({ label: '< 8 starters' })
    await waitForCount(120)
    await page.getByLabel('PLACE field size', { exact: true }).selectOption({ label: '< 8 starters' })
    await waitForCount(0)
    await page.getByLabel('WIN field size', { exact: true }).selectOption({ label: '< 10 starters' })
    await waitForCount(120)
    await page.getByLabel('PLACE field size', { exact: true }).selectOption({ label: '< 12 starters' })
    await waitForCount(240)
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
    assert.doesNotMatch(Buffer.concat(csvChunks).toString('utf8'), /"EXCLUDED"/)
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
    assert.equal(reportRequests, expectedReportRequests, 'Filters, staking, pagination and export must stay local')
    await page.getByLabel('WIN edge', { exact: true }).selectOption('10')
    await page.getByLabel('PLACE top-three probability', { exact: true }).selectOption('60')
    await page.getByLabel('PLACE venue', { exact: true }).selectOption('TEST DATA Flemington')
    await page.getByLabel('PLACE model', { exact: true }).selectOption('test-alpha')
    await page.getByLabel('PLACE field size', { exact: true }).selectOption('12')
    await page.getByLabel('Sort results', { exact: true }).selectOption('edge')
    await waitForCount(60)
    await page.waitForFunction(key => JSON.parse(window.localStorage.getItem(key) ?? '{}').sort === 'edge', SIMULATION_PREFERENCES_KEY)
    const saved = await page.evaluate(key => window.localStorage.getItem(key), SIMULATION_PREFERENCES_KEY)
    const filteredResults = await results()
    await page.reload()
    await waitForCount(60)
    assert.equal(await results(), filteredResults)
    assert.equal(await page.evaluate(key => window.localStorage.getItem(key), SIMULATION_PREFERENCES_KEY), saved)
    for (const [label, expected] of [['Completed races', '100'], ['Starting bankroll per model', '100'], ['Flat stake', '5'], ['Staking method', 'percent'], ['WIN edge', '10'], ['WIN field size', '10'], ['PLACE field size', '12'], ['PLACE top-three probability', '60'], ['PLACE model', 'test-alpha'], ['PLACE venue', 'TEST DATA Flemington'], ['Sort results', 'edge']]) {
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
    const trial: SimulationRace = { ...races[0], selections: [], tabPlaceResearch: { ...TAB_PLACE_TRIAL },
      decisionSelections: Array.from({ length: 8 }, (_, index) => ({ ...races[0].decisionSelections![0],
        id: `trial-${index}`, horse: `TEST Trial Runner ${index}`, model: TAB_PLACE_TRIAL.model, rank: index + 1,
        winProbability: 1 / 8, top3Probability: 3 / 8, placeProbability: 3 / 8, placePaidPlaces: 3,
        placeTermsVerified: true, fullField: true, winOdds: index + 2, placeOdds: 5, position: index + 1,
        winIssue: null, placeIssue: null,
      })) }
    races.splice(0, races.length, trial)
    manifest.races = [{ id: trial.id, fingerprint: 'trial-test' }]
    manifest.models.push(TAB_PLACE_TRIAL.model)
    await page.evaluate(key => window.localStorage.removeItem(key), SIMULATION_PREFERENCES_KEY)
    await page.reload()
    const trialRegion = page.getByRole('region', { name: 'Prospective TAB PLACE research', exact: true })
    await trialRegion.getByText(/1 frozen seven\/eight-runner observations; 1 eligible/).waitFor()
    const trialDownload = page.waitForEvent('download')
    await page.getByRole('button', { name: 'Export prospective TAB bets', exact: true }).click()
    const trialStream = await (await trialDownload).createReadStream()
    assert.ok(trialStream)
    const trialChunks: Buffer[] = []
    for await (const chunk of trialStream) trialChunks.push(Buffer.from(chunk))
    const trialCsv = Buffer.concat(trialChunks).toString('utf8')
    assert.equal(trialCsv.split('\r\n').length, 4)
    assert.match(trialCsv, /"TAB market rank"/)
    assert.match(trialCsv, /"Paid places"/)
    assert.match(trialCsv, /"tab-place-value-v1"/)
    await page.getByRole('checkbox', { name: 'WIN', exact: true }).uncheck()
    for (const [label, value] of [['PLACE odds source', 'tab_decision'], ['PLACE runner scope', '0'], ['PLACE top-three probability', '0'], ['PLACE minimum field size', '8'], ['PLACE field size', '9'], ['PLACE minimum TAB market rank', '2'], ['PLACE maximum TAB market rank', '4']]) {
      await page.getByLabel(label, { exact: true }).selectOption(value)
    }
    await page.locator('fieldset').filter({ has: page.getByRole('checkbox', { name: 'PLACE', exact: true }) }).getByRole('checkbox', { name: 'One highest-value pick per race / model', exact: true }).check()
    await waitForCount(1)
    await page.reload()
    await waitForCount(1)
    assert.equal(await page.getByLabel('PLACE minimum TAB market rank', { exact: true }).inputValue(), '2')
    assert.equal(await page.getByLabel('PLACE maximum TAB market rank', { exact: true }).inputValue(), '4')
    for (const viewport of [{ name: 'desktop', width: 1440, height: 1000 }, { name: 'mobile', width: 390, height: 844 }]) {
      await page.setViewportSize(viewport)
      await trialRegion.scrollIntoViewIfNeeded()
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false)
      await trialRegion.screenshot({ path: `scripts/output/tab-place-trial-${viewport.name}.png` })
    }
    assert.deepEqual(blockedRequests, [], 'No source-table or betting API calls are expected')
    assert.deepEqual(errors, [])
    console.log('PASS: defaults, bankroll math, local filtering, CSV, pagination ROI, desktop/mobile layout, report failures, saved preferences, persistent resets and corrupt/blocked storage. No live Supabase requests were made.')
  } finally {
    await browser.close()
  }
}

main().catch(error => { console.error(error); process.exitCode = 1 })