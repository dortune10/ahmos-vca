'use client';

import { useCallback, useEffect, useState } from 'react';
import { apiFetch, ApiError } from '@/lib/api-client';
import { useCurrentUser } from '@/components/current-user-provider';
import { Card } from '@/components/ui/card';
import { Table } from '@/components/ui/table';
import { Button } from '@/components/ui/button';

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
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Visit Checklist</h1>
      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}
      {loading ? (
        <p>Loading tasks...</p>
      ) : (
        <Card>
          <Table>
            <thead>
              <tr>
                <th>Task</th>
                <th>Due</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {tasks.length === 0 && (
                <tr>
                  <td colSpan={4}>No tasks assigned.</td>
                </tr>
              )}
              {tasks.map((task) => (
                <tr key={task.id}>
                  <td>{task.taskType}</td>
                  <td>{new Date(task.dueAt).toLocaleDateString()}</td>
                  <td>{task.status}</td>
                  <td>
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
