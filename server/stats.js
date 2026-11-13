import { getListing, listAllListings, listListingChanges, listListingHistory, listSnapshots } from './store.js'

const PERIODS = ['days', 'weeks', 'months', 'years']

function avg(nums) {
  const values = nums.filter((n) => n != null && Number.isFinite(n))
  if (!values.length) return null
  return Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 100) / 100
}

function roomKey(rooms) {
  if (rooms == null) return 'unknown'
  if (rooms <= 0) return '0'
  if (rooms >= 4) return '4+'
  return String(rooms)
}

function roomLabel(key) {
  if (key === '0') return 'Студия'
  if (key === '4+') return '4+ комн.'
  if (key === 'unknown') return 'Комнаты не указаны'
  return `${key}-комн.`
}

function ymd(date) {
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 10)
}

function periodRange(period) {
  const now = new Date()
  if (period === 'weeks') {
    const from = new Date(now)
    from.setDate(from.getDate() - 84)
    return { from: ymd(from), to: ymd(now) }
  }
  if (period === 'months') {
    const from = new Date(now.getFullYear(), now.getMonth() - 11, 1)
    return { from: ymd(from), to: ymd(now) }
  }
  if (period === 'years') {
    return { from: '2000-01-01', to: ymd(now) }
  }
  const from = new Date(now)
  from.setDate(from.getDate() - 30)
  return { from: ymd(from), to: ymd(now) }
}

function isoWeek(dateStr) {
  const date = new Date(`${dateStr}T00:00:00`)
  const day = date.getDay() || 7
  date.setDate(date.getDate() + 4 - day)
  const year = date.getFullYear()
  const start = new Date(year, 0, 1)
  const week = Math.ceil(((date - start) / 86400000 + 1) / 7)
  return `${year}-W${String(week).padStart(2, '0')}`
}

function bucket(date, period) {
  if (period === 'weeks') return isoWeek(date)
  if (period === 'months') return date.slice(0, 7)
  if (period === 'years') return date.slice(0, 4)
  return date
}

function historyTitle(period, perM2 = false) {
  const unit = perM2 ? 'за м² ' : ''
  if (period === 'weeks') return `Средняя цена ${unit}по неделям`
  if (period === 'months') return `Средняя цена ${unit}по месяцам`
  if (period === 'years') return `Средняя цена ${unit}по годам`
  return `Средняя цена ${unit}по дням`
}

export function normalizePeriod(raw) {
  return PERIODS.includes(raw) ? raw : 'days'
}

export async function buildStats(category, usdRate, period = 'days') {
  const range = periodRange(period)
  const [allListings, allSnapshots] = await Promise.all([
    listAllListings(category),
    listSnapshots(category),
  ])
  const listings = new Map(allListings.map((item) => [item.id, item]))
  const snapshots = allSnapshots.filter((snap) => snap.date >= range.from && snap.date <= range.to)
  const latest = new Map()
  for (const snap of snapshots) {
    const prev = latest.get(snap.listingId)
    if (!prev || snap.date >= prev.date) latest.set(snap.listingId, snap)
  }

  const items = [...latest.values()].map((snap) => {
    const listing = listings.get(snap.listingId) || {}
    return {
      id: snap.listingId,
      title: listing.title || 'Адрес не указан',
      url: listing.url,
      rooms: snap.rooms ?? listing.rooms,
      areaM2: snap.areaM2 ?? listing.areaM2,
      priceByn: snap.priceByn,
      priceUsd: snap.priceUsd,
    }
  })
  const priced = items.filter((item) => item.priceByn != null)
  const withArea = priced.filter((item) => item.areaM2)

  const byRoomsMap = new Map()
  for (const item of priced) {
    const key = roomKey(item.rooms)
    if (!byRoomsMap.has(key)) byRoomsMap.set(key, { byn: [], usd: [] })
    const bag = byRoomsMap.get(key)
    bag.byn.push(item.priceByn)
    if (item.priceUsd != null) bag.usd.push(item.priceUsd)
  }
  const byRooms = [...byRoomsMap.entries()]
    .sort(([a], [b]) => String(a).localeCompare(String(b), undefined, { numeric: true }))
    .map(([key, prices]) => ({
      key,
      label: roomLabel(key),
      count: prices.byn.length,
      avgByn: avg(prices.byn),
      avgUsd: avg(prices.usd),
    }))

  const byBucket = new Map()
  for (const snap of snapshots) {
    if (snap.priceByn == null) continue
    const key = bucket(snap.date, period)
    if (!byBucket.has(key)) byBucket.set(key, { byn: [], usd: [] })
    const bag = byBucket.get(key)
    bag.byn.push(snap.priceByn)
    if (snap.priceUsd != null) bag.usd.push(snap.priceUsd)
  }
  const history = [...byBucket.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, prices]) => ({
      date,
      avgByn: avg(prices.byn),
      avgUsd: avg(prices.usd),
      count: prices.byn.length,
    }))

  const byBucketM2 = new Map()
  for (const snap of snapshots) {
    if (snap.priceByn == null || !snap.areaM2) continue
    const key = bucket(snap.date, period)
    if (!byBucketM2.has(key)) byBucketM2.set(key, { byn: [], usd: [] })
    const bag = byBucketM2.get(key)
    bag.byn.push(snap.priceByn / snap.areaM2)
    if (snap.priceUsd != null) bag.usd.push(snap.priceUsd / snap.areaM2)
  }
  const historyPerM2 = [...byBucketM2.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, prices]) => ({
      date,
      avgByn: avg(prices.byn),
      avgUsd: avg(prices.usd),
      count: prices.byn.length,
    }))

  const sorted = [...priced].sort((a, b) => a.priceByn - b.priceByn)
  const pick = (item) => ({
    id: item.id,
    title: item.title,
    url: item.url,
    rooms: item.rooms,
    areaM2: item.areaM2,
    priceByn: item.priceByn,
    priceUsd: item.priceUsd,
  })

  return {
    category,
    period,
    from: range.from,
    to: range.to,
    historyTitle: historyTitle(period),
    historyPerM2Title: historyTitle(period, true),
    usdRate,
    count: items.length,
    pricedCount: priced.length,
    avgPriceByn: avg(priced.map((item) => item.priceByn)),
    avgPriceUsd: avg(priced.map((item) => item.priceUsd)),
    avgPricePerM2Byn: avg(withArea.map((item) => item.priceByn / item.areaM2)),
    avgPricePerM2Usd: avg(withArea.filter((item) => item.priceUsd != null).map((item) => item.priceUsd / item.areaM2)),
    byRooms,
    cheapest: sorted.slice(0, 3).map(pick),
    expensive: sorted.slice(-3).reverse().map(pick),
    history,
    historyPerM2,
  }
}

function listingPeriodRange(period) {
  const now = new Date()
  if (period === 'weeks') {
    const from = new Date(now)
    from.setDate(from.getDate() - 84)
    return { from: ymd(from), to: ymd(now) }
  }
  if (period === 'months') {
    const from = new Date(now.getFullYear(), now.getMonth() - 11, 1)
    return { from: ymd(from), to: ymd(now) }
  }
  if (period === 'years') {
    return { from: '2000-01-01', to: ymd(now) }
  }
  const from = new Date(now)
  from.setDate(from.getDate() - 30)
  return { from: ymd(from), to: ymd(now) }
}

export async function buildListingDetail(id, period = 'days') {
  const listing = await getListing(id)
  if (!listing) return null
  const range = listingPeriodRange(period)
  const points = await listListingHistory(id)
  const inRange = points.filter((point) => point.date >= range.from && point.date <= range.to)
  const byBucket = new Map()
  for (const point of inRange) {
    if (point.priceByn == null) continue
    byBucket.set(bucket(point.date, period), point)
  }
  const history = [...byBucket.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, point]) => ({
      date,
      priceByn: point.priceByn,
      rooms: point.rooms,
      areaM2: point.areaM2,
    }))
  return {
    listing,
    period,
    from: range.from,
    to: range.to,
    historyTitle: historyTitle(period).replace('Средняя цена', 'Цена'),
    history,
    points: points.map((point) => ({
      at: point.recordedAt,
      date: point.date,
      priceByn: point.priceByn,
      rooms: point.rooms,
      areaM2: point.areaM2,
      title: point.title,
    })),
    changes: await listListingChanges(id),
  }
}
