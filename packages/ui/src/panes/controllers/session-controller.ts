/**
 * SessionController — abstract interface for session CRUD operations.
 *
 * Components call these methods instead of `sdk.client.project.session.*`.
 * The implementation is responsible for both the API call and optimistic
 * local-store updates.
 */
export interface SessionController {
  /** Rename a session. Updates the store optimistically. */
  rename(sessionID: string, title: string): Promise<void>

  /** Archive a session (soft-delete). Removes from local store. */
  archive(sessionID: string): Promise<void>

  /** Permanently delete a session and its children. Returns `true` on success. */
  delete(sessionID: string): Promise<boolean>

  /** Publish a session for sharing. */
  share(sessionID: string): Promise<void>

  /** Unpublish a shared session. */
  unshare(sessionID: string): Promise<void>
}
