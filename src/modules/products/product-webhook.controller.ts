import { Body, Controller, HttpCode, Param, Post, UnauthorizedException } from '@nestjs/common';
import { Public } from '../auth/decorators/auth.decorators';
import { createLogger } from '../../common/services/logger.service';
import { ProductsService } from './products.service';
import { FunnelService } from './funnel.service';
import { Product } from './entities/product.entity';
import { FunnelExecutionSource } from './entities/funnel-execution.entity';

// @Public: checkout platforms (PerfectPay/Kirvano/custom) can't present an OdexWA API key, so the
// global ApiKeyGuard is bypassed. Authorization is the per-product webhookToken in the URL instead.
// Every handler answers 200 so a platform never enters a retry-storm over an ignored/duplicate sale.
@Public()
@Controller('webhooks/produtos')
export class ProductWebhookController {
  private readonly logger = createLogger('ProductWebhook');

  constructor(
    private readonly productsService: ProductsService,
    private readonly funnelService: FunnelService,
  ) {}

  @Post(':webhookToken/perfectpay')
  @HttpCode(200)
  async perfectPay(
    @Param('webhookToken') webhookToken: string,
    @Body() body: Record<string, unknown>,
  ): Promise<{ ok: boolean; ignored?: boolean }> {
    return this.handle(webhookToken, 'perfectpay', body, b => this.funnelService.parsePerfectPay(b));
  }

  @Post(':webhookToken/kirvano')
  @HttpCode(200)
  async kirvano(
    @Param('webhookToken') webhookToken: string,
    @Body() body: Record<string, unknown>,
  ): Promise<{ ok: boolean; ignored?: boolean }> {
    return this.handle(webhookToken, 'kirvano', body, b => this.funnelService.parseKirvano(b));
  }

  @Post(':webhookToken/generico')
  @HttpCode(200)
  async generico(
    @Param('webhookToken') webhookToken: string,
    @Body() body: Record<string, unknown>,
  ): Promise<{ ok: boolean; ignored?: boolean }> {
    return this.handle(webhookToken, 'generic', body, b => this.funnelService.parseGeneric(b));
  }

  /**
   * Shared flow: unknown token → 401; inactive product → 200 {ignored}; otherwise parse the sale
   * and hand off to the funnel service, which applies the approval/phone/dedupe guards. The reply
   * is always 200 so the sending platform treats the delivery as accepted regardless of outcome.
   */
  private async handle(
    webhookToken: string,
    source: FunnelExecutionSource,
    body: Record<string, unknown>,
    parse: (b: Record<string, unknown>) => { customerName: string; customerPhone: string; approved: boolean },
  ): Promise<{ ok: boolean; ignored?: boolean }> {
    const product: Product | null = await this.productsService.findByToken(webhookToken);
    if (!product) {
      throw new UnauthorizedException('Invalid webhook token');
    }
    if (!product.active) {
      this.logger.log(`${source}: product ${product.id} is inactive, ignoring webhook`);
      return { ok: true, ignored: true };
    }

    const sale = parse(body);
    const result = await this.funnelService.startFromWebhook(product, source, sale);
    if (!result.started) {
      return { ok: true, ignored: true };
    }
    return { ok: true };
  }
}
