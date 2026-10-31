import { useEffect, useState } from 'react'
import { api } from '../api'

export function RateWidget() {
  const [rates, setRates] = useState<{ usd: number | null; eur: number | null; rub: number | null } | null>(null)

  useEffect(() => {
    api
      .rates()
      .then(setRates)
      .catch(() => setRates(null))
  }, [])

  const items = [
    { code: 'USD', value: rates?.usd },
    { code: 'EUR', value: rates?.eur },
    { code: 'RUB', value: rates?.rub },
  ]

  return (
    <div className="header-rates" aria-label="Курс валют">
      {items.map((item) => (
        <span key={item.code}>
          <b>{item.code}</b> {item.value != null ? item.value.toFixed(2) : '—'}
        </span>
      ))}
    </div>
  )
}
