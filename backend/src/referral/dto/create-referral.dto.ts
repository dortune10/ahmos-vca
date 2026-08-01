import { IsIn, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class CreateReferralDto {
  @IsUUID()
  pregnancyEpisodeId!: string;

  @IsUUID()
  toFacilityId!: string;

  @IsOptional()
  @IsUUID()
  fromFacilityId?: string;

  @IsString()
  @MaxLength(200)
  reasonCode!: string;

  @IsIn(['routine', 'urgent'])
  urgency!: 'routine' | 'urgent';
}
