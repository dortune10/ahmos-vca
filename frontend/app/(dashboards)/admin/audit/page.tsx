'use client';

import { useEffect, useState } from 'react';
import { apiFetch, ApiError } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Notice } from '@/components/ui/notice';
import { PageHeader } from '@/components/ui/page-header';
import { Table } from '@/components/ui/table';

interface AuditEvent {
  id: string;
  tenantId: string;
  actorUserId: string | null;
  entityType: string;
  entityId: string;
  action: string;
  eventTime: string;
  metadata: Record<string, unknown>;
}

export default function AuditLogPage() {
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [entityTypeFilter, setEntityTypeFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function loadEvents(entityType: string) {
    setLoading(true);
    setError(null);
    try {
      const query = entityType ? `?entityType=${encodeURIComponent(entityType)}` : '';
      const data = await apiFetch<AuditEvent[]>(`/audit-events${query}`);
      setEvents(data);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load audit log');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadEvents('');
    // Intentionally runs once on mount; the filter form triggers subsequent loads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleFilterSubmit(e: React.FormEvent) {
    e.preventDefault();
    loadEvents(entityTypeFilter);
  }

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Whole tenant · append-only"
        title="Audit Log"
        description="Every recorded change, by actor and entity. Entries are written once and can never be edited or deleted, including by an administrator."
      />

      {error && <Notice tone="error">{error}</Notice>}

      <form
        onSubmit={handleFilterSubmit}
        className="flex items-end gap-3"
        aria-label="Filter audit log"
      >
        <Input
          label="Entity type"
          value={entityTypeFilter}
          onChange={(e) => setEntityTypeFilter(e.target.value)}
          placeholder="e.g. facility"
          hint="Leave blank to show every entity type."
        />
        <Button type="submit">Filter</Button>
      </form>

      {loading ? (
        <p className="font-data text-xs uppercase tracking-[0.14em] text-ink-muted">
          Loading audit log...
        </p>
      ) : (
        <Card>
          <Table>
            <thead>
              <tr>
                <th>Time</th>
                <th>Actor</th>
                <th>Entity</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {events.length === 0 && (
                <tr>
                  <td colSpan={4}>
                    <span className="block py-4 text-ink-muted">
                      No audit events match this filter.
                    </span>
                  </td>
                </tr>
              )}
              {events.map((event) => (
                <tr key={event.id}>
                  <td>
                    <span className="whitespace-nowrap font-data text-xs tabular-nums text-ink">
                      {new Date(event.eventTime).toLocaleString()}
                    </span>
                  </td>
                  {/* A system-written entry is called out by weight, not hue: saturation stays
                      reserved for clinical risk bands. */}
                  <td>
                    <span
                      className={`font-data text-xs ${
                        event.actorUserId ? 'text-ink' : 'uppercase tracking-[0.08em] text-ink-muted'
                      }`}
                    >
                      {event.actorUserId ?? 'system'}
                    </span>
                  </td>
                  <td>
                    <span className="font-data text-xs text-ink">
                      {event.entityType}:{event.entityId}
                    </span>
                  </td>
                  <td>
                    <span className="font-data text-xs uppercase tracking-[0.08em] text-ink">
                      {event.action}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}
    </div>
  );
}
