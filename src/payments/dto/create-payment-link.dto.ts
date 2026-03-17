import {
  ApiProperty,
  ApiPropertyOptional,
} from '@nestjs/swagger';
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
  @ApiProperty({ description: 'ID del cliente en WispHub' })
  @IsString()
  customerId!: string;

  @ApiProperty({ description: 'Monto en centavos' })
  @IsInt()
  @Min(1)
  amountInCents!: number;

  @ApiPropertyOptional({ description: 'Divisa', default: 'COP' })
  @IsString()
  @IsOptional()
  currency: string = 'COP';

  @ApiPropertyOptional({ description: 'Descripción opcional del pago' })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiPropertyOptional({ description: '¿Es de un solo uso?', default: true })
  @IsBoolean()
  @IsOptional()
  singleUse: boolean = true;

  @ApiPropertyOptional({ description: 'URL de redirección post-pago' })
  @IsUrl()
  @IsOptional()
  redirectUrl?: string;

  @ApiPropertyOptional({ description: 'Email del cliente' })
  @IsEmail()
  @IsOptional()
  customerEmail?: string;
}
