import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MessageService } from '../message/message.service';
import { createLogger } from '../../common/services/logger.service';
import { normalizeBrazilianPhoneToChatId } from './phone.util';

interface SaleInfo {
  customerName: string;
  customerPhone: string;
  productName: string;
  approved: boolean;
}

@Injectable()
export class SalesWebhookService {
  private readonly logger = createLogger('SalesWebhookService');

  constructor(
    private readonly configService: ConfigService,
    private readonly messageService: MessageService,
  ) {}

  isValidPerfectPayToken(token: unknown): boolean {
    const expected = this.configService.get<string>('salesWebhook.perfectpay.token');
    return !!expected && token === expected;
  }

  isValidKirvanoToken(token: unknown): boolean {
    const expected = this.configService.get<string>('salesWebhook.kirvano.token');
    return !!expected && token === expected;
  }

  /**
   * PerfectPay field names/status codes based on a prior integration reference, not an
   * official confirmed schema. `sale_status_enum` 2 or 10 means "approved". Verify against
   * a real webhook payload once this is live.
   */
  async handlePerfectPay(body: Record<string, unknown>): Promise<void> {
    const customer = (body.customer as Record<string, unknown>) || {};
    const product = (body.product as Record<string, unknown>) || {};
    const statusEnum = Number(body.sale_status_enum);

    const info: SaleInfo = {
      customerName: String(customer.full_name || ''),
      customerPhone: `${customer.phone_area_code || ''}${customer.phone_number || ''}`,
      productName: String(product.name || ''),
      approved: statusEnum === 2 || statusEnum === 10,
    };

    await this.dispatchIfApproved('PerfectPay', info);
  }

  /**
   * Kirvano field names based on general knowledge of their public webhook docs, not a
   * sample payload confirmed with the user. Verify against a real webhook once this is live.
   */
  async handleKirvano(body: Record<string, unknown>): Promise<void> {
    const customer = (body.customer as Record<string, unknown>) || {};
    const products = (body.products as Record<string, unknown>[]) || [];
    const firstProduct = products[0] || {};
    const event = String(body.event || '');

    const info: SaleInfo = {
      customerName: String(customer.name || ''),
      customerPhone: String(customer.phone_number || ''),
      productName: String(firstProduct.name || firstProduct.offer_name || ''),
      approved: event === 'SALE_APPROVED',
    };

    await this.dispatchIfApproved('Kirvano', info);
  }

  private async dispatchIfApproved(source: string, info: SaleInfo): Promise<void> {
    if (!info.approved) {
      this.logger.log(`${source}: sale not approved, skipping WhatsApp dispatch`);
      return;
    }

    const sessionId = this.configService.get<string>('salesWebhook.sessionId');
    if (!sessionId) {
      this.logger.warn(`${source}: SALES_WEBHOOK_SESSION_ID not configured, skipping dispatch`);
      return;
    }

    const chatId = normalizeBrazilianPhoneToChatId(info.customerPhone);
    if (!chatId) {
      this.logger.warn(`${source}: could not normalize customer phone "${info.customerPhone}", skipping dispatch`);
      return;
    }

    const template =
      this.configService.get<string>('salesWebhook.messageTemplate') ||
      'Olá {{customerName}}! Sua compra de {{productName}} foi aprovada. Obrigado! 🎉';
    const text = template
      .replace(/{{\s*customerName\s*}}/gi, info.customerName || 'cliente')
      .replace(/{{\s*productName\s*}}/gi, info.productName || 'seu produto');

    try {
      await this.messageService.sendText(sessionId, { chatId, text });
      this.logger.log(`${source}: WhatsApp message dispatched to ${chatId}`);
    } catch (error) {
      this.logger.error(`${source}: failed to dispatch WhatsApp message: ${(error as Error).message}`);
    }
  }
}
