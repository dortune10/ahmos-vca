import Link from 'next/link';
import { Card } from '@/components/ui/card';

export default function AdminHomePage() {
  return (
    <div className="p-6 space-y-4">
      <h1 className="text-xl font-semibold">Admin</h1>
      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <Link href="/admin/facilities">Facilities</Link>
        </Card>
        <Card>
          <Link href="/admin/staff">Staff</Link>
        </Card>
        <Card>
          <Link href="/admin/audit">Audit Log</Link>
        </Card>
      </div>
    </div>
  );
}
