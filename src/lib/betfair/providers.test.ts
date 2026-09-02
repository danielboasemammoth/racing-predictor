import { describe, it, expect, vi } from 'vitest'
import { SimulationExecutionProvider, type MarketSnapshot, type PlaceOrderRequest } from './providers'

const baseSnapshot: MarketSnapshot = {
  marketId: '1.123',
  selectionId: 'sel-1',
  status: 'OPEN',
  bestAvailablePrice: 4.0,
  availableSize: 100,
  priceAgeSeconds: 1,
}

const baseRequest: PlaceOrderRequest = {
  marketId: '1.123',
  selectionId: 'sel-1',
  side: 'BACK',
  price: 4.0,
  size: 20,
  minAcceptablePrice: 4.0,
}

describe('SimulationExecutionProvider', () => {
  it('fully matches when requested size is within available liquidity', async () => {
    const provider = new SimulationExecutionProvider(async () => baseSnapshot)
    const result = await provider.placeOrder(baseRequest)
    expect(result.status).toBe('MATCHED')
    expect(result.matchedSize).toBe(20)
    expect(result.unmatchedSize).toBe(0)
    expect(result.averageMatchedPrice).toBe(4.0)
  })

  it('partially matches when requested size exceeds available liquidity', async () => {
    const provider = new SimulationExecutionProvider(async () => ({ ...baseSnapshot, availableSize: 5 }))
    const result = await provider.placeOrder(baseRequest)
    expect(result.status).toBe('PARTIALLY_MATCHED')
    expect(result.matchedSize).toBe(5)
    expect(result.unmatchedSize).toBe(15)
  })

  it('rejects outright when there is zero liquidity', async () => {
    const provider = new SimulationExecutionProvider(async () => ({ ...baseSnapshot, availableSize: 0 }))
    const result = await provider.placeOrder(baseRequest)
    expect(result.status).toBe('UNMATCHED')
    expect(result.matchedSize).toBe(0)
    expect(result.averageMatchedPrice).toBeNull()
  })

  it('rejects a BACK order when the price moved below the minimum acceptable price', async () => {
    const provider = new SimulationExecutionProvider(async () => ({ ...baseSnapshot, bestAvailablePrice: 3.4 }))
    const result = await provider.placeOrder({ ...baseRequest, minAcceptablePrice: 4.0 })
    expect(result.status).toBe('REJECTED')
    expect(result.rejectionReason).toMatch(/Price moved/)
  })

  it('rejects when the market is not OPEN', async () => {
    const provider = new SimulationExecutionProvider(async () => ({ ...baseSnapshot, status: 'SUSPENDED' }))
    const result = await provider.placeOrder(baseRequest)
    expect(result.status).toBe('REJECTED')
    expect(result.rejectionReason).toMatch(/SUSPENDED/)
  })

  it('rejects when market data is unavailable', async () => {
    const provider = new SimulationExecutionProvider(async () => null)
    const result = await provider.placeOrder(baseRequest)
    expect(result.status).toBe('REJECTED')
    expect(result.rejectionReason).toMatch(/unavailable/)
  })

  it('generates a unique bet id per call', async () => {
    const provider = new SimulationExecutionProvider(async () => baseSnapshot)
    const [a, b] = await Promise.all([provider.placeOrder(baseRequest), provider.placeOrder(baseRequest)])
    expect(a.betId).not.toBe(b.betId)
  })

  it('calls the snapshot getter with the requested market/selection', async () => {
    const getter = vi.fn(async () => baseSnapshot)
    const provider = new SimulationExecutionProvider(getter)
    await provider.placeOrder(baseRequest)
    expect(getter).toHaveBeenCalledWith('1.123', 'sel-1')
  })
})
