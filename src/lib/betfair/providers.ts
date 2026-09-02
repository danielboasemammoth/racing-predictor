/**
 * Provider abstraction layer - the prediction engine and risk/staking logic must never be tightly
 * coupled to Betfair specifically. Stage 1 only ships SimulationExecutionProvider (deterministic,
 * no network calls, fully unit-testable). A BetfairExecutionProvider/BetfairMarketDataProvider
 * implementing the same interfaces is Stage 2+ work, gated on real API credentials - see
 * BETFAIR_INTEGRATION.md.
 */

export type OrderSide = 'BACK' | 'LAY'

export interface MarketSnapshot {
  marketId: string
  selectionId: string
  status: 'OPEN' | 'SUSPENDED' | 'CLOSED' | 'IN_PLAY'
  /** Best available price on the side being requested (e.g. best back price for a BACK order). */
  bestAvailablePrice: number
  /** Size available at bestAvailablePrice. */
  availableSize: number
  priceAgeSeconds: number
}

/** Reads current market prices/liquidity/status. Implemented by BetfairMarketDataProvider (Stage 2+). */
export interface MarketDataProvider {
  getMarketSnapshot(marketId: string, selectionId: string): Promise<MarketSnapshot | null>
}

export interface PlaceOrderRequest {
  marketId: string
  selectionId: string
  side: OrderSide
  /** The price the caller wants to bet at (limit price). */
  price: number
  size: number
  /** Reject rather than accept a worse price - mirrors Betfair's persistence/limit-order semantics. */
  minAcceptablePrice: number
}

export interface PlaceOrderResult {
  status: 'MATCHED' | 'PARTIALLY_MATCHED' | 'UNMATCHED' | 'REJECTED'
  matchedSize: number
  unmatchedSize: number
  averageMatchedPrice: number | null
  betId: string
  rejectionReason: string | null
}

/** Submits orders. Implemented by BetfairExecutionProvider (Stage 2+, real money) and SimulationExecutionProvider (below). */
export interface ExecutionProvider {
  placeOrder(request: PlaceOrderRequest): Promise<PlaceOrderResult>
}

let simulatedBetIdCounter = 0

/**
 * Deterministic simulated execution: fills at the market snapshot's bestAvailablePrice up to its
 * availableSize, rejects outright if that price is worse than the caller's minAcceptablePrice
 * (mirrors "price moved - do not match at the worse price"). No network calls.
 */
export class SimulationExecutionProvider implements ExecutionProvider {
  constructor(private readonly getSnapshot: (marketId: string, selectionId: string) => Promise<MarketSnapshot | null>) {}

  async placeOrder(request: PlaceOrderRequest): Promise<PlaceOrderResult> {
    const snapshot = await this.getSnapshot(request.marketId, request.selectionId)
    const betId = `SIM-${Date.now()}-${++simulatedBetIdCounter}`

    if (!snapshot) {
      return { status: 'REJECTED', matchedSize: 0, unmatchedSize: request.size, averageMatchedPrice: null, betId, rejectionReason: 'Market data unavailable' }
    }
    if (snapshot.status !== 'OPEN') {
      return { status: 'REJECTED', matchedSize: 0, unmatchedSize: request.size, averageMatchedPrice: null, betId, rejectionReason: `Market is ${snapshot.status}, not OPEN` }
    }
    if (request.side === 'BACK' && snapshot.bestAvailablePrice < request.minAcceptablePrice) {
      return { status: 'REJECTED', matchedSize: 0, unmatchedSize: request.size, averageMatchedPrice: null, betId, rejectionReason: `Price moved from ${request.minAcceptablePrice} to ${snapshot.bestAvailablePrice}` }
    }

    const matchedSize = Math.min(request.size, snapshot.availableSize)
    const unmatchedSize = request.size - matchedSize
    const status = matchedSize === 0 ? 'UNMATCHED' : matchedSize < request.size ? 'PARTIALLY_MATCHED' : 'MATCHED'

    return {
      status,
      matchedSize,
      unmatchedSize,
      averageMatchedPrice: matchedSize > 0 ? snapshot.bestAvailablePrice : null,
      betId,
      rejectionReason: null,
    }
  }
}
