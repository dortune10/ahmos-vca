import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateFacilityDto {
  @IsString()
  @MaxLength(200)
  name!: string;

  @IsIn(['community', 'clinic', 'hospital'])
  type!: 'community' | 'clinic' | 'hospital';

  @IsOptional()
  @IsString()
  contactPhone?: string;
}
