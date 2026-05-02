import type { Database as BunDatabase } from "bun:sqlite"
import { Database } from "./db"

export namespace FTS {
  /**
   * Initialize FTS5 virtual table if it doesn't exist.
   * Called once during server startup.
   */
  export function initialize(db: BunDatabase): void {
    // Create FTS5 virtual table mirroring message text content
    db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS message_fts USING fts5(
        sessionID UNINDEXED,
        messageID UNINDEXED,
        role UNINDEXED,
        content,
        tokenize='porter unicode61'
      )
    `)
  }

  /**
   * Index a message's text content for FTS.
   * Called after message persistence.
   */
  export function index(params: { sessionID: string; messageID: string; role: string; content: string }): void {
    const db = Database.getRawSQLite()
    // Upsert: delete existing entry if present, then insert
    db.exec(`DELETE FROM message_fts WHERE messageID = ?`, [params.messageID])
    db.exec(`INSERT INTO message_fts (sessionID, messageID, role, content) VALUES (?, ?, ?, ?)`, [
      params.sessionID,
      params.messageID,
      params.role,
      params.content,
    ])
  }

  /**
   * Search messages across all sessions.
   */
  export function search(
    query: string,
    limit = 50,
  ): Array<{
    sessionID: string
    messageID: string
    role: string
    snippet: string
    rank: number
  }> {
    const db = Database.getRawSQLite()
    // Convert query to safe FTS5 query syntax if needed, or just let sqlite handle simple syntax
    type FTSResult = {
      sessionID: string
      messageID: string
      role: string
      snippet: string
      rank: number
    }

    return db
      .query<FTSResult, [string, number]>(
        `
      SELECT
        sessionID,
        messageID,
        role,
        snippet(message_fts, 3, '<mark>', '</mark>', '…', 32) as snippet,
        rank
      FROM message_fts
      WHERE message_fts MATCH ?
      ORDER BY rank
      LIMIT ?
    `,
      )
      .all(query, limit)
  }

  /**
   * Remove all FTS entries for a session (on session delete).
   */
  export function removeSession(sessionID: string): void {
    const db = Database.getRawSQLite()
    db.exec(`DELETE FROM message_fts WHERE sessionID = ?`, [sessionID])
  }
}
