type BadgeVariant = 'default' | 'success' | 'warning' | 'error' | 'info';

export function statusBadgeVariant(status: string): BadgeVariant {
  switch (status) {
    case 'running': return 'success';
    case 'paused': return 'warning';
    case 'starting': return 'info';
    case 'prepared': return 'info';
    case 'failed': return 'error';
    case 'orphaned': return 'warning';
    case 'stopped': return 'default';
    default: return 'default';
  }
}

export function statusLabel(status: string): string {
  switch (status) {
    case 'running': return 'Running';
    case 'paused': return 'Paused';
    case 'starting': return 'Starting';
    case 'prepared': return 'Ready';
    case 'failed': return 'Failed';
    case 'stopped': return 'Stopped';
    case 'orphaned': return 'Interrupted';
    case 'created': return 'Created';
    default: return status.charAt(0).toUpperCase() + status.slice(1);
  }
}

export function isActiveStatus(status: string): boolean {
  return ['running', 'paused', 'starting'].includes(status);
}

export function isTerminalStatus(status: string): boolean {
  return ['stopped', 'failed', 'orphaned'].includes(status);
}

export function isPreparedStatus(status: string): boolean {
  return status === 'prepared';
}

export function statusDescription(status: string): string {
  switch (status) {
    case 'running': return 'Game loop is active. Questions are being shown live.';
    case 'paused': return 'Game loop suspended. Can be resumed.';
    case 'starting': return 'Runtime is initialising. Will transition to running shortly.';
    case 'prepared': return 'Overlay URL is ready to share. Start the session when you are ready to go live.';
    case 'failed': return 'An unrecoverable error occurred. Scores may be partial.';
    case 'stopped': return 'Session was stopped by the user. Scores are preserved.';
    case 'orphaned': return 'Process restarted while this session was active. Scores are preserved up to the crash point.';
    default: return '';
  }
}
