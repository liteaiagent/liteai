import { isEnvTruthy } from './envUtils.js'

export function isMouseClicksDisabled(): boolean {
  return isEnvTruthy(process.env.LITEAI_DISABLE_MOUSE_CLICKS)
}
