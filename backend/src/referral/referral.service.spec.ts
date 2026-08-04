import { Test, TestingModule } from '@nestjs/testing';
import {
  ReferralService,
  ReferralNotFoundError,
  TargetFacilityNotAcceptingReferralsError,
} from './referral.service';
import { SupabaseService } from '../common/supabase/supabase.service';
import { AuditService } from '../audit/audit.service';
import { EpisodeService } from '../episode/episode.service';
import { InvalidReferralStateError } from './referral-state-machine';

function buildCreateClient(options: { facilityAccepting: boolean; facilityExists: boolean }) {
  return {
    from: (table: string) => {
      if (table === 'facility') {
        return {
          select: () => ({
            eq: () => ({
              single: async () =>
                options.facilityExists
                  ? { data: { id: 'f2', accepting_referrals: options.facilityAccepting }, error: null }
                  : { data: null, error: { message: 'no rows' } },
            }),
          }),
        };
      }
      if (table === 'referral') {
        return {
          insert: (row: any) => ({
            select: () => ({
              single: async () => ({
                data: {
                  id: 'r1',
                  pregnancy_episode_id: row.pregnancy_episode_id,
                  from_facility_id: row.from_facility_id,
                  to_facility_id: row.to_facility_id,
                  reason_code: row.reason_code,
                  urgency: row.urgency,
                  status: row.status,
                  created_at: '2026-08-01T00:00:00.000Z',
                  accepted_at: null,
                  departed_at: null,
                  arrived_at: null,
                  closed_at: null,
                },
                error: null,
              }),
            }),
          }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  };
}

async function buildReferralService(
  supabaseService: SupabaseService,
  auditService: AuditService,
  episodeService: EpisodeService,
) {
  const module: TestingModule = await Test.createTestingModule({
    providers: [
      ReferralService,
      { provide: SupabaseService, useValue: supabaseService },
      { provide: AuditService, useValue: auditService },
      { provide: EpisodeService, useValue: episodeService },
    ],
  }).compile();
  return module.get<ReferralService>(ReferralService);
}

describe('ReferralService', () => {
  describe('create', () => {
    it('creates a referral, moves the episode to Referred, and logs an audit event', async () => {
      const supabaseService = {
        getClientForUser: () => buildCreateClient({ facilityAccepting: true, facilityExists: true }),
      } as unknown as SupabaseService;
      const auditLogMock = jest.fn().mockResolvedValue(undefined);
      const auditService = { log: auditLogMock } as unknown as AuditService;
      const updateStatusMock = jest.fn().mockResolvedValue({ id: 'e1', status: 'Referred' });
      const episodeService = { updateStatus: updateStatusMock } as unknown as EpisodeService;

      const service = await buildReferralService(supabaseService, auditService, episodeService);
      const result = await service.create('jwt', 'u1', 't1', {
        pregnancyEpisodeId: 'e1',
        toFacilityId: 'f2',
        reasonCode: 'suspected_preeclampsia',
        urgency: 'urgent',
      });

      expect(result.id).toBe('r1');
      expect(result.status).toBe('Created');
      expect(updateStatusMock).toHaveBeenCalledWith('jwt', 'u1', 'e1', 'Referred');
      expect(auditLogMock).toHaveBeenCalledWith(
        expect.objectContaining({ tenantId: 't1', entityType: 'referral', action: 'created' }),
      );
    });

    it('rejects with TargetFacilityNotAcceptingReferralsError when the target facility is not accepting referrals', async () => {
      const supabaseService = {
        getClientForUser: () => buildCreateClient({ facilityAccepting: false, facilityExists: true }),
      } as unknown as SupabaseService;
      const auditService = { log: jest.fn() } as unknown as AuditService;
      const updateStatusMock = jest.fn();
      const episodeService = { updateStatus: updateStatusMock } as unknown as EpisodeService;

      const service = await buildReferralService(supabaseService, auditService, episodeService);

      await expect(
        service.create('jwt', 'u1', 't1', {
          pregnancyEpisodeId: 'e1',
          toFacilityId: 'f2',
          reasonCode: 'suspected_preeclampsia',
          urgency: 'urgent',
        }),
      ).rejects.toThrow(TargetFacilityNotAcceptingReferralsError);
      expect(updateStatusMock).not.toHaveBeenCalled();
    });

    it('rejects with TargetFacilityNotAcceptingReferralsError when the target facility does not exist', async () => {
      const supabaseService = {
        getClientForUser: () => buildCreateClient({ facilityAccepting: true, facilityExists: false }),
      } as unknown as SupabaseService;
      const auditService = { log: jest.fn() } as unknown as AuditService;
      const episodeService = { updateStatus: jest.fn() } as unknown as EpisodeService;

      const service = await buildReferralService(supabaseService, auditService, episodeService);

      await expect(
        service.create('jwt', 'u1', 't1', {
          pregnancyEpisodeId: 'e1',
          toFacilityId: 'missing',
          reasonCode: 'suspected_preeclampsia',
          urgency: 'urgent',
        }),
      ).rejects.toThrow(TargetFacilityNotAcceptingReferralsError);
    });
  });

  describe('updateStatus', () => {
    it('accepts a valid transition, stamps the milestone timestamp, and logs an audit event with from/to', async () => {
      const supabaseService = {
        getClientForUser: () => buildUpdateStatusClient({ found: true, existingStatus: 'Sent' }),
      } as unknown as SupabaseService;
      const auditLogMock = jest.fn().mockResolvedValue(undefined);
      const auditService = { log: auditLogMock } as unknown as AuditService;
      const updateStatusMock = jest.fn().mockResolvedValue({ id: 'e1', status: 'Active' });
      const episodeService = { updateStatus: updateStatusMock } as unknown as EpisodeService;

      const service = await buildReferralService(supabaseService, auditService, episodeService);
      const result = await service.updateStatus('jwt', 'u1', 'r1', 'Accepted');

      expect(result.status).toBe('Accepted');
      expect(result.acceptedAt).not.toBeNull();
      expect(auditLogMock).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: 't1',
          entityType: 'referral',
          action: 'status_changed',
          metadata: { from: 'Sent', to: 'Accepted' },
        }),
      );
      // Accepted is neither Arrived nor a terminal status, so no episode side effect fires
      expect(updateStatusMock).not.toHaveBeenCalled();
    });

    it('reaching Arrived moves the linked episode to Admitted', async () => {
      const supabaseService = {
        getClientForUser: () => buildUpdateStatusClient({ found: true, existingStatus: 'InTransit' }),
      } as unknown as SupabaseService;
      const auditService = { log: jest.fn().mockResolvedValue(undefined) } as unknown as AuditService;
      const updateStatusMock = jest.fn().mockResolvedValue({ id: 'e1', status: 'Admitted' });
      const episodeService = { updateStatus: updateStatusMock } as unknown as EpisodeService;

      const service = await buildReferralService(supabaseService, auditService, episodeService);
      const result = await service.updateStatus('jwt', 'u1', 'r1', 'Arrived');

      expect(result.status).toBe('Arrived');
      expect(result.arrivedAt).not.toBeNull();
      expect(result.closedAt).toBeNull();
      expect(updateStatusMock).toHaveBeenCalledWith('jwt', 'u1', 'e1', 'Admitted');
    });

    it.each(['Failed', 'Cancelled'])(
      'reaching %s reverts the linked episode to Active and stamps closed_at',
      async (terminalStatus) => {
        const fromStatus = terminalStatus === 'Failed' ? 'InTransit' : 'Sent';
        const supabaseService = {
          getClientForUser: () => buildUpdateStatusClient({ found: true, existingStatus: fromStatus }),
        } as unknown as SupabaseService;
        const auditService = { log: jest.fn().mockResolvedValue(undefined) } as unknown as AuditService;
        const updateStatusMock = jest.fn().mockResolvedValue({ id: 'e1', status: 'Active' });
        const episodeService = { updateStatus: updateStatusMock } as unknown as EpisodeService;

        const service = await buildReferralService(supabaseService, auditService, episodeService);
        const result = await service.updateStatus('jwt', 'u1', 'r1', terminalStatus);

        expect(result.status).toBe(terminalStatus);
        expect(result.closedAt).not.toBeNull();
        expect(updateStatusMock).toHaveBeenCalledWith('jwt', 'u1', 'e1', 'Active');
      },
    );

    it('reaching Completed stamps closed_at but does not touch the episode status', async () => {
      const supabaseService = {
        getClientForUser: () => buildUpdateStatusClient({ found: true, existingStatus: 'Arrived' }),
      } as unknown as SupabaseService;
      const auditService = { log: jest.fn().mockResolvedValue(undefined) } as unknown as AuditService;
      const updateStatusMock = jest.fn();
      const episodeService = { updateStatus: updateStatusMock } as unknown as EpisodeService;

      const service = await buildReferralService(supabaseService, auditService, episodeService);
      const result = await service.updateStatus('jwt', 'u1', 'r1', 'Completed');

      expect(result.status).toBe('Completed');
      expect(result.closedAt).not.toBeNull();
      expect(updateStatusMock).not.toHaveBeenCalled();
    });

    it('throws ReferralNotFoundError when the referral does not exist', async () => {
      const supabaseService = {
        getClientForUser: () => buildUpdateStatusClient({ found: false }),
      } as unknown as SupabaseService;
      const auditService = { log: jest.fn() } as unknown as AuditService;
      const episodeService = { updateStatus: jest.fn() } as unknown as EpisodeService;

      const service = await buildReferralService(supabaseService, auditService, episodeService);

      await expect(service.updateStatus('jwt', 'u1', 'missing', 'Sent')).rejects.toThrow(
        ReferralNotFoundError,
      );
    });

    it('throws InvalidReferralStateError for the PRD example Completed -> InTransit and never touches the row', async () => {
      const supabaseService = {
        getClientForUser: () => buildUpdateStatusClient({ found: true, existingStatus: 'Completed' }),
      } as unknown as SupabaseService;
      const auditLogMock = jest.fn();
      const auditService = { log: auditLogMock } as unknown as AuditService;
      const updateStatusMock = jest.fn();
      const episodeService = { updateStatus: updateStatusMock } as unknown as EpisodeService;

      const service = await buildReferralService(supabaseService, auditService, episodeService);

      await expect(service.updateStatus('jwt', 'u1', 'r1', 'InTransit')).rejects.toThrow(
        InvalidReferralStateError,
      );
      expect(auditLogMock).not.toHaveBeenCalled();
      expect(updateStatusMock).not.toHaveBeenCalled();
    });
  });

  describe('getById', () => {
    it('returns the referral when found', async () => {
      const supabaseService = {
        getClientForUser: () => buildGetByIdClient({ found: true }),
      } as unknown as SupabaseService;
      const auditService = { log: jest.fn() } as unknown as AuditService;
      const episodeService = { updateStatus: jest.fn() } as unknown as EpisodeService;

      const service = await buildReferralService(supabaseService, auditService, episodeService);
      const result = await service.getById('jwt', 'r1');

      expect(result.status).toBe('Sent');
    });

    it('throws ReferralNotFoundError when missing', async () => {
      const supabaseService = {
        getClientForUser: () => buildGetByIdClient({ found: false }),
      } as unknown as SupabaseService;
      const auditService = { log: jest.fn() } as unknown as AuditService;
      const episodeService = { updateStatus: jest.fn() } as unknown as EpisodeService;

      const service = await buildReferralService(supabaseService, auditService, episodeService);

      await expect(service.getById('jwt', 'missing')).rejects.toThrow(ReferralNotFoundError);
    });
  });

  describe('listForFacility', () => {
    it("direction 'incoming' filters by to_facility_id", async () => {
      const { client, eqMock } = buildListClient([
        {
          id: 'r1', pregnancy_episode_id: 'e1', from_facility_id: 'f1', to_facility_id: 'f2',
          reason_code: 'x', urgency: 'urgent', status: 'Sent', created_at: '2026-08-01T00:00:00.000Z',
          accepted_at: null, departed_at: null, arrived_at: null, closed_at: null,
        },
      ]);
      const supabaseService = { getClientForUser: () => client } as unknown as SupabaseService;
      const auditService = { log: jest.fn() } as unknown as AuditService;
      const episodeService = { updateStatus: jest.fn() } as unknown as EpisodeService;

      const service = await buildReferralService(supabaseService, auditService, episodeService);
      const result = await service.listForFacility('jwt', 'f2', 'incoming');

      expect(eqMock).toHaveBeenCalledWith('to_facility_id', 'f2');
      expect(result).toHaveLength(1);
    });

    it("direction 'outgoing' filters by from_facility_id", async () => {
      const { client, eqMock } = buildListClient([]);
      const supabaseService = { getClientForUser: () => client } as unknown as SupabaseService;
      const auditService = { log: jest.fn() } as unknown as AuditService;
      const episodeService = { updateStatus: jest.fn() } as unknown as EpisodeService;

      const service = await buildReferralService(supabaseService, auditService, episodeService);
      await service.listForFacility('jwt', 'f1', 'outgoing');

      expect(eqMock).toHaveBeenCalledWith('from_facility_id', 'f1');
    });
  });
});

function buildUpdateStatusClient(options: { found: boolean; existingStatus?: string }) {
  const referralTable = {
    select: () => ({
      eq: () => ({
        single: async () =>
          options.found
            ? { data: { status: options.existingStatus }, error: null }
            : { data: null, error: { message: 'no rows' } },
      }),
    }),
    update: (patch: any) => ({
      eq: () => ({
        select: () => ({
          single: async () => ({
            data: {
              id: 'r1',
              pregnancy_episode_id: 'e1',
              from_facility_id: 'f1',
              to_facility_id: 'f2',
              reason_code: 'suspected_preeclampsia',
              urgency: 'urgent',
              status: patch.status,
              created_at: '2026-08-01T00:00:00.000Z',
              accepted_at: patch.accepted_at ?? null,
              departed_at: patch.departed_at ?? null,
              arrived_at: patch.arrived_at ?? null,
              closed_at: patch.closed_at ?? null,
              pregnancy_episode: { facility_id: 'f1', facility: { tenant_id: 't1' } },
            },
            error: null,
          }),
        }),
      }),
    }),
  };
  return { from: () => referralTable };
}

function buildGetByIdClient(options: { found: boolean }) {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          single: async () =>
            options.found
              ? {
                  data: {
                    id: 'r1',
                    pregnancy_episode_id: 'e1',
                    from_facility_id: 'f1',
                    to_facility_id: 'f2',
                    reason_code: 'suspected_preeclampsia',
                    urgency: 'urgent',
                    status: 'Sent',
                    created_at: '2026-08-01T00:00:00.000Z',
                    accepted_at: null,
                    departed_at: null,
                    arrived_at: null,
                    closed_at: null,
                  },
                  error: null,
                }
              : { data: null, error: { message: 'no rows' } },
        }),
      }),
    }),
  };
}

function buildListClient(rows: any[]) {
  const eqMock = jest.fn();
  const builder: any = {
    eq: (...args: any[]) => {
      eqMock(...args);
      return builder;
    },
    order: () => Promise.resolve({ data: rows, error: null }),
  };
  const selectMock = jest.fn().mockReturnValue(builder);
  return { client: { from: () => ({ select: selectMock }) }, eqMock };
}

describe('ReferralService.getLatestForEpisodeAsSystem', () => {
  it('returns the most recent referral for the episode via the service-role client', async () => {
    const maybeSingleMock = jest.fn().mockResolvedValue({
      data: {
        id: 'ref1',
        pregnancy_episode_id: 'ep1',
        from_facility_id: 'f1',
        to_facility_id: 'f2',
        reason_code: 'high_risk',
        urgency: 'urgent',
        status: 'Sent',
        created_at: '2026-08-01T00:00:00.000Z',
        accepted_at: null,
        departed_at: null,
        arrived_at: null,
        closed_at: null,
      },
      error: null,
    });
    const serviceClient = {
      from: () => ({
        select: () => ({
          eq: () => ({
            order: () => ({
              limit: () => ({ maybeSingle: maybeSingleMock }),
            }),
          }),
        }),
      }),
    };
    const supabaseService = { getServiceClient: () => serviceClient } as unknown as SupabaseService;
    const auditService = { log: jest.fn() } as unknown as AuditService;
    const episodeService = {} as unknown as EpisodeService;
    const service = new ReferralService(supabaseService, auditService, episodeService);

    const result = await service.getLatestForEpisodeAsSystem('ep1');

    expect(result?.id).toBe('ref1');
    expect(result?.status).toBe('Sent');
  });

  it('returns null when the episode has no referral', async () => {
    const serviceClient = {
      from: () => ({
        select: () => ({
          eq: () => ({
            order: () => ({
              limit: () => ({ maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }) }),
            }),
          }),
        }),
      }),
    };
    const supabaseService = { getServiceClient: () => serviceClient } as unknown as SupabaseService;
    const auditService = { log: jest.fn() } as unknown as AuditService;
    const episodeService = {} as unknown as EpisodeService;
    const service = new ReferralService(supabaseService, auditService, episodeService);

    const result = await service.getLatestForEpisodeAsSystem('ep-none');

    expect(result).toBeNull();
  });
});
