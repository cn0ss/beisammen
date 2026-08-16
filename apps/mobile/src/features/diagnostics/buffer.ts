export type ClientDiagnosticCategory =
  | 'upload'
  | 'auth_refresh'
  | 'instance_switch'
  | 'notification_registration';

export interface ClientDiagnosticEntry {
  id: string;
  timestamp: string;
  category: ClientDiagnosticCategory;
  message: string;
  context?: Record<string, unknown>;
}

const MAX_DIAGNOSTIC_ENTRIES = 50;
let entries: ClientDiagnosticEntry[] = [];
let sequence = 0;

function serializeContext(context: Record<string, unknown> | undefined) {
  if (!context) {
    return undefined;
  }

  return Object.fromEntries(
    Object.entries(context).map(([key, value]) => {
      if (value instanceof Error) {
        return [key, { name: value.name, message: value.message }];
      }

      if (
        value === null ||
        typeof value === 'string' ||
        typeof value === 'number' ||
        typeof value === 'boolean'
      ) {
        return [key, value];
      }

      return [key, String(value)];
    }),
  );
}

export function recordClientDiagnostic(
  category: ClientDiagnosticCategory,
  message: string,
  context?: Record<string, unknown>,
): void {
  sequence += 1;
  entries = [
    {
      id: `${Date.now()}:${sequence}`,
      timestamp: new Date().toISOString(),
      category,
      message,
      context: serializeContext(context),
    },
    ...entries,
  ].slice(0, MAX_DIAGNOSTIC_ENTRIES);
}

export function getClientDiagnostics(): ClientDiagnosticEntry[] {
  return entries;
}

export function clearClientDiagnostics(): void {
  entries = [];
}

export function formatClientDiagnostics(): string {
  if (entries.length === 0) {
    return 'Keine Diagnoseeinträge.';
  }

  return entries
    .map((entry) => {
      const context = entry.context ? ` ${JSON.stringify(entry.context)}` : '';
      return `${entry.timestamp} [${entry.category}] ${entry.message}${context}`;
    })
    .join('\n');
}
