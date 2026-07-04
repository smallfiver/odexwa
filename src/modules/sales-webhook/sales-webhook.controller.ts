import { Body, Controller, Headers, HttpCode, Post, Query, UnauthorizedException } from '@nestjs/common';
import { Public } from '../auth/decorators/auth.decorators';
import { SalesWebhookService } from './sales-webhook.service';

// @Public: PerfectPay/Kirvano can't present an OdexWA API key, so the global ApiKeyGuard is
// bypassed here. Each platform's own shared-secret token is checked inside the handler instead.
@Public()
@Controller('webhooks')
export class SalesWebhookController {
  constructor(private readonly salesWebhookService: SalesWebhookService) {}

  // PerfectPay sends its shared token as a `token` field in the JSON body (per its legacy webhook format).
  @Post('perfectpay')
  @HttpCode(200)
  async perfectPay(@Body() body: Record<string, unknown>): Promise<{ ok: boolean }> {
    if (!this.salesWebhookService.isValidPerfectPayToken(body.token)) {
      throw new UnauthorizedException('Invalid token');
    }
    await this.salesWebhookService.handlePerfectPay(body);
    return { ok: true };
  }

  // Kirvano is assumed to send its shared token via a `Security-Token` header (per general knowledge
  // of its public webhook docs, not a confirmed sample) — falls back to a `token` query param if not.
  @Post('kirvano')
  @HttpCode(200)
  async kirvano(
    @Body() body: Record<string, unknown>,
    @Headers('security-token') securityToken: string | undefined,
    @Query('token') queryToken: string | undefined,
  ): Promise<{ ok: boolean }> {
    if (!this.salesWebhookService.isValidKirvanoToken(securityToken ?? queryToken)) {
      throw new UnauthorizedException('Invalid token');
    }
    await this.salesWebhookService.handleKirvano(body);
    return { ok: true };
  }
}
