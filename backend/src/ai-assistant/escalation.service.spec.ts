import { EscalationService } from './escalation.service';
import { TasksService } from '../tasks/tasks.service';
import { UsersService } from '../users/users.service';
import { AuditService } from '../audit/audit.service';
import { PersonResponseDto } from '../identity/dto/person-response.dto';
import { EpisodeResponseDto } from '../episode/dto/episode-response.dto';
import { StaffUserResponseDto } from '../users/dto/staff-user-response.dto';
import { CareTaskResponseDto } from '../tasks/dto/care-task-response.dto';

function buildPerson(): PersonResponseDto {
  const person = new PersonResponseDto();
  person.id = 'p1';
  person.tenantId = 't1';
  person.firstName = 'Amina';
  person.lastName = null;
  person.phonePrimary = '+254700000001';
  person.dateOfBirth = null;
  person.whatsappConsent = true;
  person.whatsappConsentAt = '2026-08-01T00:00:00.000Z';
  return person;
}

function buildEpisode(): EpisodeResponseDto {
  const episode = new EpisodeResponseDto();
  episode.id = 'ep1';
  episode.personId = 'p1';
  episode.facilityId = 'f1';
  episode.lmpDate = '2026-01-01';
  episode.estimatedDeliveryDate = '2026-10-08';
  episode.gestationalAgeWeeks = 20;
  episode.riskBand = 'low';
  episode.status = 'Active';
  episode.createdAt = '2026-08-01T00:00:00.000Z';
  episode.updatedAt = '2026-08-01T00:00:00.000Z';
  return episode;
}

function buildStaff(id: string, role: string): StaffUserResponseDto {
  const staff = new StaffUserResponseDto();
  staff.id = id;
  staff.tenantId = 't1';
  staff.email = `${id}@example.com`;
  staff.role = role;
  staff.facilityId = 'f1';
  staff.fullName = id;
  return staff;
}

function buildTask(): CareTaskResponseDto {
  const task = new CareTaskResponseDto();
  task.id = 'ct1';
  task.pregnancyEpisodeId = 'ep1';
  task.taskType = 'danger_sign_escalation';
  task.assignedUserId = 'chw1';
  task.dueAt = '2026-08-01T12:00:00.000Z';
  task.completedAt = null;
  task.status = 'Due';
  task.priority = 'urgent';
  task.createdAt = '2026-08-01T12:00:00.000Z';
  task.updatedAt = '2026-08-01T12:00:00.000Z';
  return task;
}

describe('EscalationService', () => {
  it('assigns the escalation task to a CHW at the episode facility and returns the urgent-care message', async () => {
    const tasksService = {
      createEscalationTask: jest.fn().mockResolvedValue(buildTask()),
    } as unknown as TasksService;
    const usersService = {
      findAssignableStaffForFacilityAsSystem: jest.fn().mockResolvedValue([buildStaff('chw1', 'chw')]),
      findSupervisorsForTenantAsSystem: jest.fn(),
    } as unknown as UsersService;
    const auditLogMock = jest.fn().mockResolvedValue(undefined);
    const auditService = { log: auditLogMock } as unknown as AuditService;
    const service = new EscalationService(tasksService, usersService, auditService);

    const reply = await service.escalate(buildPerson(), buildEpisode(), ['bleeding'], 'I have heavy bleeding');

    expect(usersService.findSupervisorsForTenantAsSystem).not.toHaveBeenCalled();
    // The tenant id must reach the staff lookup — a facility-only lookup can return a user in
    // another tenant, who would never see the task.
    expect(usersService.findAssignableStaffForFacilityAsSystem).toHaveBeenCalledWith('t1', 'f1');
    expect(tasksService.createEscalationTask).toHaveBeenCalledWith('t1', 'ep1', 'chw1', 'whatsapp_danger_sign');
    expect(reply).toContain('alerted your health worker');
    expect(auditLogMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'whatsapp_danger_sign_detected', entityId: 'p1' }),
    );
    expect(auditLogMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'urgent_escalation_created', entityId: 'ct1' }),
    );
  });

  it('does not write verbatim patient text into the audit trail', async () => {
    const tasksService = {
      createEscalationTask: jest.fn().mockResolvedValue(buildTask()),
    } as unknown as TasksService;
    const usersService = {
      findAssignableStaffForFacilityAsSystem: jest.fn().mockResolvedValue([buildStaff('chw1', 'chw')]),
      findSupervisorsForTenantAsSystem: jest.fn(),
    } as unknown as UsersService;
    const auditLogMock = jest.fn().mockResolvedValue(undefined);
    const auditService = { log: auditLogMock } as unknown as AuditService;
    const service = new EscalationService(tasksService, usersService, auditService);

    await service.escalate(buildPerson(), buildEpisode(), ['bleeding'], 'I am bleeding heavily and scared');

    const allMetadata = JSON.stringify(auditLogMock.mock.calls.map((c) => c[0].metadata));
    expect(allMetadata).toContain('bleeding'); // the matched keyword is kept
    expect(allMetadata).not.toContain('scared'); // the verbatim message is not
  });

  // The single most important test in this file.
  it('still returns the urgent-care message when task creation fails', async () => {
    const tasksService = {
      createEscalationTask: jest.fn().mockRejectedValue(new Error('supabase is down')),
    } as unknown as TasksService;
    const usersService = {
      findAssignableStaffForFacilityAsSystem: jest.fn().mockResolvedValue([buildStaff('chw1', 'chw')]),
      findSupervisorsForTenantAsSystem: jest.fn(),
    } as unknown as UsersService;
    const auditLogMock = jest.fn().mockResolvedValue(undefined);
    const auditService = { log: auditLogMock } as unknown as AuditService;
    const service = new EscalationService(tasksService, usersService, auditService);

    const reply = await service.escalate(buildPerson(), buildEpisode(), ['bleeding'], 'heavy bleeding');

    expect(reply).toContain('nearest health facility');
    expect(auditLogMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'whatsapp_escalation_failed' }),
    );
  });

  it('still returns the urgent-care message when assignee resolution fails', async () => {
    const tasksService = { createEscalationTask: jest.fn() } as unknown as TasksService;
    const usersService = {
      findAssignableStaffForFacilityAsSystem: jest.fn().mockRejectedValue(new Error('lookup failed')),
      findSupervisorsForTenantAsSystem: jest.fn(),
    } as unknown as UsersService;
    const auditService = { log: jest.fn().mockResolvedValue(undefined) } as unknown as AuditService;
    const service = new EscalationService(tasksService, usersService, auditService);

    const reply = await service.escalate(buildPerson(), buildEpisode(), ['seizure'], 'I had a seizure');

    expect(reply).toContain('nearest health facility');
  });

  it('falls back to a tenant supervisor when no facility staff is assignable', async () => {
    const tasksService = {
      createEscalationTask: jest.fn().mockResolvedValue(buildTask()),
    } as unknown as TasksService;
    const usersService = {
      findAssignableStaffForFacilityAsSystem: jest.fn().mockResolvedValue([]),
      findSupervisorsForTenantAsSystem: jest.fn().mockResolvedValue([buildStaff('sup1', 'supervisor')]),
    } as unknown as UsersService;
    const auditService = { log: jest.fn().mockResolvedValue(undefined) } as unknown as AuditService;
    const service = new EscalationService(tasksService, usersService, auditService);

    await service.escalate(buildPerson(), buildEpisode(), ['seizure'], 'I had a seizure');

    expect(tasksService.createEscalationTask).toHaveBeenCalledWith('t1', 'ep1', 'sup1', 'whatsapp_danger_sign');
  });

  it('creates an unassigned escalation task when no staff at all can be resolved', async () => {
    const tasksService = {
      createEscalationTask: jest.fn().mockResolvedValue(buildTask()),
    } as unknown as TasksService;
    const usersService = {
      findAssignableStaffForFacilityAsSystem: jest.fn().mockResolvedValue([]),
      findSupervisorsForTenantAsSystem: jest.fn().mockResolvedValue([]),
    } as unknown as UsersService;
    const auditService = { log: jest.fn().mockResolvedValue(undefined) } as unknown as AuditService;
    const service = new EscalationService(tasksService, usersService, auditService);

    await service.escalate(buildPerson(), buildEpisode(), ['convulsion'], 'convulsions just now');

    expect(tasksService.createEscalationTask).toHaveBeenCalledWith('t1', 'ep1', null, 'whatsapp_danger_sign');
  });

  it('does not create a task and returns a different message when there is no active episode', async () => {
    const tasksService = { createEscalationTask: jest.fn() } as unknown as TasksService;
    const usersService = {
      findAssignableStaffForFacilityAsSystem: jest.fn(),
      findSupervisorsForTenantAsSystem: jest.fn(),
    } as unknown as UsersService;
    const auditLogMock = jest.fn().mockResolvedValue(undefined);
    const auditService = { log: auditLogMock } as unknown as AuditService;
    const service = new EscalationService(tasksService, usersService, auditService);

    const reply = await service.escalate(buildPerson(), null, ['bleeding'], 'heavy bleeding');

    expect(tasksService.createEscalationTask).not.toHaveBeenCalled();
    expect(reply).toContain('nearest health facility');
    expect(auditLogMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'whatsapp_danger_sign_detected' }),
    );
  });
});
