const NBRB_DAILY = 'https://api.nbrb.by/exrates/rates?periodicity=0'
const CACHE_MS = 60 * 60 * 1000

let cache = { usd: null, eur: null, rub: null, date: null, fetchedAt: 0, source: 'nbrb.by' }

function pick(rates, code) {
  const row = rates.find((item) => item.Cur_Abbreviation === code)
  if (!row) return null
  return Number(row.Cur_OfficialRate) / (Number(row.Cur_Scale) || 1)
}

export async function getRates() {
  if (cache.usd && Date.now() - cache.fetchedAt < CACHE_MS) return cache
  const res = await fetch(NBRB_DAILY)
  if (!res.ok) throw new Error('Не удалось получить курс НБРБ')
  const rates = await res.json()
  cache = {
    usd: pick(rates, 'USD'),
    eur: pick(rates, 'EUR'),
    rub: pick(rates, 'RUB'),
    date: rates[0]?.Date?.slice(0, 10) || null,
    fetchedAt: Date.now(),
    source: 'nbrb.by',
  }
  return cache
}

export async function getUsdRate() {
  const rates = await getRates()
  return { rate: rates.usd, date: rates.date, source: rates.source, scale: 1 }
}

export function bynToUsd(byn, usdRate) {
  if (byn == null || !usdRate) return null
  return Math.round((byn / usdRate) * 100) / 100
}

const USD_CUR_ID = 431

export function shiftDate(date, days) {
  const [year, month, day] = String(date).slice(0, 10).split('-').map(Number)
  const next = new Date(Date.UTC(year, month - 1, day + days))
  return next.toISOString().slice(0, 10)
}

export function expandUsdRates(points, from, to) {
  const sorted = points
    .map((point) => ({
      date: String(point.date).slice(0, 10),
      usdByn: Number(point.usdByn),
    }))
    .filter((point) => point.date && Number.isFinite(point.usdByn) && point.usdByn > 0)
    .sort((a, b) => a.date.localeCompare(b.date))
  const out = []
  let current = null
  let index = 0
  for (let day = from; day <= to; day = shiftDate(day, 1)) {
    while (index < sorted.length && sorted[index].date <= day) {
      current = sorted[index].usdByn
      index += 1
    }
    if (current != null) out.push({ date: day, usdByn: current })
  }
  return out
}

export async function fetchNbrbUsdRates(from, to) {
  const url = `https://api.nbrb.by/exrates/rates/dynamics/${USD_CUR_ID}?startDate=${from}&endDate=${to}`
  const res = await fetch(url, { signal: AbortSignal.timeout(20000) })
  if (!res.ok) throw new Error('Не удалось получить историю курса НБРБ')
  const rows = await res.json()
  if (!Array.isArray(rows)) throw new Error('НБРБ вернул неожиданный ответ')
  return rows
    .map((row) => ({
      date: String(row.Date || '').slice(0, 10),
      usdByn: Number(row.Cur_OfficialRate) / (Number(row.Cur_Scale) || 1),
    }))
    .filter((row) => row.date && Number.isFinite(row.usdByn) && row.usdByn > 0)
}
