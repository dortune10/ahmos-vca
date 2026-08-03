'use client';

import { useCallback, useEffect, useState } from 'react';
import { apiFetch, ApiError } from '@/lib/api-client';
import { useCurrentUser } from '@/components/current-user-provider';
import { Card } from '@/components/ui/card';
import { Table } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Notice } from '@/components/ui/notice';
import { PageHeader } from '@/components/ui/page-header';

interface CareTask {
  id: string;
  pregnancyEpisodeId: string;
  taskType: string;
  assignedUserId: string | null;
  dueAt: string;
  completedAt: string | null;
  status: string;
  priority: string;
  createdAt: string;
  updatedAt: string;
}

export default function TaskListPage() {
  const user = useCurrentUser();
  const [tasks, setTasks] = useState<CareTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiFetch<CareTask[]>(`/tasks?assignedUserId=${user.id}`);
      setTasks(data);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load tasks.');
    } finally {
      setLoading(false);
    }
  }, [user.id]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleComplete(taskId: string) {
    setError(null);
    try {
      await apiFetch(`/tasks/${taskId}/complete`, { method: 'POST' });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to complete task.');
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Assigned to you"
        title="Visit Checklist"
        description="Care tasks on your name across every episode you hold. Mark one complete as you finish it, not at the end of the round."
      />
      {error && <Notice tone="error">{error}</Notice>}
      {loading ? (
        <p className="font-data text-xs uppercase tracking-[0.14em] text-ink-muted">
          Loading tasks...
        </p>
      ) : (
        <Card>
          <Table>
            <thead>
              <tr>
                <th>Task</th>
                <th>Due</th>
                <th>Status</th>
                <th>
                  <span className="sr-only">Action</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {tasks.length === 0 && (
                <tr>
                  <td colSpan={4}>
                    <span className="block py-4 text-ink-muted">No tasks assigned.</span>
                  </td>
                </tr>
              )}
              {tasks.map((task) => (
                <tr key={task.id}>
                  <td>
                    <span className="font-data text-xs text-ink">{task.taskType}</span>
                  </td>
                  <td>
                    <span className="whitespace-nowrap font-data text-xs">
                      {new Date(task.dueAt).toLocaleDateString()}
                    </span>
                  </td>
                  <td>
                    {/* A completed task recedes; anything still open stays at full ink so the
                        remaining work is what the eye lands on. */}
                    <span
                      className={`font-data text-xs uppercase tracking-[0.08em] ${
                        task.status === 'Completed' ? 'text-ink-muted' : 'text-ink'
                      }`}
                    >
                      {task.status}
                    </span>
                  </td>
                  <td className="whitespace-nowrap">
                    {task.status !== 'Completed' && (
                      <Button variant="secondary" onClick={() => handleComplete(task.id)}>
                        Mark complete
                      </Button>
                    )}
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
