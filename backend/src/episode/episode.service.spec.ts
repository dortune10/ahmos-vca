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
});
