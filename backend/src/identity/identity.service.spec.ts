import { Test, TestingModule } from '@nestjs/testing';
import { IdentityService, DuplicatePersonError, AmbiguousPersonMatchError } from './identity.service';
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
});
