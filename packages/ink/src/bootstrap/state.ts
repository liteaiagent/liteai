// mock: to be implemented in CLI
let _interactionTimeDirty = false

export function updateLastInteractionTime(immediate?: boolean): void {
  if (immediate) {
    flushInteractionTime_inner()
  } else {
    _interactionTimeDirty = true
  }
}

function flushInteractionTime_inner(): void {
  // Mock state update
  _interactionTimeDirty = false
}
