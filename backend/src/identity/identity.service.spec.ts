import { Test, TestingModule } from '@nestjs/testing';
import {
  IdentityService,
  DuplicatePersonError,
  AmbiguousPersonMatchError,
  PersonNotFoundError,
  hashEnrolmentCode,
} from './identity.service';
import { SupabaseService } from '../common/supabase/supabase.service';
import { AuditService } from '../audit/audit.service';

describe('IdentityService', () => {
  let service: IdentityService;
  let auditLogMock: jest.Mock;

  function buildClient(existingByPhone: any[]) {
    return {
      from: () => ({
        select: () => ({
          eq: () => Promise.resolve({ data: existingByPhone, error: null }),
        }),
        insert: (row: any) => ({
          select: () => ({
            single: async () => ({
              data: { id: 'p1', tenant_id: row.tenant_id, first_name: row.first_name, last_name: row.last_name ?? null, phone_primary: row.phone_primary, date_of_birth: row.date_of_birth ?? null },
              error: null,
            }),
          }),
        }),
      }),
    };
  }

  async function buildService(existingByPhone: any[]) {
    const supabaseService = {
      getClientForUser: () => buildClient(existingByPhone),
    } as unknown as SupabaseService;
    auditLogMock = jest.fn().mockResolvedValue(undefined);
    const auditService = { log: auditLogMock } as unknown as AuditService;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        IdentityService,
        { provide: SupabaseService, useValue: supabaseService },
        { provide: AuditService, useValue: auditService },
      ],
    }).compile();

    return module.get<IdentityService>(IdentityService);
  }

  function buildClientForIds(rows: any[]) {
    return {
      from: () => ({
        select: () => ({
          in: () => Promise.resolve({ data: rows, error: null }),
        }),
      }),
    };
  }

  async function buildServiceForIds(rows: any[]) {
    const supabaseService = {
      getClientForUser: () => buildClientForIds(rows),
    } as unknown as SupabaseService;
    const auditService = { log: jest.fn() } as unknown as AuditService;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        IdentityService,
        { provide: SupabaseService, useValue: supabaseService },
        { provide: AuditService, useValue: auditService },
      ],
    }).compile();

    return module.get<IdentityService>(IdentityService);
  }

  it('creates a person when no phone match exists', async () => {
    service = await buildService([]);
    const result = await service.create('jwt', 'u1', 't1', {
      firstName: 'Amina',
      phonePrimary: '+254700000001',
    });
    expect(result.id).toBe('p1');
    expect(auditLogMock).toHaveBeenCalledWith(
      expect.objectContaining({ entityType: 'person', action: 'created' }),
    );
  });

  it('throws DuplicatePersonError when phone_primary already exists for the tenant', async () => {
    service = await buildService([{ id: 'existing-1', phone_primary: '+254700000001' }]);
    await expect(
      service.create('jwt', 'u1', 't1', { firstName: 'Amina', phonePrimary: '+254700000001' }),
    ).rejects.toThrow(DuplicatePersonError);
  });

  it('search returns matches by phone', async () => {
    service = await buildService([
      { id: 'p1', tenant_id: 't1', first_name: 'Amina', last_name: null, phone_primary: '+254700000001', date_of_birth: null },
    ]);
    const result = await service.search('jwt', '+254700000001');
    expect(result).toHaveLength(1);
    expect(result[0].firstName).toBe('Amina');
  });

  it('findByIds returns persons matching the given id list', async () => {
    const svc = await buildServiceForIds([
      { id: 'p1', tenant_id: 't1', first_name: 'Amina', last_name: null, phone_primary: '+254700000001', date_of_birth: null },
      { id: 'p2', tenant_id: 't1', first_name: 'Beatrice', last_name: 'Wanjiru', phone_primary: '+254700000002', date_of_birth: null },
    ]);

    const result = await svc.findByIds('jwt', ['p1', 'p2']);

    expect(result).toHaveLength(2);
    expect(result.map((p) => p.firstName)).toEqual(['Amina', 'Beatrice']);
    expect(result[1].lastName).toBe('Wanjiru');
  });

  it('findByIds returns an empty array without querying the database when given an empty id list', async () => {
    const fromMock = jest.fn();
    const supabaseService = {
      getClientForUser: () => ({ from: fromMock }),
    } as unknown as SupabaseService;
    const auditService = { log: jest.fn() } as unknown as AuditService;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        IdentityService,
        { provide: SupabaseService, useValue: supabaseService },
        { provide: AuditService, useValue: auditService },
      ],
    }).compile();
    const svc = module.get<IdentityService>(IdentityService);

    const result = await svc.findByIds('jwt', []);

    expect(result).toEqual([]);
    expect(fromMock).not.toHaveBeenCalled();
  });

  describe('findByPhoneAsSystem', () => {
    const inMock = jest.fn();

    function buildServiceWithServiceClient(rows: any[]) {
      inMock.mockReset();
      inMock.mockResolvedValue({ data: rows, error: null });
      const serviceClient = {
        from: () => ({
          select: () => ({
            in: inMock,
          }),
        }),
      };
      const supabaseService = {
        getServiceClient: () => serviceClient,
      } as unknown as SupabaseService;
      const auditService = { log: jest.fn() } as unknown as AuditService;
      return new IdentityService(supabaseService, auditService);
    }

    it('returns null when no person matches the phone number', async () => {
      const service = buildServiceWithServiceClient([]);
      const result = await service.findByPhoneAsSystem('+254700000099');
      expect(result).toBeNull();
    });

    // Meta sends the wa_id with no leading '+'; person.phone_primary is stored with one.
    // This is the single most important assertion in this file — see the "Phone format"
    // note above.
    it('matches a +E.164 stored row when given bare wa_id digits, and queries both forms', async () => {
      const service = buildServiceWithServiceClient([
        { id: 'p1', tenant_id: 't1', first_name: 'Amina', phone_primary: '+254700000001' },
      ]);

      const result = await service.findByPhoneAsSystem('254700000001');

      expect(result?.id).toBe('p1');
      expect(inMock).toHaveBeenCalledWith('phone_primary', ['+254700000001', '254700000001']);
    });

    it('strips spaces, dashes and parentheses before matching', async () => {
      const service = buildServiceWithServiceClient([
        { id: 'p1', tenant_id: 't1', first_name: 'Amina', phone_primary: '+254700000001' },
      ]);

      await service.findByPhoneAsSystem('+254 (700) 000-001');

      expect(inMock).toHaveBeenCalledWith('phone_primary', ['+254700000001', '254700000001']);
    });

    it('returns the matching person, including consent fields', async () => {
      const service = buildServiceWithServiceClient([
        {
          id: 'p1',
          tenant_id: 't1',
          first_name: 'Amina',
          last_name: null,
          phone_primary: '+254700000001',
          date_of_birth: null,
          whatsapp_consent: true,
          whatsapp_consent_at: '2026-08-01T00:00:00.000Z',
        },
      ]);
      const result = await service.findByPhoneAsSystem('+254700000001');
      expect(result?.id).toBe('p1');
      expect(result?.whatsappConsent).toBe(true);
      expect(result?.whatsappConsentAt).toBe('2026-08-01T00:00:00.000Z');
    });

    it('throws AmbiguousPersonMatchError when more than one person matches', async () => {
      const service = buildServiceWithServiceClient([
        { id: 'p1', tenant_id: 't1', first_name: 'Amina', phone_primary: '+254700000001' },
        { id: 'p2', tenant_id: 't2', first_name: 'Beatrice', phone_primary: '+254700000001' },
      ]);
      await expect(service.findByPhoneAsSystem('+254700000001')).rejects.toThrow(
        AmbiguousPersonMatchError,
      );
    });
  });

  describe('markWhatsAppConsentAsSystem', () => {
    it('updates whatsapp_consent and whatsapp_consent_at on the person row', async () => {
      const updateMock = jest.fn().mockReturnValue({
        eq: jest.fn().mockResolvedValue({ error: null }),
      });
      const serviceClient = { from: () => ({ update: updateMock }) };
      const supabaseService = {
        getServiceClient: () => serviceClient,
      } as unknown as SupabaseService;
      const auditService = { log: jest.fn() } as unknown as AuditService;
      const service = new IdentityService(supabaseService, auditService);

      await service.markWhatsAppConsentAsSystem('p1', '2026-08-01T00:00:00.000Z');

      expect(updateMock).toHaveBeenCalledWith({
        whatsapp_consent: true,
        whatsapp_consent_at: '2026-08-01T00:00:00.000Z',
        updated_at: expect.any(String),
      });
    });
  });

  describe('revokeWhatsAppConsentAsSystem', () => {
    it('clears whatsapp_consent and whatsapp_consent_at on the person row', async () => {
      const updateMock = jest.fn().mockReturnValue({
        eq: jest.fn().mockResolvedValue({ error: null }),
      });
      const serviceClient = { from: () => ({ update: updateMock }) };
      const supabaseService = {
        getServiceClient: () => serviceClient,
      } as unknown as SupabaseService;
      const auditService = { log: jest.fn() } as unknown as AuditService;
      const service = new IdentityService(supabaseService, auditService);

      await service.revokeWhatsAppConsentAsSystem('p1');

      expect(updateMock).toHaveBeenCalledWith({
        whatsapp_consent: false,
        whatsapp_consent_at: null,
        updated_at: expect.any(String),
      });
    });
  });

  describe('issueWhatsAppEnrolmentCode', () => {
    function buildService(personRow: { id: string; tenant_id: string } | null) {
      const deleteIsMock = jest.fn().mockResolvedValue({ error: null });
      const insertMock = jest.fn().mockResolvedValue({ error: null });
      const auditLogMock = jest.fn().mockResolvedValue(undefined);

      const userClient = {
        from: () => ({
          select: () => ({
            eq: () => ({
              maybeSingle: jest.fn().mockResolvedValue({ data: personRow, error: null }),
            }),
          }),
        }),
      };
      const serviceClient = {
        from: () => ({
          delete: () => ({ eq: () => ({ is: deleteIsMock }) }),
          insert: insertMock,
        }),
      };
      const supabaseService = {
        getClientForUser: () => userClient,
        getServiceClient: () => serviceClient,
      } as unknown as SupabaseService;
      const auditService = { log: auditLogMock } as unknown as AuditService;

      return {
        service: new IdentityService(supabaseService, auditService),
        deleteIsMock,
        insertMock,
        auditLogMock,
      };
    }

    it('throws PersonNotFoundError when the person is not visible to the caller', async () => {
      const { service } = buildService(null);
      await expect(service.issueWhatsAppEnrolmentCode('jwt', 'u1', 'p-missing')).rejects.toThrow(
        PersonNotFoundError,
      );
    });

    it('returns a six-digit code and stores only its hash', async () => {
      const { service, insertMock } = buildService({ id: 'p1', tenant_id: 't1' });

      const result = await service.issueWhatsAppEnrolmentCode('jwt', 'u1', 'p1');

      expect(result.code).toMatch(/^[0-9]{6}$/);
      expect(new Date(result.expiresAt).getTime()).toBeGreaterThan(Date.now());

      const inserted = insertMock.mock.calls[0][0];
      expect(inserted.person_id).toBe('p1');
      expect(inserted.issued_by).toBe('u1');
      expect(inserted.attempts_remaining).toBe(5);
      expect(inserted.code_hash).toBe(hashEnrolmentCode(inserted.id, result.code));
      expect(JSON.stringify(inserted)).not.toContain(result.code);
    });

    it('retires any previously issued, unconsumed code for that person first', async () => {
      const { service, deleteIsMock } = buildService({ id: 'p1', tenant_id: 't1' });

      await service.issueWhatsAppEnrolmentCode('jwt', 'u1', 'p1');

      expect(deleteIsMock).toHaveBeenCalledWith('consumed_at', null);
    });

    // audit_event is append-only and readable tenant-wide. A code written there would be a
    // permanently readable credential.
    it('never writes the plaintext code into the audit trail', async () => {
      const { service, auditLogMock } = buildService({ id: 'p1', tenant_id: 't1' });

      const result = await service.issueWhatsAppEnrolmentCode('jwt', 'u1', 'p1');

      const entry = auditLogMock.mock.calls[0][0];
      expect(entry.action).toBe('whatsapp_enrolment_code_issued');
      expect(entry.tenantId).toBe('t1');
      expect(entry.actorUserId).toBe('u1');
      expect(JSON.stringify(entry)).not.toContain(result.code);
    });
  });

  describe('redeemWhatsAppEnrolmentCodeAsSystem', () => {
    function buildService(options: {
      codeRow: Record<string, unknown> | null;
      displaced?: Array<{ id: string; tenant_id: string }>;
    }) {
      const personUpdates: Array<Record<string, unknown>> = [];
      const codeUpdates: Array<Record<string, unknown>> = [];
      const auditLogMock = jest.fn().mockResolvedValue(undefined);

      const serviceClient = {
        from: (table: string) => {
          if (table === 'whatsapp_enrolment_code') {
            return {
              select: () => ({
                eq: () => ({
                  is: () => ({
                    order: () => ({
                      limit: () => ({
                        maybeSingle: jest
                          .fn()
                          .mockResolvedValue({ data: options.codeRow, error: null }),
                      }),
                    }),
                  }),
                }),
              }),
              update: (values: Record<string, unknown>) => {
                codeUpdates.push(values);
                return { eq: jest.fn().mockResolvedValue({ error: null }) };
              },
            };
          }
          return {
            select: () => ({
              eq: () => ({
                neq: jest
                  .fn()
                  .mockResolvedValue({ data: options.displaced ?? [], error: null }),
              }),
            }),
            update: (values: Record<string, unknown>) => {
              personUpdates.push(values);
              return { eq: jest.fn().mockResolvedValue({ error: null }) };
            },
          };
        },
      };
      const supabaseService = {
        getServiceClient: () => serviceClient,
      } as unknown as SupabaseService;
      const auditService = { log: auditLogMock } as unknown as AuditService;

      return {
        service: new IdentityService(supabaseService, auditService),
        personUpdates,
        codeUpdates,
        auditLogMock,
      };
    }

    function openCodeRow(code: string, overrides: Record<string, unknown> = {}) {
      const id = 'code-1';
      return {
        id,
        code_hash: hashEnrolmentCode(id, code),
        expires_at: new Date(Date.now() + 60_000).toISOString(),
        attempts_remaining: 5,
        ...overrides,
      };
    }

    it('reports no_open_code when the person has no outstanding code', async () => {
      const { service } = buildService({ codeRow: null });
      const result = await service.redeemWhatsAppEnrolmentCodeAsSystem(
        'p1',
        't1',
        '254700000001',
        '123456',
      );
      expect(result.outcome).toBe('no_open_code');
    });

    it('reports expired without spending an attempt when the code has lapsed', async () => {
      const { service, codeUpdates } = buildService({
        codeRow: openCodeRow('123456', { expires_at: new Date(Date.now() - 1000).toISOString() }),
      });
      const result = await service.redeemWhatsAppEnrolmentCodeAsSystem(
        'p1',
        't1',
        '254700000001',
        '123456',
      );
      expect(result.outcome).toBe('expired');
      expect(codeUpdates).toHaveLength(0);
    });

    it('spends one attempt and reports invalid_code on a wrong code', async () => {
      const { service, codeUpdates, personUpdates } = buildService({
        codeRow: openCodeRow('123456'),
      });

      const result = await service.redeemWhatsAppEnrolmentCodeAsSystem(
        'p1',
        't1',
        '254700000001',
        '999999',
      );

      expect(result).toEqual({ outcome: 'invalid_code', attemptsRemaining: 4 });
      expect(codeUpdates[0]).toMatchObject({ attempts_remaining: 4 });
      expect(personUpdates).toHaveLength(0);
    });

    it('reports invalid_code without a database write when the attempt budget is spent', async () => {
      const { service, codeUpdates } = buildService({
        codeRow: openCodeRow('123456', { attempts_remaining: 0 }),
      });

      const result = await service.redeemWhatsAppEnrolmentCodeAsSystem(
        'p1',
        't1',
        '254700000001',
        '123456',
      );

      expect(result).toEqual({ outcome: 'invalid_code', attemptsRemaining: 0 });
      expect(codeUpdates).toHaveLength(0);
    });

    it('binds the handset, consumes the code and audits on a correct code', async () => {
      const { service, personUpdates, codeUpdates, auditLogMock } = buildService({
        codeRow: openCodeRow('123456'),
      });

      const result = await service.redeemWhatsAppEnrolmentCodeAsSystem(
        'p1',
        't1',
        '254700000001',
        '123456',
      );

      expect(result.outcome).toBe('verified');
      expect(personUpdates).toHaveLength(1);
      expect(personUpdates[0]).toMatchObject({ whatsapp_verified_phone: '254700000001' });
      expect(personUpdates[0].whatsapp_verified_at).toEqual(expect.any(String));
      expect(codeUpdates[0].consumed_at).toEqual(expect.any(String));
      expect(auditLogMock).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'whatsapp_channel_verified', entityId: 'p1' }),
      );
    });

    // Phone reassignment is common. Without this release the unique index would reject the
    // bind, and the woman now holding the SIM could never enrol.
    it('releases the handset from a previous owner, audits it, then binds the new one', async () => {
      const { service, personUpdates, auditLogMock } = buildService({
        codeRow: openCodeRow('123456'),
        displaced: [{ id: 'p-old', tenant_id: 't-old' }],
      });

      await service.redeemWhatsAppEnrolmentCodeAsSystem('p1', 't1', '254700000001', '123456');

      expect(personUpdates).toHaveLength(2);
      expect(personUpdates[0]).toMatchObject({
        whatsapp_verified_phone: null,
        whatsapp_verified_at: null,
      });
      expect(personUpdates[1]).toMatchObject({ whatsapp_verified_phone: '254700000001' });
      expect(auditLogMock).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'whatsapp_channel_unbound',
          entityId: 'p-old',
          tenantId: 't-old',
        }),
      );
    });
  });
});
