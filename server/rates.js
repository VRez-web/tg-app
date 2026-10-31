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
