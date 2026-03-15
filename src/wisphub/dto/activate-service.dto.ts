import { IsOptional, IsString } from 'class-validator';

export class ActivateServiceDto {
  @IsString()
  @IsOptional()
  reason?: string;
}
