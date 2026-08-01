import { IsDateString, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';

export class CreateEpisodeDto {
  @IsUUID()
  personId!: string;

  @IsUUID()
  facilityId!: string;

  @IsOptional()
  @IsDateString()
  lmpDate?: string;

  @IsOptional()
  @IsDateString()
  estimatedDeliveryDate?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(45)
  gestationalAgeWeeks?: number;
}
