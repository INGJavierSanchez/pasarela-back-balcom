import { IsString } from 'class-validator';

export class WisphubLoginDto {
  /** Email o nombre de usuario de WispHub */
  @IsString()
  login!: string;

  /** Contraseña del usuario */
  @IsString()
  password!: string;
}
