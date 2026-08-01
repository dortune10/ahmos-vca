import { IsOptional, IsString, MaxLength, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { VitalsDto } from './vitals.dto';

export class RecordEncounterNoteDto {
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  noteText?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => VitalsDto)
  vitals?: VitalsDto;
}
