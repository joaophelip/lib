import { adapters, AssetNamespace, caip19 } from '@shapeshiftoss/caip'
import {
  ChainTypes,
  FindAllMarketArgs,
  HistoryData,
  MarketCapResult,
  MarketData,
  MarketDataArgs,
  NetworkTypes
} from '@shapeshiftoss/types'
import { ChainId, Token, Yearn } from '@yfi/sdk'
import uniqBy from 'lodash/uniqBy'

import { MarketService } from '../api'
import { RATE_LIMIT_THRESHOLDS_PER_MINUTE } from '../config'
import { bnOrZero } from '../utils/bignumber'
import { createRateLimiter } from '../utils/rateLimiters'

const rateLimiter = createRateLimiter(RATE_LIMIT_THRESHOLDS_PER_MINUTE.YEARN)

type YearnTokenMarketCapServiceArgs = {
  yearnSdk: Yearn<ChainId>
}

const USDC_PRECISION = 6

export class YearnTokenMarketCapService implements MarketService {
  baseUrl = 'https://api.yearn.finance'
  yearnSdk: Yearn<ChainId>

  private readonly defaultGetByMarketCapArgs: FindAllMarketArgs = {
    count: 2500
  }

  constructor(args: YearnTokenMarketCapServiceArgs) {
    this.yearnSdk = args.yearnSdk
  }

  findAll = async (args?: FindAllMarketArgs) => {
    try {
      const argsToUse = { ...this.defaultGetByMarketCapArgs, ...args }
      const response = await Promise.allSettled([
        rateLimiter(() => this.yearnSdk.ironBank.tokens()),
        rateLimiter(() => this.yearnSdk.tokens.supported()),
        rateLimiter(() => this.yearnSdk.vaults.tokens())
      ])
      const [ironBankResponse, zapperResponse, underlyingTokensResponse] = response

      // Ignore rejected promises, return successful responses.
      const responseTokens = [
        ...(ironBankResponse.status === 'fulfilled' ? ironBankResponse.value : []),
        ...(zapperResponse.status === 'fulfilled' ? zapperResponse.value : []),
        ...(underlyingTokensResponse.status === 'fulfilled' ? underlyingTokensResponse.value : [])
      ]
      const uniqueTokens: Token[] = uniqBy(responseTokens, 'address')
      const tokens = uniqueTokens.slice(0, argsToUse.count)

      return tokens.reduce((acc, token) => {
        const _caip19: string = caip19.toCAIP19({
          chain: ChainTypes.Ethereum,
          network: NetworkTypes.MAINNET,
          assetNamespace: AssetNamespace.ERC20,
          assetReference: token.address
        })
        acc[_caip19] = {
          price: bnOrZero(token.priceUsdc).div(`1e+${USDC_PRECISION}`).toString(),
          // TODO: figure out how to get these values.
          marketCap: '0',
          volume: '0',
          changePercent24Hr: 0
        }

        return acc
      }, {} as MarketCapResult)
    } catch (e) {
      console.info(e)
      return {}
    }
  }

  findByCaip19 = async ({ caip19: _caip19 }: MarketDataArgs): Promise<MarketData | null> => {
    const address = adapters.CAIP19ToYearn(_caip19)
    if (!address) return null
    try {
      // the yearnSdk caches the response to all of these calls and returns the cache if found.
      // Unfortunately, the functions do not take in an argument for a single address to return a
      // single token, so we are limited to getting all tokens then doing a find on them to return
      // the price to web. Doing allSettled so that one rejection does not interfere with the other
      // calls.
      const response = await Promise.allSettled([
        rateLimiter(() => this.yearnSdk.ironBank.tokens()),
        rateLimiter(() => this.yearnSdk.tokens.supported()),
        rateLimiter(() => this.yearnSdk.vaults.tokens())
      ])
      const [ironBankResponse, zapperResponse, underlyingTokensResponse] = response

      // Ignore rejected promises, return successful responses.
      const responseTokens = [
        ...(ironBankResponse.status === 'fulfilled' ? ironBankResponse.value : []),
        ...(zapperResponse.status === 'fulfilled' ? zapperResponse.value : []),
        ...(underlyingTokensResponse.status === 'fulfilled' ? underlyingTokensResponse.value : [])
      ]
      const token = responseTokens.find((tok: Token) => tok.address === address)
      if (!token) return null

      return {
        price: bnOrZero(token.priceUsdc).div(`1e+${USDC_PRECISION}`).toString(),
        marketCap: '0',
        volume: '0',
        changePercent24Hr: 0
      }
    } catch (e) {
      console.warn(e)
      throw new Error('YearnMarketService(findByCaip19): error fetching market data')
    }
  }

  findPriceHistoryByCaip19 = async (): Promise<HistoryData[]> => {
    // TODO: figure out a way to get zapper, ironbank and underlying token historical data.
    return []
  }
}
