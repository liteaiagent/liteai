import * as i18n from "@solid-primitives/i18n"
import { createEffect, createMemo } from "solid-js"
import { createStore } from "solid-js/store"
import { createSimpleContext } from "../../context"
import { dict as uiAr } from "../../i18n/ar"
import { dict as uiBr } from "../../i18n/br"
import { dict as uiBs } from "../../i18n/bs"
import { dict as uiDa } from "../../i18n/da"
import { dict as uiDe } from "../../i18n/de"
import { dict as uiEn } from "../../i18n/en"
import { dict as uiEs } from "../../i18n/es"
import { dict as uiFr } from "../../i18n/fr"
import { dict as uiJa } from "../../i18n/ja"
import { dict as uiKo } from "../../i18n/ko"
import { dict as uiNo } from "../../i18n/no"
import { dict as uiPl } from "../../i18n/pl"
import { dict as uiRu } from "../../i18n/ru"
import { dict as uiTh } from "../../i18n/th"
import { dict as uiTr } from "../../i18n/tr"
import { dict as uiZh } from "../../i18n/zh"
import { dict as uiZht } from "../../i18n/zht"
import { Persist, persisted } from "./persist"

export type Locale =
  | "en"
  | "zh"
  | "zht"
  | "ko"
  | "de"
  | "es"
  | "fr"
  | "da"
  | "ja"
  | "pl"
  | "ru"
  | "ar"
  | "no"
  | "br"
  | "th"
  | "bs"
  | "tr"

type RawDictionary = typeof uiEn
type Dictionary = i18n.Flatten<RawDictionary>

function cookie(locale: Locale) {
  return `oc_locale=${encodeURIComponent(locale)}; Path=/; Max-Age=31536000; SameSite=Lax`
}

const LOCALES: readonly Locale[] = [
  "en",
  "zh",
  "zht",
  "ko",
  "de",
  "es",
  "fr",
  "da",
  "ja",
  "pl",
  "ru",
  "bs",
  "ar",
  "no",
  "br",
  "th",
  "tr",
]

const INTL: Record<Locale, string> = {
  en: "en",
  zh: "zh-Hans",
  zht: "zh-Hant",
  ko: "ko",
  de: "de",
  es: "es",
  fr: "fr",
  da: "da",
  ja: "ja",
  pl: "pl",
  ru: "ru",
  ar: "ar",
  no: "nb-NO",
  br: "pt-BR",
  th: "th",
  bs: "bs",
  tr: "tr",
}

const LABEL_KEY: Record<Locale, keyof Dictionary> = {
  en: "language.en",
  zh: "language.zh",
  zht: "language.zht",
  ko: "language.ko",
  de: "language.de",
  es: "language.es",
  fr: "language.fr",
  da: "language.da",
  ja: "language.ja",
  pl: "language.pl",
  ru: "language.ru",
  ar: "language.ar",
  no: "language.no",
  br: "language.br",
  th: "language.th",
  bs: "language.bs",
  tr: "language.tr",
}

const base = i18n.flatten(uiEn)

/** Build dictionaries from UI-only i18n files */
function buildUiDicts(): Record<Locale, Dictionary> {
  return {
    en: base,
    zh: { ...base, ...i18n.flatten(uiZh) },
    zht: { ...base, ...i18n.flatten(uiZht) },
    ko: { ...base, ...i18n.flatten(uiKo) },
    de: { ...base, ...i18n.flatten(uiDe) },
    es: { ...base, ...i18n.flatten(uiEs) },
    fr: { ...base, ...i18n.flatten(uiFr) },
    da: { ...base, ...i18n.flatten(uiDa) },
    ja: { ...base, ...i18n.flatten(uiJa) },
    pl: { ...base, ...i18n.flatten(uiPl) },
    ru: { ...base, ...i18n.flatten(uiRu) },
    ar: { ...base, ...i18n.flatten(uiAr) },
    no: { ...base, ...i18n.flatten(uiNo) },
    br: { ...base, ...i18n.flatten(uiBr) },
    th: { ...base, ...i18n.flatten(uiTh) },
    bs: { ...base, ...i18n.flatten(uiBs) },
    tr: { ...base, ...i18n.flatten(uiTr) },
  }
}

/** UI-only dictionaries (no host overrides) */
const UI_DICTS = buildUiDicts()

/**
 * Merge host-provided dictionaries on top of UI dictionaries.
 * The host (web app) passes its own i18n additions (terminal, file tree, etc.)
 */
export function mergeHostDictionaries(
  hostDicts: Partial<Record<Locale, Record<string, unknown>>>,
): Record<Locale, Dictionary> {
  const result = { ...UI_DICTS }
  for (const locale of LOCALES) {
    const host = hostDicts[locale]
    if (!host) continue
    result[locale] = { ...result[locale], ...(i18n.flatten(host) as unknown as Dictionary) }
  }
  return result
}

const localeMatchers: Array<{ locale: Locale; match: (language: string) => boolean }> = [
  { locale: "en", match: (language) => language.startsWith("en") },
  { locale: "zht", match: (language) => language.startsWith("zh") && language.includes("hant") },
  { locale: "zh", match: (language) => language.startsWith("zh") },
  { locale: "ko", match: (language) => language.startsWith("ko") },
  { locale: "de", match: (language) => language.startsWith("de") },
  { locale: "es", match: (language) => language.startsWith("es") },
  { locale: "fr", match: (language) => language.startsWith("fr") },
  { locale: "da", match: (language) => language.startsWith("da") },
  { locale: "ja", match: (language) => language.startsWith("ja") },
  { locale: "pl", match: (language) => language.startsWith("pl") },
  { locale: "ru", match: (language) => language.startsWith("ru") },
  { locale: "ar", match: (language) => language.startsWith("ar") },
  {
    locale: "no",
    match: (language) => language.startsWith("no") || language.startsWith("nb") || language.startsWith("nn"),
  },
  { locale: "br", match: (language) => language.startsWith("pt") },
  { locale: "th", match: (language) => language.startsWith("th") },
  { locale: "bs", match: (language) => language.startsWith("bs") },
  { locale: "tr", match: (language) => language.startsWith("tr") },
]

function detectLocale(): Locale {
  if (typeof navigator !== "object") return "en"

  const languages = navigator.languages?.length ? navigator.languages : [navigator.language]
  for (const language of languages) {
    if (!language) continue
    const normalized = language.toLowerCase()
    const match = localeMatchers.find((entry) => entry.match(normalized))
    if (match) return match.locale
  }

  return "en"
}

function normalizeLocale(value: string): Locale {
  return LOCALES.includes(value as Locale) ? (value as Locale) : "en"
}

/**
 * LanguageProvider — manages locale selection and translation.
 *
 * Accepts an optional `dictionaries` prop to merge host-specific translations
 * on top of the base UI translations. Without it, only UI-package i18n strings
 * are available.
 */
export const { use: useLanguage, provider: LanguageProvider } = createSimpleContext({
  name: "Language",
  init: (props?: { dictionaries?: Record<Locale, Dictionary> }) => {
    const dicts = props?.dictionaries ?? UI_DICTS

    const [store, setStore, _, ready] = persisted(
      Persist.global("language", ["language.v1"]),
      createStore({
        locale: detectLocale() as Locale,
      }),
    )

    const locale = createMemo<Locale>(() => normalizeLocale(store.locale))
    const intl = createMemo(() => INTL[locale()])

    const dict = createMemo<Dictionary>(() => dicts[locale()])

    const t = i18n.translator(dict, i18n.resolveTemplate)

    const label = (value: Locale) => t(LABEL_KEY[value])

    createEffect(() => {
      if (typeof document !== "object") return
      document.documentElement.lang = locale()
      // biome-ignore lint/suspicious/noDocumentCookie: no generic cookie store api available
      document.cookie = cookie(locale())
    })

    return {
      ready,
      locale,
      intl,
      locales: LOCALES,
      label,
      t,
      setLocale(next: Locale) {
        setStore("locale", normalizeLocale(next))
      },
    }
  },
})
