import { IsIn, IsString, MaxLength, MinLength } from 'class-validator';

export class OverrideRiskAssessmentDto {
  @IsIn(['low', 'medium', 'high'])
  finalRiskBand!: 'low' | 'medium' | 'high';

  @IsString()
  @MinLength(3)
  @MaxLength(1000)
  overrideReason!: string;
}
