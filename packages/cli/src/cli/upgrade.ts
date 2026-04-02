import { Bus } from "@liteai/core/bus/index"
import { Config } from "@liteai/core/config/config"
import { Installation } from "@liteai/core/installation/index"

export async function upgrade() {
  const config = await Config.global()
  const method = await Installation.method()
  const latest = await Installation.latest(method).catch(() => {})
  if (!latest) return
  if (Installation.VERSION === latest) return

  const disabledByFlag = (() => {
    const value = process.env.LITEAI_DISABLE_AUTOUPDATE?.toLowerCase()
    return value === "true" || value === "1"
  })()

  if (config.autoupdate === false || disabledByFlag) {
    return
  }
  if (config.autoupdate === "notify") {
    await Bus.publish(Installation.Event.UpdateAvailable, { version: latest })
    return
  }

  if (method === "unknown") return
  await Installation.upgrade(method, latest)
    .then(() => Bus.publish(Installation.Event.Updated, { version: latest }))
    .catch(() => {})
}
