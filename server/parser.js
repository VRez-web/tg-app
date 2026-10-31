import * as cheerio from 'cheerio'

const HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36',
  'Accept-Language': 'ru-RU,ru;q=0.9,en;q=0.6',
  Accept: 'text/html,application/json;q=0.9,*/*;q=0.8',
}

const PRICE_RE =
  /(\d[\d\s]{0,12}(?:[.,]\d{1,2})?)\s*(?:бр|б\.?\s*р\.?|руб\.?|BYN|rubles?)/i
const USD_RE = /(?:\$|USD|долл\.?)\s*(\d[\d\s]{0,12}(?:[.,]\d{1,2})?)|(\d[\d\s]{0,12}(?:[.,]\d{1,2})?)\s*(?:\$|USD|долл)/i
const ROOMS_RE = /(\d+)\s*[-–]?\s*комн|(\d+)-комнат|комнат[:\s]+(\d+)/i
const STUDIO_RE = /студи/i
const AREA_RE = /(\d+(?:[.,]\d+)?)\s*(?:м²|м2|кв\.?\s*м)/i

function toNumber(raw) {
  if (raw == null || raw === '') return null
  const n = Number(String(raw).replace(/\s/g, '').replace(',', '.'))
  return Number.isFinite(n) ? n : null
}

function absUrl(href, base) {
  try {
    return new URL(href, base).href.split('#')[0]
  } catch {
    return null
  }
}

async function fetchText(url) {
  const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(20000) })
  if (!res.ok) throw new Error(`Не удалось открыть страницу (${res.status})`)
  return res.text()
}

async function fetchJson(url) {
  const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(20000) })
  if (!res.ok) return null
  try {
    return await res.json()
  } catch {
    return null
  }
}

function extractFromText(text) {
  const roomsMatch = text.match(ROOMS_RE)
  const rooms = STUDIO_RE.test(text)
    ? 0
    : toNumber(roomsMatch?.[1] || roomsMatch?.[2] || roomsMatch?.[3])
  const areaM2 = toNumber(text.match(AREA_RE)?.[1])
  let priceByn = toNumber(text.match(PRICE_RE)?.[1])
  let priceUsd = null
  const usd = text.match(USD_RE)
  if (usd) priceUsd = toNumber(usd[1] || usd[2])
  return { rooms, areaM2, priceByn, priceUsd }
}

const KUFAR_PLACES = {
  brest: { rgn: '1', ar: '1' },
  брест: { rgn: '1', ar: '1' },
  gomel: { rgn: '2', ar: '5' },
  гомель: { rgn: '2', ar: '5' },
  grodno: { rgn: '3', ar: '9' },
  гродно: { rgn: '3', ar: '9' },
  mogilev: { rgn: '4', ar: '13' },
  могилев: { rgn: '4', ar: '13' },
  могилёв: { rgn: '4', ar: '13' },
  vitebsk: { rgn: '6', ar: '18' },
  витебск: { rgn: '6', ar: '18' },
  minsk: { rgn: '7' },
  минск: { rgn: '7' },
}

const KUFAR_PAGE_SIZE = 50
const KUFAR_MAX_ADS = 2000

function kufarPriceByn(raw) {
  const value = typeof raw === 'object' && raw ? raw.BYR || raw.amount || raw.value : raw
  const n = toNumber(value)
  if (n == null || n <= 0) return null
  return n / 100
}

function pickParam(params, ...keys) {
  const p = params.find((x) => keys.includes(String(x.p || '').toLowerCase()) || keys.includes(String(x.pl || '').toLowerCase()))
  if (!p) return null
  return toNumber(Array.isArray(p.v) ? p.v[0] : p.v ?? p.vl)
}

function fromKufarAd(ad) {
  if (!ad) return null
  const id = ad.ad_id || ad.id
  const url =
    ad.ad_link ||
    ad.url ||
    (id ? `https://re.kufar.by/vi/${id}` : null)
  if (!url) return null

  const params = [...(ad.ad_parameters || []), ...(ad.account_parameters || [])]
  const rooms = pickParam(params, 'rooms', 'комнат', 'количество комнат')
  const areaM2 = pickParam(params, 'size', 'area', 'площадь', 'общая площадь, м²')
  const address = params.find((x) => x.p === 'address')?.v
  const title = String(address || '').trim() || 'Адрес не указан'
  const priceByn = kufarPriceByn(ad.price_byn)
  const image = kufarImage(ad.images?.[0])

  return { url, externalId: id ? String(id) : listingIdFromUrl(url), title, rooms, areaM2, priceByn, image }
}

export function listingIdFromUrl(url) {
  return String(url || '').match(/\/(?:vi|item|ad)\/(\d+)/i)?.[1] || null
}

export function normalizeListingUrl(raw) {
  try {
    const url = new URL(raw)
    url.hash = ''
    url.search = ''
    url.hostname = url.hostname.replace(/^www\./, '').toLowerCase()
    url.pathname = url.pathname.replace(/\/+$/, '') || '/'
    return url.href
  } catch {
    return raw
  }
}

function kufarImage(image) {
  if (!image) return null
  if (image.path) return `https://content.kufar.by/rms/${image.path}`
  if (image.id) return `https://yams.kufar.by/api/v1/item/YAMS_STORAGE_ID/${image.id}.jpg?rule=gallery`
  return null
}

function kufarApiFromListing(page, category) {
  const api = new URL('https://api.kufar.by/search-api/v2/search/rendered-paginated')
  page.searchParams.forEach((value, key) => api.searchParams.set(key, value))
  api.searchParams.set('lang', 'ru')
  api.searchParams.set('size', String(KUFAR_PAGE_SIZE))

  const parts = page.pathname.toLowerCase().split('/').filter(Boolean)
  const slugs = parts[0] === 'l' ? parts.slice(1) : parts
  const text = decodeURIComponent(slugs.join(' '))
  const place = slugs.map((s) => KUFAR_PLACES[decodeURIComponent(s)]).find(Boolean)

  if (place?.rgn && !api.searchParams.has('rgn')) api.searchParams.set('rgn', place.rgn)
  if (place?.ar && !api.searchParams.has('ar')) api.searchParams.set('ar', place.ar)

  if (!api.searchParams.has('cat')) {
    if (/kvartir|квартир/.test(text) || category === 'apartments') api.searchParams.set('cat', '1010')
    else if (/komnat|комнат/.test(text)) api.searchParams.set('cat', '1040')
  }

  if (/snyat|arenda|аренд/.test(text) && !api.searchParams.has('typ')) {
    api.searchParams.set('typ', 'let')
  } else if (/kupit|prodazh|покуп|продаж/.test(text) && !api.searchParams.has('typ')) {
    api.searchParams.set('typ', 'sell')
  }

  return api
}

async function parseKufarListing(page, category) {
  const items = []
  const seen = new Set()
  const api = kufarApiFromListing(page, category)
  let cursor = null

  while (items.length < KUFAR_MAX_ADS) {
    if (cursor) api.searchParams.set('cursor', cursor)
    else api.searchParams.delete('cursor')
    const data = await fetchJson(api.href)
    const batch = parseKufarAdsPayload(data)
    for (const item of batch) {
      const key = item.externalId || item.url
      if (seen.has(key)) continue
      seen.add(key)
      items.push(item)
      if (items.length >= KUFAR_MAX_ADS) break
    }
    const next = data?.pagination?.pages?.find((p) => p.label === 'next')
    if (!batch.length || !next?.token || next.token === cursor) break
    cursor = next.token
  }

  return items
}

function parseKufarAdsPayload(data) {
  const ads = data?.ads || data?.ads_info || data?.list || []
  return ads.map(fromKufarAd).filter(Boolean)
}

async function parseKufar(url, category) {
  const page = new URL(url)
  const itemId = page.pathname.match(/\/(?:item|vi)\/(\d+)/)?.[1]
  if (itemId) {
    const api =
      (await fetchJson(`https://api.kufar.by/search-api/v1/item?adId=${itemId}`)) ||
      (await fetchJson(`https://api.kufar.by/search-api/v2/ads/${itemId}`))
    const ad = api?.ad || api?.ads?.[0] || api
    const item = fromKufarAd(ad)
    if (item) return [item]
    return parseGeneric(url)
  }

  const items = await parseKufarListing(page, category)
  if (items.length) return items
  return parseGeneric(url)
}

function onlinerApiUrl(url) {
  const u = new URL(url)
  const sale = u.hostname.startsWith('r.') || u.pathname.includes('/pk/')
  const rent = u.pathname.includes('/ak/')
  if (!sale && !rent && !u.hostname.includes('onliner')) return null
  const kind = rent || (!sale && u.pathname.includes('ak')) ? 'ak' : 'pk'
  const api = new URL(`https://${kind}.api.onliner.by/search/apartments`)
  u.searchParams.forEach((value, key) => api.searchParams.set(key, value))
  return api.href
}

function fromOnlinerApartment(item, fallbackUrl) {
  const url = item.url || item.html_url || fallbackUrl
  if (!url) return null
  const priceByn =
    toNumber(item.price?.converted?.BYN?.amount) ??
    toNumber(item.price?.amount) ??
    toNumber(item.price?.byn)
  const rooms = toNumber(item.rent_type?.match?.(/\d/)?.[0]) ?? toNumber(item.number_of_rooms)
  const areaM2 = toNumber(item.area?.total) ?? toNumber(item.area)
  const title = item.location?.address || item.location?.user_address || 'Адрес не указан'
  const externalId = item.id != null ? String(item.id) : listingIdFromUrl(url)
  return { url, externalId, title, rooms, areaM2, priceByn, image: item.photo || item.images?.[0] || null }
}

async function parseOnliner(url) {
  const apiUrl = onlinerApiUrl(url)
  if (apiUrl) {
    const data = await fetchJson(apiUrl)
    const apartments = data?.apartments || data?.result || []
    const items = apartments.map((x) => fromOnlinerApartment(x)).filter(Boolean)
    if (items.length) return items
  }
  return parseGeneric(url)
}

function listingLikeHref(href) {
  if (!href || href.startsWith('javascript:') || href === '#') return false
  return /\/item\/|\/ad\/|\/i\/|\/pk\/|\/ak\/|\/apartment|id=\d+/i.test(href)
}

function parseJsonLd($) {
  const items = []
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const json = JSON.parse($(el).contents().text())
      const nodes = Array.isArray(json) ? json : json['@graph'] || [json]
      for (const node of nodes) {
        const list = node.itemListElement || []
        for (const entry of list) {
          const it = entry.item || entry
          const offer = it.offers || it
          items.push({
            url: it.url,
            title: it.name || it.title,
            priceByn: toNumber(offer.price),
            rooms: toNumber(it.numberOfRooms),
            areaM2: toNumber(it.floorSize?.value),
          })
        }
        if (node['@type'] === 'Offer' || node.offers) {
          const offer = node.offers || node
          items.push({
            url: node.url,
            title: node.name,
            priceByn: toNumber(offer.price),
            rooms: toNumber(node.numberOfRooms),
            areaM2: toNumber(node.floorSize?.value),
          })
        }
      }
    } catch {
      /* ignore broken json-ld */
    }
  })
  return items.filter((x) => x.url)
}

async function parseGeneric(url) {
  const html = await fetchText(url)
  const $ = cheerio.load(html)
  const found = new Map()

  const add = (item) => {
    const href = absUrl(item.url, url)
    if (!href || found.has(href)) return
    found.set(href, { ...item, url: href })
  }

  parseJsonLd($).forEach(add)

  $('a[href]').each((_, el) => {
    const href = $(el).attr('href')
    if (!listingLikeHref(href)) return
    const card = $(el).closest('article, li, [class*="card"], [class*="item"], [class*="ad"]')
    const text = (card.length ? card.text() : $(el).parent().text()) || $(el).text()
    const parsed = extractFromText(text)
    add({
      url: href,
      title: $(el).attr('title') || $(el).text().replace(/\s+/g, ' ').trim().slice(0, 120) || href,
      ...parsed,
    })
  })

  if (found.size <= 1) {
    const title =
      $('meta[property="og:title"]').attr('content') ||
      $('h1').first().text().trim() ||
      $('title').text().trim()
    const parsed = extractFromText($('body').text())
    const priceMeta = toNumber(
      $('meta[property="product:price:amount"]').attr('content') ||
        $('meta[itemprop="price"]').attr('content'),
    )
    add({
      url,
      title: title.slice(0, 140),
      ...parsed,
      priceByn: priceMeta ?? parsed.priceByn,
    })
  }

  return [...found.values()]
}

export async function parseSource(url, usdRate, category) {
  const host = new URL(url).hostname
  let items
  if (host.includes('kufar.by')) items = await parseKufar(url, category)
  else if (host.includes('onliner.by')) items = await parseOnliner(url)
  else items = await parseGeneric(url)

  return items.map((item) => {
    let priceByn = item.priceByn
    if (priceByn == null && item.priceUsd != null && usdRate) {
      priceByn = Math.round(item.priceUsd * usdRate * 100) / 100
    }
    return {
      url: normalizeListingUrl(item.url),
      externalId: item.externalId || listingIdFromUrl(item.url),
      title: (item.title || '').replace(/\s+/g, ' ').trim().slice(0, 160) || 'Адрес не указан',
      rooms: item.rooms ?? null,
      areaM2: item.areaM2 ?? null,
      priceByn,
      image: item.image || null,
    }
  })
}
