import { useRegisterKeybindingContext } from "../keybindings/keybinding-context"
import { useKeybindings } from "../keybindings/use-keybinding"
import type { DialogLifecycleOptions } from "./types"

/**
 * Hook to manage the lifecycle of a dialog, including keybinding context registration
 * and Esc/cancel handling.
 *
 * This hook is the single source of truth for dialog cancellation logic. It ensures
 * that dialogs correctly register their context, handle the `select:cancel` action,
 * and respect dirty-state guards.
 *
 * @param options - Configuration options for the dialog lifecycle.
 */
export function useDialogLifecycle({
  contextName,
  onClose,
  isActive = true,
  preventCloseOn,
}: DialogLifecycleOptions): void {
  // Register the dialog's keybinding context. When active, bindings in this context
  // take precedence over global bindings.
  useRegisterKeybindingContext(contextName, isActive)

  // Register the cancel handler.
  useKeybindings(
    {
      "select:cancel": () => {
        // If a guard function is provided and returns true, prevent closing
        // (e.g., if there's dirty text input that shouldn't be lost)
        if (preventCloseOn?.()) {
          return
        }
        onClose()
      },
    },
    { context: contextName, isActive },
  )
}
