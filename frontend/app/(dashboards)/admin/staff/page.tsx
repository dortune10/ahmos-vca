'use client';

import { useEffect, useState } from 'react';
import { apiFetch, ApiError } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { Table } from '@/components/ui/table';

interface StaffUser {
  id: string;
  tenantId: string;
  email: string;
  role: 'chw' | 'nurse' | 'clinician' | 'supervisor' | 'admin';
  facilityId: string | null;
  fullName: string;
}

interface FacilityOption {
  id: string;
  name: string;
}

const ROLES: StaffUser['role'][] = ['chw', 'nurse', 'clinician', 'supervisor', 'admin'];

export default function StaffPage() {
  const [staff, setStaff] = useState<StaffUser[]>([]);
  const [facilities, setFacilities] = useState<FacilityOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [role, setRole] = useState<StaffUser['role']>('chw');
  const [facilityId, setFacilityId] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function loadData() {
    setLoading(true);
    setError(null);
    try {
      const [staffData, facilityData] = await Promise.all([
        apiFetch<StaffUser[]>('/users'),
        apiFetch<FacilityOption[]>('/facilities'),
      ]);
      setStaff(staffData);
      setFacilities(facilityData);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load staff');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData();
  }, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await apiFetch('/users', {
        method: 'POST',
        body: {
          email,
          password,
          role,
          facilityId: facilityId || undefined,
          fullName,
        },
      });
      setEmail('');
      setPassword('');
      setFullName('');
      setRole('chw');
      setFacilityId('');
      await loadData();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to create staff account');
    } finally {
      setSubmitting(false);
    }
  }

  function facilityName(id: string | null): string {
    if (!id) return '—';
    return facilities.find((f) => f.id === id)?.name ?? id;
  }

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-xl font-semibold">Staff</h1>

      {error && <p role="alert">{error}</p>}

      <Card>
        <form onSubmit={handleCreate} className="space-y-4" aria-label="Create staff account">
          <Input
            label="Full name"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            required
          />
          <Input
            label="Email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          <Input
            label="Temporary password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
          <label>
            Role
            <select value={role} onChange={(e) => setRole(e.target.value as StaffUser['role'])}>
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </label>
          <label>
            Facility
            <select value={facilityId} onChange={(e) => setFacilityId(e.target.value)}>
              <option value="">— none —</option>
              {facilities.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
          </label>
          <Button type="submit" disabled={submitting}>
            {submitting ? 'Creating...' : 'Create staff account'}
          </Button>
        </form>
      </Card>

      {loading ? (
        <p>Loading staff...</p>
      ) : (
        <Table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Role</th>
              <th>Facility</th>
            </tr>
          </thead>
          <tbody>
            {staff.map((s) => (
              <tr key={s.id}>
                <td>{s.fullName}</td>
                <td>{s.email}</td>
                <td>{s.role}</td>
                <td>{facilityName(s.facilityId)}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </div>
  );
}
