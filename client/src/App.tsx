import { useEffect, useState } from 'react'
import { NewsPage } from './components/NewsPage'
import { PricesPage } from './components/PricesPage'
import { RateWidget } from './components/RateWidget'
import { SettingsPage } from './components/SettingsPage'
import { getTelegramWebApp } from './telegram'
import type { Tab } from './types'

const TABS: { id: Tab; label: string }[] = [
  { id: 'news', label: 'Новости' },
  { id: 'prices', label: 'Цены' },
  { id: 'settings', label: 'Настройки' },
]

export function App() {
  const [tab, setTab] = useState<Tab>('prices')

  useEffect(() => {
    const tg = getTelegramWebApp()
    if (!tg) return
    tg.ready()
    tg.expand()
    const theme = tg.themeParams
    if (theme) {
      const root = document.documentElement
      Object.entries(theme).forEach(([key, value]) => {
        root.style.setProperty(`--tg-${key}`, String(value))
      })
    }
  }, [])

  return (
    <div className="app">
      <header className="app-header">
        <div className="app-title">
          <span>Мониторинг</span>
          <strong>{tab === 'news' ? 'Новости' : tab === 'settings' ? 'Настройки' : 'Цены'}</strong>
        </div>
        <RateWidget />
        <nav className="subtabs subtabs-3 top-tabs">
          {TABS.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`subtab ${tab === item.id ? 'active' : ''}`}
              onClick={() => setTab(item.id)}
            >
              {item.label}
            </button>
          ))}
        </nav>
      </header>
      <main className="content">
        {tab === 'news' && <NewsPage />}
        {tab === 'prices' && <PricesPage />}
        {tab === 'settings' && <SettingsPage />}
      </main>
    </div>
  )
}

export default App
