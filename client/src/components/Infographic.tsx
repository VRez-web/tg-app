import { useEffect, useState } from 'react'
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { api } from '../api'
import type { Stats, StatsPeriod, SubTab } from '../types'
import { Modal } from './Modal'

const PERIODS: { id: StatsPeriod; label: string }[] = [
  { id: 'days', label: 'Дни' },
  { id: 'weeks', label: 'Недели' },
  { id: 'months', label: 'Месяцы' },
  { id: 'years', label: 'Годы' },
]

function money(value: number | null | undefined, suffix = 'Br') {
  if (value == null) return '—'
  return `${value.toLocaleString('ru-BY', { maximumFractionDigits: 0 })} ${suffix}`
}

type Currency = 'byn' | 'usd'

const axis = { stroke: '#8b9bb0', fontSize: 11, tickLine: false, axisLine: false } as const

function rooms(value: number | null) {
  if (value == null) return ''
  if (value <= 0) return 'студия'
  return `${value}-комн.`
}

function List({
  title,
  items,
  currency,
}: {
  title: string
  items: Stats['cheapest']
  currency: Currency
}) {
  if (!items.length) return null
  const suffix = currency === 'usd' ? '$' : 'Br'
  return (
    <div className="stat-block">
      <h4>{title}</h4>
      <ol className="stat-list">
        {items.map((item) => (
          <li key={item.id}>
            <a href={item.url} target="_blank" rel="noreferrer">
              {item.title}
            </a>
            <span>
              {[rooms(item.rooms), item.areaM2 ? `${item.areaM2} м²` : null].filter(Boolean).join(' · ')}
            </span>
            <b>{money(currency === 'usd' ? item.priceUsd : item.priceByn, suffix)}</b>
          </li>
        ))}
      </ol>
    </div>
  )
}

export function Infographic({ category, onClose }: { category: SubTab; onClose: () => void }) {
  const [period, setPeriod] = useState<StatsPeriod>('days')
  const [currency, setCurrency] = useState<Currency>('byn')
  const [stats, setStats] = useState<Stats | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setError('')
    api
      .stats(category, period, controller.signal)
      .then((next) => {
        if (controller.signal.aborted) return
        setStats(next)
      })
      .catch((err) => {
        if (err instanceof Error && err.name === 'AbortError') return
        setError(err instanceof Error ? err.message : 'Не удалось посчитать статистику')
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [category, period])

  const usdReady = Boolean(
    stats &&
      (stats.avgPriceUsd != null ||
        stats.avgPricePerM2Usd != null ||
        stats.byRooms.some((row) => row.avgUsd != null) ||
        stats.history.some((row) => row.avgUsd != null) ||
        stats.historyPerM2.some((row) => row.avgUsd != null)),
  )
  const suffix = currency === 'usd' ? '$' : 'Br'
  const pick = (byn: number | null | undefined, usd: number | null | undefined) =>
    currency === 'usd' ? usd ?? null : byn || 0
  const roomData = (stats?.byRooms || []).map((row) => ({
    name: row.label,
    value: pick(row.avgByn, row.avgUsd),
  }))
  const historyData = (stats?.history || []).map((row) => ({
    date: row.date.length > 7 ? row.date.slice(5) : row.date,
    value: pick(row.avgByn, row.avgUsd),
  }))
  const historyPerM2Data = (stats?.historyPerM2 || []).map((row) => ({
    date: row.date.length > 7 ? row.date.slice(5) : row.date,
    value: pick(row.avgByn, row.avgUsd),
  }))
  const tip = (value: unknown) => money(typeof value === 'number' ? value : Number(value), suffix)

  return (
    <Modal onClose={onClose}>
        <header className="modal-head">
          <div>
            <h3>Инфографика</h3>
            <span>
              {stats
                ? `${stats.from} — ${stats.to} · ${stats.pricedCount} из ${stats.count} с ценой`
                : 'Текущий месяц'}
            </span>
          </div>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Закрыть
          </button>
        </header>

        <div className="period-tabs currency-tabs">
          <button
            type="button"
            className={`subtab ${currency === 'byn' ? 'active' : ''}`}
            onClick={() => setCurrency('byn')}
          >
            Br
          </button>
          <button
            type="button"
            className={`subtab ${currency === 'usd' ? 'active' : ''}`}
            disabled={!usdReady}
            onClick={() => setCurrency('usd')}
          >
            $
          </button>
        </div>

        <div className="period-tabs">
          {PERIODS.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`subtab ${period === item.id ? 'active' : ''}`}
              onClick={() => setPeriod(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>

        {loading && <div className="muted">Считаем статистику…</div>}
        {error && <div className="form-error">{error}</div>}

        {stats && (
          <>
            <div className="stat-grid">
              <article>
                <small>Средняя стоимость</small>
                <strong>{money(currency === 'usd' ? stats.avgPriceUsd : stats.avgPriceByn, suffix)}</strong>
              </article>
              {category === 'apartments' && (
                <article>
                  <small>Средняя за м²</small>
                  <strong>{money(currency === 'usd' ? stats.avgPricePerM2Usd : stats.avgPricePerM2Byn, suffix)}</strong>
                </article>
              )}
            </div>

            {category === 'apartments' && roomData.length > 0 && (
              <div className="stat-block">
                <h4>Средняя стоимость по комнатам</h4>
                <div className="chart-box">
                  <ResponsiveContainer width="100%" height={220}>
                    <BarChart data={roomData}>
                      <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
                      <XAxis dataKey="name" stroke="#8b9bb0" fontSize={12} tickLine={false} axisLine={false} />
                      <YAxis {...axis} />
                      <Tooltip cursor={{ fill: 'rgba(91,140,255,0.08)' }} formatter={tip} />
                      <Bar dataKey="value" name={suffix} fill={currency === 'usd' ? '#f5c16c' : '#5b8cff'} radius={[8, 8, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}

            {historyData.length > 0 && (
              <div className="stat-block">
                <h4>{stats.historyTitle}</h4>
                <div className="chart-box">
                  <ResponsiveContainer width="100%" height={220}>
                    <AreaChart data={historyData}>
                      <defs>
                        <linearGradient id="priceFill" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor={currency === 'usd' ? '#f5c16c' : '#6ee7c5'} stopOpacity={0.35} />
                          <stop offset="100%" stopColor={currency === 'usd' ? '#f5c16c' : '#6ee7c5'} stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
                      <XAxis dataKey="date" stroke="#8b9bb0" fontSize={12} tickLine={false} axisLine={false} />
                      <YAxis {...axis} />
                      <Tooltip formatter={tip} />
                      <Area
                        type="monotone"
                        dataKey="value"
                        name={suffix}
                        stroke={currency === 'usd' ? '#f5c16c' : '#6ee7c5'}
                        fill="url(#priceFill)"
                        strokeWidth={2}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}

            {category === 'apartments' && historyPerM2Data.length > 0 && (
              <div className="stat-block">
                <h4>{stats.historyPerM2Title}</h4>
                <div className="chart-box">
                  <ResponsiveContainer width="100%" height={220}>
                    <AreaChart data={historyPerM2Data}>
                      <defs>
                        <linearGradient id="m2Fill" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor={currency === 'usd' ? '#f5c16c' : '#5b8cff'} stopOpacity={0.35} />
                          <stop offset="100%" stopColor={currency === 'usd' ? '#f5c16c' : '#5b8cff'} stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
                      <XAxis dataKey="date" stroke="#8b9bb0" fontSize={12} tickLine={false} axisLine={false} />
                      <YAxis {...axis} />
                      <Tooltip formatter={tip} />
                      <Area
                        type="monotone"
                        dataKey="value"
                        name={currency === 'usd' ? '$/м²' : 'Br/м²'}
                        stroke={currency === 'usd' ? '#f5c16c' : '#5b8cff'}
                        fill="url(#m2Fill)"
                        strokeWidth={2}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}

            {category === 'apartments' && (
              <div className="modal-lists">
                <List title="3 самых дешёвых" items={stats.cheapest} currency={currency} />
                <List title="3 самых дорогих" items={stats.expensive} currency={currency} />
              </div>
            )}
          </>
        )}
    </Modal>
  )
}
