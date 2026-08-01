import { IsEmail, IsIn, IsOptional, IsString, MinLength } from 'class-validator';

export class CreateStaffUserDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(12)
  password!: string;

  @IsIn(['chw', 'nurse', 'clinician', 'supervisor', 'admin'])
  role!: 'chw' | 'nurse' | 'clinician' | 'supervisor' | 'admin';

  @IsOptional()
  @IsString()
  facilityId?: string;

  @IsString()
  fullName!: string;
}
