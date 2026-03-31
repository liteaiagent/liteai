/**
 * PermissionController — abstract interface for auto-accept (YOLO) permission state.
 *
 * Components use this to read and toggle auto-accept mode without
 * depending on the web-specific `usePermission()` context.
 *
 * The host platform (Web, VSCode) provides an implementation:
 * - Web: wraps `usePermission()` from the web permission context
 * - VSCode: manages auto-accept state via postMessage IPC
 */
export interface PermissionController {
  /** Whether auto-accept (YOLO) is active for this session/directory. */
  isAutoAccepting(sessionID: string | undefined): boolean

  /** Toggle auto-accept for the given session/directory. */
  toggle(sessionID: string | undefined): void
}
