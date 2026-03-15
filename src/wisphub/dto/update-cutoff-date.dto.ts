import { IsDateString, IsOptional, IsString } from 'class-validator';

export class UpdateCutoffDateDto {
  @IsDateString()
  cutoffDate!: string;

  @IsString()
  @IsOptional()
  note?: string;
}
