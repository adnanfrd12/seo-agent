/** What every provider importer returns to the worker. */
export interface SyncResult {
  /** rows written per report */
  written: Record<string, number>;
  /** report name -> short error message; a non-empty map with some writes means a "partial" job */
  failures: Record<string, string>;
  /** set when Google rejected our authorization (revoked/expired), so the UI can ask to Reconnect */
  authError: unknown | null;
}
