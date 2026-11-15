import { createI18n } from 'vue-i18n'
import en from './locales/en.json'

// English first; add pl.json here for a Polish translation.
export const i18n = createI18n({
  legacy: false,
  locale: 'en',
  fallbackLocale: 'en',
  messages: { en },
  datetimeFormats: {
    en: {
      short: { day: 'numeric', month: 'short', timeZone: 'UTC' },
      day: { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' },
      month: { month: 'long', year: 'numeric', timeZone: 'UTC' },
      monthName: { month: 'long', timeZone: 'UTC' },
      time: { hour: '2-digit', minute: '2-digit' },
      dayTime: {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
      },
      long: { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' },
    },
  },
})
