import { EtapiError } from './etapiClient';

export type RefreshFailureKind = 'notFound' | 'auth' | 'transient' | 'unknown';

export function classifyRefreshFailure(error: unknown): RefreshFailureKind {
  if (error instanceof EtapiError) {
    if (error.statusCode === 404) {
      return 'notFound';
    }
    if (error.statusCode === 401 || error.statusCode === 403) {
      return 'auth';
    }
    if (error.statusCode === 408 || error.statusCode === 429 || error.statusCode >= 500) {
      return 'transient';
    }
  }

  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    if (
      msg.includes('network')
      || msg.includes('fetch')
      || msg.includes('econn')
      || msg.includes('timed out')
      || msg.includes('timeout')
      || msg.includes('enotfound')
      || msg.includes('eai_again')
    ) {
      return 'transient';
    }
  }

  return 'unknown';
}

export function shouldUntrackAfterFailure(
  kind: RefreshFailureKind,
  consecutiveFailures: number,
  maxConsecutiveFailures: number,
): boolean {
  if (kind === 'notFound') {
    return true;
  }
  if (maxConsecutiveFailures <= 0) {
    return false;
  }
  return consecutiveFailures >= maxConsecutiveFailures;
}

export function shouldWarnAfterFailure(
  consecutiveFailures: number,
  warnAfterFailures: number,
): boolean {
  if (warnAfterFailures <= 0 || consecutiveFailures < warnAfterFailures) {
    return false;
  }
  return consecutiveFailures === warnAfterFailures || consecutiveFailures % warnAfterFailures === 0;
}

export function buildRefreshFailureMessage(
  noteTitle: string,
  kind: RefreshFailureKind,
  consecutiveFailures: number,
  maxConsecutiveFailures: number,
): string {
  const maxLabel = maxConsecutiveFailures > 0 ? String(maxConsecutiveFailures) : '∞';
  const prefix = `Trilium: Auto-refresh failed for "${noteTitle}" (attempt ${consecutiveFailures}/${maxLabel}).`;

  if (kind === 'auth') {
    return `${prefix} Authentication failed. Reconnect to Trilium to resume refreshing open notes.`;
  }
  if (kind === 'transient') {
    return `${prefix} Network/server issue detected. Retry now or wait for the next poll.`;
  }
  if (kind === 'notFound') {
    return `${prefix} Note was not found on the server. Auto-refresh tracking will stop for this note.`;
  }
  return `${prefix} Unexpected error while checking remote changes.`;
}
