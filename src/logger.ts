// ============================================================
// Audit Logger — structured query audit trail
// ============================================================

export interface AuditEntry {
  readonly timestamp: string;
  readonly tool: string;
  readonly database: string;
  readonly query?: string;
  readonly durationMs: number;
  readonly rowCount?: number;
  readonly blocked?: boolean;
  readonly blockedReason?: string;
  readonly error?: string;
}

type LogSink = (entry: AuditEntry) => void;

const sinks: LogSink[] = [];

/**
 * Register a log sink that receives every audit entry.
 * Default: stderr. Users can add file/remote sinks.
 */
export function addLogSink(sink: LogSink): void {
  sinks.push(sink);
}

/**
 * Remove all registered sinks (useful for testing).
 */
export function clearLogSinks(): void {
  sinks.length = 0;
}

/**
 * Default stderr sink — structured JSON per line.
 */
function stderrSink(entry: AuditEntry): void {
  console.error(JSON.stringify({ audit: true, ...entry }));
}

// Register default sink
sinks.push(stderrSink);

/**
 * Log an audit entry to all registered sinks.
 */
export function logAudit(entry: AuditEntry): void {
  for (const sink of sinks) {
    try {
      sink(entry);
    } catch {
      // Never let a sink failure break the tool
    }
  }
}

/**
 * Create a timer for measuring query duration.
 * Returns a function that gives elapsed milliseconds.
 */
export function startTimer(): () => number {
  const start = performance.now();
  return () => Math.round(performance.now() - start);
}
