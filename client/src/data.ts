import type { NewsItem } from './types'

export const NEWS: NewsItem[] = [
  {
    id: 'n1',
    title: 'Telegram запустил новые мини-приложения',
    summary:
      'Теперь в Telegram можно запускать полноценные веб-приложения прямо внутри чата без установки.',
    date: '14 мая 2024',
    source: 'Telegram Blog',
  },
  {
    id: 'n2',
    title: 'Курс валют обновлён',
    summary:
      'Внесены изменения в расчёт курса美元 и EUR relative to BYN для региона Гомель.',
    date: '13 мая 2024',
    source: 'myfin.by',
  },
  {
    id: 'n3',
    title: 'Новые функции в ботах',
    summary:
      'Разработчики получили доступ к расширенным кнопкам и инлайн-клавиатурам.',
    date: '10 мая 2024',
    source: 'Telegram API',
  },
]

