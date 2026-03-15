import { Body, Controller, Post } from '@nestjs/common';
import { ApiOperation, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { WisphubAuthService } from './wisphub-auth.service';
import { WisphubLoginDto } from './dto/wisphub-login.dto';

@ApiTags('wisphub-auth')
@Controller('wisphub/auth')
export class WisphubAuthController {
  constructor(private readonly wisphubAuthService: WisphubAuthService) {}

  @Post('login')
  @ApiOperation({
    summary: 'Iniciar sesión en WispHub y obtener el API Key',
    description:
      'Autentica al usuario en el panel web de WispHub usando email y contraseña. ' +
      'Retorna el API Key asociado al usuario para consumir la API de WispHub.',
  })
  @ApiOkResponse({
    description: 'Login exitoso. Retorna el API Key del usuario.',
    schema: {
      example: {
        apiKey: 'kSeyo4fN.dd8NdP3FqCLSdkXOfbrnqf2NgRYXWYop',
        login: 'javiersanchez@balcom',
        authenticated: true,
      },
    },
  })
  async login(@Body() dto: WisphubLoginDto) {
    return this.wisphubAuthService.loginAndGetApiKey(dto);
  }
}
