export type Tab = 'news' | 'prices'
export type SubTab = 'apartments' | 'other'
export type StatsPeriod = 'days' | 'weeks' | 'months' | 'years'

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
