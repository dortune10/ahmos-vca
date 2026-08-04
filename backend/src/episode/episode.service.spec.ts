import { Test, TestingModule } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  EpisodeService,
  PersonNotFoundError,
  EpisodeNotFoundError,
} from './episode.service';
import { SupabaseService } from '../common/supabase/supabase.service';
import { AuditService } from '../audit/audit.service';
import { TasksService } from '../tasks/tasks.service';

function buildCreateClient(options: { personExists: boolean }) {
  return {
    from: (table: string) => {
      if (table === 'person') {
        return {
          select: () => ({
            eq: () => ({
              single: async () =>
                options.personExists
                  ? { data: { id: 'p1' }, error: null }
                  : { data: null, error: { message: 'no rows' } },
            }),
          }),
        };
      }
      if (table === 'pregnancy_episode') {
        return {
          insert: (row: any) => ({
            select: () => ({
              single: async () => ({
                data: {
                  id: 'e1',
                  person_id: row.person_id,
                  facility_id: row.facility_id,
                  lmp_date: row.lmp_date,
                  estimated_delivery_date: row.estimated_delivery_date,
                  gestational_age_weeks: row.gestational_age_weeks,
                  risk_band: null,
                  status: row.status,
                  created_at: '2026-08-01T00:00:00.000Z',
                  updated_at: '2026-08-01T00:00:00.000Z',
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

async function buildEpisodeService(
  supabaseService: SupabaseService,
  auditService: AuditService,
  tasksService: TasksService,
  eventEmitter: EventEmitter2,
) {
  const module: TestingModule = await Test.createTestingModule({
    providers: [
      EpisodeService,
      { provide: SupabaseService, useValue: supabaseService },
      { provide: AuditService, useValue: auditService },
      { provide: TasksService, useValue: tasksService },
      { provide: EventEmitter2, useValue: eventEmitter },
    ],
  }).compile();
  return module.get<EpisodeService>(EpisodeService);
}

describe('EpisodeService', () => {
  describe('create', () => {
    it('creates an episode at status Active, generates the ANC schedule, and emits episode.created', async () => {
      const supabaseService = {
        getClientForUser: () => buildCreateClient({ personExists: true }),
      } as unknown as SupabaseService;
      const auditLogMock = jest.fn().mockResolvedValue(undefined);
      const auditService = { log: auditLogMock } as unknown as AuditService;
      const generateScheduleMock = jest.fn().mockResolvedValue([]);
      const tasksService = {
        generateInitialAncSchedule: generateScheduleMock,
      } as unknown as TasksService;
      const emitMock = jest.fn();
      const eventEmitter = { emit: emitMock } as unknown as EventEmitter2;

      const service = await buildEpisodeService(supabaseService, auditService, tasksService, eventEmitter);
      const result = await service.create('jwt', 'u1', 't1', { personId: 'p1', facilityId: 'f1' });

      expect(result.id).toBe('e1');
      expect(result.status).toBe('Active');
      expect(generateScheduleMock).toHaveBeenCalledWith('jwt', 'u1', 't1', 'e1');
      expect(auditLogMock).toHaveBeenCalledWith(
        expect.objectContaining({ entityType: 'pregnancy_episode', action: 'created' }),
      );
      expect(emitMock).toHaveBeenCalledWith('episode.created', {
        episodeId: 'e1',
        tenantId: 't1',
        actorUserId: 'u1',
      });
    });

    it('computes estimatedDeliveryDate from lmpDate via Naegele\'s rule (LMP + 280 days) when no EDD is given', async () => {
      const supabaseService = {
        getClientForUser: () => buildCreateClient({ personExists: true }),
      } as unknown as SupabaseService;
      const auditService = { log: jest.fn().mockResolvedValue(undefined) } as unknown as AuditService;
      const tasksService = {
        generateInitialAncSchedule: jest.fn().mockResolvedValue([]),
      } as unknown as TasksService;
      const eventEmitter = { emit: jest.fn() } as unknown as EventEmitter2;

      const service = await buildEpisodeService(supabaseService, auditService, tasksService, eventEmitter);
      const result = await service.create('jwt', 'u1', 't1', {
        personId: 'p1',
        facilityId: 'f1',
        lmpDate: '2026-03-15',
      });

      expect(result.lmpDate).toBe('2026-03-15');
      expect(result.estimatedDeliveryDate).toBe('2026-12-20');
    });

    it('uses an explicitly provided estimatedDeliveryDate over the LMP-derived one', async () => {
      const supabaseService = {
        getClientForUser: () => buildCreateClient({ personExists: true }),
      } as unknown as SupabaseService;
      const auditService = { log: jest.fn().mockResolvedValue(undefined) } as unknown as AuditService;
      const tasksService = {
        generateInitialAncSchedule: jest.fn().mockResolvedValue([]),
      } as unknown as TasksService;
      const eventEmitter = { emit: jest.fn() } as unknown as EventEmitter2;

      const service = await buildEpisodeService(supabaseService, auditService, tasksService, eventEmitter);
      const result = await service.create('jwt', 'u1', 't1', {
        personId: 'p1',
        facilityId: 'f1',
        lmpDate: '2026-03-15',
        estimatedDeliveryDate: '2026-12-25',
      });

      expect(result.estimatedDeliveryDate).toBe('2026-12-25');
    });

    it('leaves estimatedDeliveryDate null when neither LMP nor EDD is given', async () => {
      const supabaseService = {
        getClientForUser: () => buildCreateClient({ personExists: true }),
      } as unknown as SupabaseService;
      const auditService = { log: jest.fn().mockResolvedValue(undefined) } as unknown as AuditService;
      const tasksService = {
        generateInitialAncSchedule: jest.fn().mockResolvedValue([]),
      } as unknown as TasksService;
      const eventEmitter = { emit: jest.fn() } as unknown as EventEmitter2;

      const service = await buildEpisodeService(supabaseService, auditService, tasksService, eventEmitter);
      const result = await service.create('jwt', 'u1', 't1', { personId: 'p1', facilityId: 'f1' });

      expect(result.estimatedDeliveryDate).toBeNull();
    });

    it('throws PersonNotFoundError and never inserts an episode when the person does not exist', async () => {
      const supabaseService = {
        getClientForUser: () => buildCreateClient({ personExists: false }),
      } as unknown as SupabaseService;
      const auditService = { log: jest.fn() } as unknown as AuditService;
      const generateScheduleMock = jest.fn();
      const tasksService = {
        generateInitialAncSchedule: generateScheduleMock,
      } as unknown as TasksService;
      const eventEmitter = { emit: jest.fn() } as unknown as EventEmitter2;

      const service = await buildEpisodeService(supabaseService, auditService, tasksService, eventEmitter);

      await expect(
        service.create('jwt', 'u1', 't1', { personId: 'missing', facilityId: 'f1' }),
      ).rejects.toThrow(PersonNotFoundError);
      expect(generateScheduleMock).not.toHaveBeenCalled();
    });
  });

  function buildEncounterNoteClient(options: { episodeExists: boolean }) {
    return {
      from: (table: string) => {
        if (table === 'pregnancy_episode') {
          return {
            select: () => ({
              eq: () => ({
                single: async () =>
                  options.episodeExists
                    ? { data: { id: 'e1', facility: { tenant_id: 't1' } }, error: null }
                    : { data: null, error: { message: 'no rows' } },
              }),
            }),
          };
        }
        if (table === 'encounter_note') {
          return {
            insert: (row: any) => ({
              select: () => ({
                single: async () => ({
                  data: {
                    id: 'note-1',
                    pregnancy_episode_id: row.pregnancy_episode_id,
                    recorded_by: row.recorded_by,
                    recorded_at: '2026-08-01T00:00:00.000Z',
                    note_text: row.note_text,
                    vitals_json: row.vitals_json,
                    created_at: '2026-08-01T00:00:00.000Z',
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

  describe('recordEncounterNote', () => {
    it('records an encounter note and emits episode.clinical_data_updated with the derived tenant id', async () => {
      const supabaseService = {
        getClientForUser: () => buildEncounterNoteClient({ episodeExists: true }),
      } as unknown as SupabaseService;
      const auditLogMock = jest.fn().mockResolvedValue(undefined);
      const auditService = { log: auditLogMock } as unknown as AuditService;
      const tasksService = { generateInitialAncSchedule: jest.fn() } as unknown as TasksService;
      const emitMock = jest.fn();
      const eventEmitter = { emit: emitMock } as unknown as EventEmitter2;

      const service = await buildEpisodeService(supabaseService, auditService, tasksService, eventEmitter);
      const result = await service.recordEncounterNote('jwt', 'u1', 'e1', {
        noteText: 'Feeling fine.',
        vitals: { bpSystolic: 118, bpDiastolic: 76, temperatureC: 36.9, hemoglobinGdl: 12.1 },
      });

      expect(result.id).toBe('note-1');
      expect(auditLogMock).toHaveBeenCalledWith(
        expect.objectContaining({ tenantId: 't1', entityType: 'encounter_note', action: 'created' }),
      );
      expect(emitMock).toHaveBeenCalledWith('episode.clinical_data_updated', {
        episodeId: 'e1',
        tenantId: 't1',
        actorUserId: 'u1',
      });
    });

    it('throws EpisodeNotFoundError when the episode does not exist', async () => {
      const supabaseService = {
        getClientForUser: () => buildEncounterNoteClient({ episodeExists: false }),
      } as unknown as SupabaseService;
      const auditService = { log: jest.fn() } as unknown as AuditService;
      const tasksService = { generateInitialAncSchedule: jest.fn() } as unknown as TasksService;
      const eventEmitter = { emit: jest.fn() } as unknown as EventEmitter2;

      const service = await buildEpisodeService(supabaseService, auditService, tasksService, eventEmitter);

      await expect(service.recordEncounterNote('jwt', 'u1', 'missing', {})).rejects.toThrow(
        EpisodeNotFoundError,
      );
    });
  });

  function buildStatusClient(options: { episodeExists: boolean }) {
    return {
      from: (_table: string) => ({
        update: (patch: any) => ({
          eq: () => ({
            select: () => ({
              single: async () =>
                options.episodeExists
                  ? {
                      data: {
                        id: 'e1',
                        person_id: 'p1',
                        facility_id: 'f1',
                        lmp_date: null,
                        estimated_delivery_date: null,
                        gestational_age_weeks: null,
                        risk_band: null,
                        status: patch.status,
                        created_at: '2026-08-01T00:00:00.000Z',
                        updated_at: patch.updated_at,
                        facility: { tenant_id: 't1' },
                      },
                      error: null,
                    }
                  : { data: null, error: { message: 'no rows' } },
            }),
          }),
        }),
      }),
    };
  }

  describe('updateStatus', () => {
    it('updates the episode status and logs an audit event with the derived tenant id', async () => {
      const supabaseService = {
        getClientForUser: () => buildStatusClient({ episodeExists: true }),
      } as unknown as SupabaseService;
      const auditLogMock = jest.fn().mockResolvedValue(undefined);
      const auditService = { log: auditLogMock } as unknown as AuditService;
      const tasksService = { generateInitialAncSchedule: jest.fn() } as unknown as TasksService;
      const eventEmitter = { emit: jest.fn() } as unknown as EventEmitter2;

      const service = await buildEpisodeService(supabaseService, auditService, tasksService, eventEmitter);
      const result = await service.updateStatus('jwt', 'u1', 'e1', 'Referred');

      expect(result.status).toBe('Referred');
      expect(auditLogMock).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: 't1',
          entityType: 'pregnancy_episode',
          action: 'status_changed',
          metadata: { newStatus: 'Referred' },
        }),
      );
    });

    it('throws EpisodeNotFoundError when the episode does not exist', async () => {
      const supabaseService = {
        getClientForUser: () => buildStatusClient({ episodeExists: false }),
      } as unknown as SupabaseService;
      const auditService = { log: jest.fn() } as unknown as AuditService;
      const tasksService = { generateInitialAncSchedule: jest.fn() } as unknown as TasksService;
      const eventEmitter = { emit: jest.fn() } as unknown as EventEmitter2;

      const service = await buildEpisodeService(supabaseService, auditService, tasksService, eventEmitter);

      await expect(service.updateStatus('jwt', 'u1', 'missing', 'Referred')).rejects.toThrow(
        EpisodeNotFoundError,
      );
    });
  });

  function buildGetByIdClient(options: { found: boolean }) {
    return {
      from: () => ({
        select: () => ({
          eq: () => ({
            single: async () =>
              options.found
                ? {
                    data: {
                      id: 'e1',
                      person_id: 'p1',
                      facility_id: 'f1',
                      lmp_date: null,
                      estimated_delivery_date: null,
                      gestational_age_weeks: null,
                      risk_band: 'low',
                      status: 'Active',
                      created_at: '2026-08-01T00:00:00.000Z',
                      updated_at: '2026-08-01T00:00:00.000Z',
                    },
                    error: null,
                  }
                : { data: null, error: { message: 'no rows' } },
          }),
        }),
      }),
    };
  }

  function buildCaseloadClient(rows: any[]) {
    const eqMock = jest.fn();
    const builder: any = {
      eq: (...args: any[]) => {
        eqMock(...args);
        return builder;
      },
      then: (resolve: any) => resolve({ data: rows, error: null }),
    };
    const selectMock = jest.fn().mockReturnValue(builder);
    return { client: { from: () => ({ select: selectMock }) }, eqMock };
  }

  describe('getById', () => {
    it('returns the episode when found', async () => {
      const supabaseService = {
        getClientForUser: () => buildGetByIdClient({ found: true }),
      } as unknown as SupabaseService;
      const auditService = { log: jest.fn() } as unknown as AuditService;
      const tasksService = { generateInitialAncSchedule: jest.fn() } as unknown as TasksService;
      const eventEmitter = { emit: jest.fn() } as unknown as EventEmitter2;

      const service = await buildEpisodeService(supabaseService, auditService, tasksService, eventEmitter);
      const result = await service.getById('jwt', 'e1');

      expect(result.riskBand).toBe('low');
    });

    it('throws EpisodeNotFoundError when missing', async () => {
      const supabaseService = {
        getClientForUser: () => buildGetByIdClient({ found: false }),
      } as unknown as SupabaseService;
      const auditService = { log: jest.fn() } as unknown as AuditService;
      const tasksService = { generateInitialAncSchedule: jest.fn() } as unknown as TasksService;
      const eventEmitter = { emit: jest.fn() } as unknown as EventEmitter2;

      const service = await buildEpisodeService(supabaseService, auditService, tasksService, eventEmitter);

      await expect(service.getById('jwt', 'missing')).rejects.toThrow(EpisodeNotFoundError);
    });
  });

  describe('listForCaseload', () => {
    it('returns all visible episodes when no facilityId is given', async () => {
      const { client } = buildCaseloadClient([
        {
          id: 'e1',
          person_id: 'p1',
          facility_id: 'f1',
          lmp_date: null,
          estimated_delivery_date: null,
          gestational_age_weeks: null,
          risk_band: null,
          status: 'Active',
          created_at: '2026-08-01T00:00:00.000Z',
          updated_at: '2026-08-01T00:00:00.000Z',
        },
      ]);
      const supabaseService = { getClientForUser: () => client } as unknown as SupabaseService;
      const auditService = { log: jest.fn() } as unknown as AuditService;
      const tasksService = { generateInitialAncSchedule: jest.fn() } as unknown as TasksService;
      const eventEmitter = { emit: jest.fn() } as unknown as EventEmitter2;

      const service = await buildEpisodeService(supabaseService, auditService, tasksService, eventEmitter);
      const result = await service.listForCaseload('jwt');

      expect(result).toHaveLength(1);
    });

    it('filters by facilityId when given', async () => {
      const { client, eqMock } = buildCaseloadClient([]);
      const supabaseService = { getClientForUser: () => client } as unknown as SupabaseService;
      const auditService = { log: jest.fn() } as unknown as AuditService;
      const tasksService = { generateInitialAncSchedule: jest.fn() } as unknown as TasksService;
      const eventEmitter = { emit: jest.fn() } as unknown as EventEmitter2;

      const service = await buildEpisodeService(supabaseService, auditService, tasksService, eventEmitter);
      await service.listForCaseload('jwt', 'f1');

      expect(eqMock).toHaveBeenCalledWith('facility_id', 'f1');
    });
  });

  function buildEncounterNoteListClient(options: { episodeFound: boolean; rows?: any[] }) {
    const orderMock = jest.fn();
    const noteEqMock = jest.fn();
    return {
      orderMock,
      noteEqMock,
      client: {
        from: (table: string) => {
          if (table === 'pregnancy_episode') {
            return {
              select: () => ({
                eq: () => ({
                  single: async () =>
                    options.episodeFound
                      ? { data: { id: 'e1' }, error: null }
                      : { data: null, error: { message: 'no rows' } },
                }),
              }),
            };
          }
          if (table === 'encounter_note') {
            return {
              select: () => ({
                eq: (...eqArgs: any[]) => {
                  noteEqMock(...eqArgs);
                  return {
                    order: async (...orderArgs: any[]) => {
                      orderMock(...orderArgs);
                      return { data: options.rows ?? [], error: null };
                    },
                  };
                },
              }),
            };
          }
          throw new Error(`unexpected table ${table}`);
        },
      },
    };
  }

  function buildNoOpDeps() {
    return {
      auditService: { log: jest.fn() } as unknown as AuditService,
      tasksService: { generateInitialAncSchedule: jest.fn() } as unknown as TasksService,
      eventEmitter: { emit: jest.fn() } as unknown as EventEmitter2,
    };
  }

  describe('listEncounterNotes', () => {
    it('returns the episode notes mapped through EncounterNoteResponseDto', async () => {
      const { client } = buildEncounterNoteListClient({
        episodeFound: true,
        rows: [
          {
            id: 'n1',
            pregnancy_episode_id: 'e1',
            recorded_by: 'u1',
            recorded_at: '2026-08-02T00:00:00.000Z',
            note_text: 'Second visit, patient stable.',
            vitals_json: { bpSystolic: 118, bpDiastolic: 76 },
            created_at: '2026-08-02T00:00:00.000Z',
          },
          {
            id: 'n2',
            pregnancy_episode_id: 'e1',
            recorded_by: 'u1',
            recorded_at: '2026-08-01T00:00:00.000Z',
            note_text: 'First visit.',
            vitals_json: null,
            created_at: '2026-08-01T00:00:00.000Z',
          },
        ],
      });
      const supabaseService = { getClientForUser: () => client } as unknown as SupabaseService;
      const { auditService, tasksService, eventEmitter } = buildNoOpDeps();

      const service = await buildEpisodeService(supabaseService, auditService, tasksService, eventEmitter);
      const result = await service.listEncounterNotes('jwt', 'e1');

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('n1');
      expect(result[0].noteText).toBe('Second visit, patient stable.');
      expect(result[0].vitals).toEqual({ bpSystolic: 118, bpDiastolic: 76 });
      expect(result[1].vitals).toBeNull();
    });

    it('scopes the query to the episode and orders newest-first', async () => {
      const { client, orderMock, noteEqMock } = buildEncounterNoteListClient({ episodeFound: true });
      const supabaseService = { getClientForUser: () => client } as unknown as SupabaseService;
      const { auditService, tasksService, eventEmitter } = buildNoOpDeps();

      const service = await buildEpisodeService(supabaseService, auditService, tasksService, eventEmitter);
      await service.listEncounterNotes('jwt', 'e1');

      expect(noteEqMock).toHaveBeenCalledWith('pregnancy_episode_id', 'e1');
      expect(orderMock).toHaveBeenCalledWith('recorded_at', { ascending: false });
    });

    it('returns an empty array when the episode has no notes yet', async () => {
      const { client } = buildEncounterNoteListClient({ episodeFound: true, rows: [] });
      const supabaseService = { getClientForUser: () => client } as unknown as SupabaseService;
      const { auditService, tasksService, eventEmitter } = buildNoOpDeps();

      const service = await buildEpisodeService(supabaseService, auditService, tasksService, eventEmitter);

      await expect(service.listEncounterNotes('jwt', 'e1')).resolves.toEqual([]);
    });

    // Guards the ambiguity called out in listEncounterNotes(): the tenant-scoped RLS select
    // policy makes another tenant's episode return [] rather than error, so without the
    // episode existence check a clinician would be shown "no notes recorded" for a record
    // they simply cannot see.
    it('throws EpisodeNotFoundError instead of an empty list when the episode is not visible', async () => {
      const { client } = buildEncounterNoteListClient({ episodeFound: false });
      const supabaseService = { getClientForUser: () => client } as unknown as SupabaseService;
      const { auditService, tasksService, eventEmitter } = buildNoOpDeps();

      const service = await buildEpisodeService(supabaseService, auditService, tasksService, eventEmitter);

      await expect(service.listEncounterNotes('jwt', 'missing')).rejects.toThrow(EpisodeNotFoundError);
    });
  });

  describe('getActiveForPersonAsSystem', () => {
    it('returns the most recent non-closed/archived episode for the person', async () => {
      const maybeSingleMock = jest.fn().mockResolvedValue({
        data: {
          id: 'ep1',
          person_id: 'p1',
          facility_id: 'f1',
          lmp_date: '2026-01-01',
          estimated_delivery_date: '2026-10-08',
          gestational_age_weeks: 20,
          risk_band: 'medium',
          status: 'Active',
        },
        error: null,
      });
      const serviceClient = {
        from: () => ({
          select: () => ({
            eq: () => ({
              not: () => ({
                order: () => ({
                  limit: () => ({ maybeSingle: maybeSingleMock }),
                }),
              }),
            }),
          }),
        }),
      };
      const supabaseService = { getServiceClient: () => serviceClient } as unknown as SupabaseService;
      const auditService = { log: jest.fn() } as unknown as AuditService;
      const tasksService = {} as unknown as TasksService;
      const eventEmitter = {} as unknown as EventEmitter2;
      const service = new EpisodeService(supabaseService, auditService, tasksService, eventEmitter);

      const result = await service.getActiveForPersonAsSystem('p1');

      expect(result?.id).toBe('ep1');
      expect(result?.status).toBe('Active');
    });

    it('returns null when the person has no active episode', async () => {
      const serviceClient = {
        from: () => ({
          select: () => ({
            eq: () => ({
              not: () => ({
                order: () => ({
                  limit: () => ({ maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }) }),
                }),
              }),
            }),
          }),
        }),
      };
      const supabaseService = { getServiceClient: () => serviceClient } as unknown as SupabaseService;
      const auditService = { log: jest.fn() } as unknown as AuditService;
      const tasksService = {} as unknown as TasksService;
      const eventEmitter = {} as unknown as EventEmitter2;
      const service = new EpisodeService(supabaseService, auditService, tasksService, eventEmitter);

      const result = await service.getActiveForPersonAsSystem('p-none');

      expect(result).toBeNull();
    });
  });
});
