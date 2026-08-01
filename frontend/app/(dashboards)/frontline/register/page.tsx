'use client';

import { FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch, ApiError } from '@/lib/api-client';
import { useCurrentUser } from '@/components/current-user-provider';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

interface PersonResponse {
  id: string;
}

export default function RegisterPage() {
  const user = useCurrentUser();
  const router = useRouter();
  const isNurse = user.role === 'nurse';

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [phone, setPhone] = useState('');
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [lmpDate, setLmpDate] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();

    if (!user.facilityId) {
      setError('Your account has no facility assigned. Contact an admin.');
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const personBody: Record<string, string> = { firstName, phonePrimary: phone };
      if (isNurse) {
        if (lastName) personBody.lastName = lastName;
        if (dateOfBirth) personBody.dateOfBirth = dateOfBirth;
      }

      const person = await apiFetch<PersonResponse>('/persons', {
        method: 'POST',
        body: personBody,
      });

      const episodeBody: Record<string, string> = {
        personId: person.id,
        facilityId: user.facilityId,
      };
      if (isNurse && lmpDate) {
        episodeBody.lmpDate = lmpDate;
      }

      await apiFetch('/pregnancy-episodes', { method: 'POST', body: episodeBody });

      router.push('/frontline');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Registration failed.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">
        {isNurse ? 'Register Patient' : 'Quick Registration'}
      </h1>
      <Card>
        <form onSubmit={handleSubmit} className="space-y-4">
          <Input
            label="First name"
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
            required
          />
          {isNurse && (
            <Input
              label="Last name"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
            />
          )}
          <Input
            label="Phone number"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            required
          />
          {isNurse && (
            <>
              <Input
                label="Date of birth"
                type="date"
                value={dateOfBirth}
                onChange={(e) => setDateOfBirth(e.target.value)}
              />
              <Input
                label="Last menstrual period date"
                type="date"
                value={lmpDate}
                onChange={(e) => setLmpDate(e.target.value)}
              />
            </>
          )}
          {error && (
            <p role="alert" className="text-sm text-red-600">
              {error}
            </p>
          )}
          <Button type="submit" disabled={submitting}>
            {submitting ? 'Registering...' : 'Register'}
          </Button>
        </form>
      </Card>
    </div>
  );
}
