# Quickstart: Phase UI-A (Minimal Plan Mode UI)

This feature introduces the minimal necessary UI components for the Plan Mode capability.

## Development

```bash
# Typecheck packages/ui
cd packages/ui
bun run typecheck

# In parallel or combined, run the frontend web app to preview changes
cd packages/web
bun run dev
```

## Reviewing UI

- The `Session Title Bar` should display the plan mode badge when the backend emits `plan.state_changed`.
- The `Plan Approval Dock` will appear dynamically when an agent tries to exit plan mode, asking the user to approve or reject the plan before proceeding.
- When the `Plan Approval Dock` is active, the chat prompt will be locked and a hint will direct the user to the dock.
