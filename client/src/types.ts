export type Tab = 'news' | 'prices'
export type SubTab = 'apartments' | 'other'
export type PricesView = SubTab | 'history'
export type StatsPeriod = 'days' | 'weeks' | 'months' | 'years'
export type ParseTrigger = 'cron' | 'manual'
export type ParseChangeAction = 'added' | 'updated' | 'removed'

export interface NewsItem {
  id: string
  title: string
  summary: string
  date: string
  source: string
}

export interface Source {
  id: string
  url: string
  category: SubTab
  createdAt: string
  lastParsedAt: string | null
  lastError: string | null
  lastCount: number
}

export interface Listing {
  id: string
  sourceId: string
  url: string
  category: SubTab
  title: string
  rooms: number | null
  areaM2: number | null
  priceByn: number | null
  image: string | null
  active: boolean
  firstSeenAt: string
  lastParsedAt: string
}

export interface StatsItem {
  id: string
  title: string
  url: string
  rooms: number | null
  areaM2: number | null
  priceByn: number | null
  priceUsd: number | null
}

export interface ParseChange {
  id: string
  runId: string
  listingId: string | null
  action: ParseChangeAction
  title: string
  url: string
  oldPriceByn: number | null
  newPriceByn: number | null
  oldTitle: string | null
  newTitle: string | null
  oldRooms: number | null
  newRooms: number | null
  oldAreaM2: number | null
  newAreaM2: number | null
}

export interface ParseRun {
  id: string
  startedAt: string
  finishedAt: string | null
  trigger: ParseTrigger
  category: SubTab | null
  parsedCount: number
  addedCount: number
  updatedCount: number
  removedCount: number
  error: string | null
  changes: ParseChange[]
}

export interface ListingDetail {
  listing: Listing
  period: StatsPeriod
  from: string
  to: string
  historyTitle: string
  history: { date: string; priceByn: number | null; rooms: number | null; areaM2: number | null }[]
  points: { at: string | null; date: string; priceByn: number | null; rooms: number | null; areaM2: number | null; title: string | null }[]
  changes: (ParseChange & { at: string | null })[]
}

export interface Stats {
  category: SubTab
  period: StatsPeriod
  from: string
  to: string
  historyTitle: string
  usdRate: number | null
  count: number
  pricedCount: number
  avgPriceByn: number | null
  avgPriceUsd: number | null
  avgPricePerM2Byn: number | null
  avgPricePerM2Usd: number | null
  byRooms: { key: string; label: string; count: number; avgByn: number | null; avgUsd: number | null }[]
  cheapest: StatsItem[]
  expensive: StatsItem[]
  history: { date: string; avgByn: number | null; avgUsd: number | null; count: number }[]
}
