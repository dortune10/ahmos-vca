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
    <div className="space-y-5">
      <PageHeader
        eyebrow="Whole tenant"
        title="Facilities"
        description="Every facility in your tenant. Only facilities currently accepting referrals can be chosen as the destination of a new referral."
      />

      {error && <Notice tone="error">{error}</Notice>}

      <Card>
        <form onSubmit={handleCreate} className="space-y-4" aria-label="Create facility">
          <Input label="Name" value={name} onChange={(e) => setName(e.target.value)} required />
          <Select
            label="Type"
            value={type}
            onChange={(e) => setType(e.target.value as Facility['type'])}
          >
            {FACILITY_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </Select>
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
        <p className="font-data text-xs uppercase tracking-[0.14em] text-ink-muted">
          Loading facilities...
        </p>
      ) : (
        <Card>
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
              {facilities.length === 0 && (
                <tr>
                  <td colSpan={5}>
                    <span className="block py-4 text-ink-muted">
                      No facilities yet. Create the first one above.
                    </span>
                  </td>
                </tr>
              )}
              {facilities.map((facility) => (
                <tr key={facility.id}>
                  <td className="font-medium text-ink">{facility.name}</td>
                  <td>
                    <span className="font-data text-xs uppercase tracking-[0.08em] text-ink-soft">
                      {facility.type}
                    </span>
                  </td>
                  <td>
                    <span className="whitespace-nowrap font-data text-xs text-ink">
                      {facility.contactPhone ?? '—'}
                    </span>
                  </td>
                  {/* Referral availability is an operational state, not a clinical risk band,
                      so it is marked by weight and rule rather than by hue. */}
                  <td>
                    <span
                      className={`font-data text-xs uppercase tracking-[0.08em] ${
                        facility.acceptingReferrals
                          ? 'border-l-2 border-ink pl-1.5 font-medium text-ink'
                          : 'text-ink-muted'
                      }`}
                    >
                      {facility.acceptingReferrals ? 'Yes' : 'No'}
                    </span>
                  </td>
                  <td>
                    <Button
                      variant="secondary"
                      onClick={() => handleToggleAcceptingReferrals(facility)}
                    >
                      {facility.acceptingReferrals ? 'Stop accepting' : 'Start accepting'}
                    </Button>
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
