'use client';

import { useEffect, useState } from 'react';
import { apiFetch, ApiError } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { Table } from '@/components/ui/table';

interface Facility {
  id: string;
  tenantId: string;
  name: string;
  type: 'community' | 'clinic' | 'hospital';
  contactPhone: string | null;
  acceptingReferrals: boolean;
}

const FACILITY_TYPES: Facility['type'][] = ['community', 'clinic', 'hospital'];

export default function FacilitiesPage() {
  const [facilities, setFacilities] = useState<Facility[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [type, setType] = useState<Facility['type']>('clinic');
  const [contactPhone, setContactPhone] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function loadFacilities() {
    setLoading(true);
    setError(null);
    try {
      const data = await apiFetch<Facility[]>('/facilities');
      setFacilities(data);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load facilities');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadFacilities();
  }, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await apiFetch<Facility>('/facilities', {
        method: 'POST',
        body: { name, type, contactPhone: contactPhone || undefined },
      });
      setName('');
      setContactPhone('');
      setType('clinic');
      await loadFacilities();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to create facility');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleToggleAcceptingReferrals(facility: Facility) {
    setError(null);
    try {
      await apiFetch<Facility>(`/facilities/${facility.id}`, {
        method: 'PATCH',
        body: { acceptingReferrals: !facility.acceptingReferrals },
      });
      await loadFacilities();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to update facility');
    }
  }

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-xl font-semibold">Facilities</h1>

      {error && <p role="alert">{error}</p>}

      <Card>
        <form onSubmit={handleCreate} className="space-y-4" aria-label="Create facility">
          <Input label="Name" value={name} onChange={(e) => setName(e.target.value)} required />
          <label>
            Type
            <select value={type} onChange={(e) => setType(e.target.value as Facility['type'])}>
              {FACILITY_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>
          <Input
            label="Contact phone"
            value={contactPhone}
            onChange={(e) => setContactPhone(e.target.value)}
          />
          <Button type="submit" disabled={submitting}>
            {submitting ? 'Creating...' : 'Create facility'}
          </Button>
        </form>
      </Card>

      {loading ? (
        <p>Loading facilities...</p>
      ) : (
        <Table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Type</th>
              <th>Contact phone</th>
              <th>Accepting referrals</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {facilities.map((facility) => (
              <tr key={facility.id}>
                <td>{facility.name}</td>
                <td>{facility.type}</td>
                <td>{facility.contactPhone ?? '—'}</td>
                <td>{facility.acceptingReferrals ? 'Yes' : 'No'}</td>
                <td>
                  <Button onClick={() => handleToggleAcceptingReferrals(facility)}>
                    {facility.acceptingReferrals ? 'Stop accepting' : 'Start accepting'}
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </div>
  );
}
