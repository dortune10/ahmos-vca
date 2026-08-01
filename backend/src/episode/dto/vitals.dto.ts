import { IsNumber, IsOptional, Max, Min } from 'class-validator';

// Numeric ranges are documented in this plan's Global Constraints section — wide
// physiological bounds meant to catch data-entry errors, not clinical edge cases.
export class VitalsDto {
  @IsOptional()
  @IsNumber()
  @Min(60)
  @Max(260)
  bpSystolic?: number;

  @IsOptional()
  @IsNumber()
  @Min(40)
  @Max(150)
  bpDiastolic?: number;

  @IsOptional()
  @IsNumber()
  @Min(30)
  @Max(43)
  temperatureC?: number;

  @IsOptional()
  @IsNumber()
  @Min(2)
  @Max(20)
  hemoglobinGdl?: number;
}
