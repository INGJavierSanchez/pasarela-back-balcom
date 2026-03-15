import {
  IsBoolean,
  IsEmail,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  Min,
} from 'class-validator';

export class CreatePaymentLinkDto {
  @IsString()
  customerId!: string;

  @IsInt()
  @Min(1)
  amountInCents!: number;

  @IsString()
  @IsOptional()
  currency: string = 'COP';

  @IsString()
  @IsOptional()
  description?: string;

  @IsBoolean()
  @IsOptional()
  singleUse: boolean = true;

  @IsUrl()
  @IsOptional()
  redirectUrl?: string;

  @IsEmail()
  @IsOptional()
  customerEmail?: string;
}
