type TelegramWebApp = {
  ready: () => void
  expand: () => void
  close: () => void
  themeParams?: Record<string, string>
}

export function getTelegramWebApp(): TelegramWebApp | null {
  const tg = (window as Window & { Telegram?: { WebApp?: TelegramWebApp } }).Telegram?.WebApp
  return tg ?? null
}
