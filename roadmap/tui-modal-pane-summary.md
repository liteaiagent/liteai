# TUI Modal Pane Migration Summary

## What was done
The UI architecture of the TUI was successfully migrated from a legacy stack-based overlay system (`DialogProvider`) to a modern, state-driven, single-slot modal pane architecture (modeled after Claude Code). The specific completions include:

* **Infrastructure:** Created `ModalPaneProvider` for single-slot modal state management and wrapped the session route.
* **Dialog Migrations:** Refactored 18 simple dialogs to use the modal pane with an `onClose` callback pattern (e.g. `DialogEffort`, `DialogTheme`, `DialogDoctor`, `DialogHelpV2`) instead of `dialog.pop/clear`.
* **Complex Dialogs:** Fully migrated `dialog-model.tsx` and `dialog-mcp.tsx` to use `useModalPane`, including updating sub-navigation flows to swap out modal content. 
* **Command Dispatch:** Rewired all `tuiInterceptors` in `prompt-input.tsx` to dispatch commands into the `ModalPane` rather than the old dialog stack.
* **Context-Aware Navigation Fix:** Implemented a strategy hook (`useNavigation()`) to prevent crashes when components like `DialogModel` are rendered outside `ModalPaneProvider` (e.g. during auth flows), falling back to the legacy dialog stack as needed.
* **Tabs & Settings Consolidation:** Built a reusable `Tabs` component, introduced a Claude Code-style `/config` tabbed pane, and consolidated TUI settings into the core `settings.json` file for portability.

* **Complex Dialog Internal Navigation:** Multi-step dialogs (`DialogRewind`, `DialogAgentList`, `DialogPlugin`, `DialogSessionList`, `DialogWorkspace`, and `DialogProvider`) have been successfully updated to replace their internal `useDialog()` stack-based routing with local view state management (`[view, setView]`).

## What is remaining (Deferred Work)
1. **Legacy Cleanup:** Now that internal `useDialog()` usages are largely removed, the old `<DialogProvider>` in `app.tsx`, `context/dialog.tsx`, and the floating overlay rendering code in `session-layout.tsx` should be fully deleted. (Note: A few components like `DialogSelect`, `DialogModel`, and `DialogHelp` may still need to be swapped to `useNavigation` or `useModalPane` before the provider can be fully deleted).
2. **Home Route Modal:** `ProviderSetupBanner` on the home route currently still uses `dialog.push()`. A minimal modal slot must be added to the `HomeRoute` since it lacks the `SessionLayout` where the new pane lives.