'use client';

import { useEffect, useState } from 'react';
import { apiFetch, ApiError } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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
    <div className="p-6 space-y-6">
      <h1 className="text-xl font-semibold">Audit Log</h1>

      {error && <p role="alert">{error}</p>}

      <form onSubmit={handleFilterSubmit} className="flex items-end gap-2" aria-label="Filter audit log">
        <Input
          label="Entity type"
          value={entityTypeFilter}
          onChange={(e) => setEntityTypeFilter(e.target.value)}
          placeholder="e.g. facility"
        />
        <Button type="submit">Filter</Button>
      </form>

      {loading ? (
        <p>Loading audit log...</p>
      ) : (
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
            {events.map((event) => (
              <tr key={event.id}>
                <td>{new Date(event.eventTime).toLocaleString()}</td>
                <td>{event.actorUserId ?? 'system'}</td>
                <td>
                  {event.entityType}:{event.entityId}
                </td>
                <td>{event.action}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </div>
  );
}
