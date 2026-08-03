'use client';

import { useEffect, useState } from 'react';
import { apiFetch, ApiError } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { Notice } from '@/components/ui/notice';
import { PageHeader } from '@/components/ui/page-header';
import { Select } from '@/components/ui/select';
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
    <div className="space-y-5">
      <PageHeader
        eyebrow="Whole tenant"
        title="Staff"
        description="Every staff account in your tenant. Assign a facility when you create the account — there is currently no way to change it afterwards."
      />

      {error && <Notice tone="error">{error}</Notice>}

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
          <Select
            label="Role"
            value={role}
            onChange={(e) => setRole(e.target.value as StaffUser['role'])}
          >
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </Select>
          <div className="space-y-1.5">
            <Select
              label="Facility"
              value={facilityId}
              onChange={(e) => setFacilityId(e.target.value)}
            >
              <option value="">— none —</option>
              {facilities.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </Select>
            {/* Real failure mode, hit in testing: an account created with no facility sees an
                empty caseload on every screen, and there is no endpoint to set one afterwards
                (see docs/DECISIONS.md "Still Open"). Warn at the only moment it is fixable. */}
            {!facilityId && (
              <p className="text-xs leading-relaxed text-ink-muted">
                A CHW, nurse or clinician with no facility will see no patients, and this cannot
                be changed after the account is created.
              </p>
            )}
          </div>
          <Button type="submit" disabled={submitting}>
            {submitting ? 'Creating...' : 'Create staff account'}
          </Button>
        </form>
      </Card>

      {loading ? (
        <p className="font-data text-xs uppercase tracking-[0.14em] text-ink-muted">
          Loading staff...
        </p>
      ) : (
        <Card>
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
              {staff.length === 0 && (
                <tr>
                  <td colSpan={4}>
                    <span className="block py-4 text-ink-muted">
                      No staff accounts yet. Create the first one above.
                    </span>
                  </td>
                </tr>
              )}
              {staff.map((s) => (
                <tr key={s.id}>
                  <td className="font-medium text-ink">{s.fullName}</td>
                  <td>
                    <span className="whitespace-nowrap font-data text-xs text-ink-soft">
                      {s.email}
                    </span>
                  </td>
                  <td>
                    <span className="font-data text-xs uppercase tracking-[0.08em] text-ink">
                      {s.role}
                    </span>
                  </td>
                  {/* An unassigned facility is the account-breaking state warned about above,
                      so it reads as absent rather than as ordinary data. */}
                  <td className={s.facilityId ? 'text-ink' : 'text-ink-muted'}>
                    {facilityName(s.facilityId)}
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
