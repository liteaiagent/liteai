import { mergeHostDictionaries } from "@/context/language"
import { dict as ar } from "./ar"
import { dict as br } from "./br"
import { dict as bs } from "./bs"
import { dict as da } from "./da"
import { dict as de } from "./de"
import { dict as en } from "./en"
import { dict as es } from "./es"
import { dict as fr } from "./fr"
import { dict as ja } from "./ja"
import { dict as ko } from "./ko"
import { dict as no } from "./no"
import { dict as pl } from "./pl"
import { dict as ru } from "./ru"
import { dict as th } from "./th"
import { dict as tr } from "./tr"
import { dict as zh } from "./zh"
import { dict as zht } from "./zht"

/**
 * Web app dictionaries — merges web-specific i18n keys on top of UI-package base.
 *
 * After the pane extraction, `LanguageProvider` lives in `@liteai/ui/panes` and
 * only includes UI-package translations by default. The web app must pass its own
 * dictionaries via the `dictionaries` prop so that web-specific keys (error pages,
 * session UI, settings, etc.) are available.
 */
export const webDictionaries = mergeHostDictionaries({
  en,
  ar,
  br,
  bs,
  da,
  de,
  es,
  fr,
  ja,
  ko,
  no,
  pl,
  ru,
  th,
  tr,
  zh,
  zht,
})
