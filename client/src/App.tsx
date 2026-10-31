import { useEffect } from 'react'
import { PricesPage } from './components/PricesPage'
import { RateWidget } from './components/RateWidget'
import { getTelegramWebApp } from './telegram'

export function App() {
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
          <strong>Цены</strong>
        </div>
        <RateWidget />
      </header>
      <main className="content">
        <PricesPage />
      </main>
    </div>
  )
}

export default App
