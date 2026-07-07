import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, MoreThan } from 'typeorm';
import { createLogger } from '../../common/services/logger.service';
import { normalizeBrazilianPhoneToChatId } from '../sales-webhook/phone.util';
import { Product } from './entities/product.entity';
import { FunnelStep } from './entities/funnel-step.entity';
import { FunnelExecution, FunnelExecutionSource } from './entities/funnel-execution.entity';
import { FunnelExecutionResponseDto, TestFunnelDto } from './dto/product.dto';

export interface ParsedSale {
  customerName: string;
  customerPhone: string;
  approved: boolean;
}

// Ignore a webhook if a running execution for the same product+chatId was created within this
// window — protects against checkout platforms firing the same approval more than once.
const DEDUPE_WINDOW_MS = 10 * 60 * 1000;

// Coerce an unknown webhook field to a plain string without risking '[object Object]' output.
function asText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '';
}

@Injectable()
export class FunnelService {
  private readonly logger = createLogger('FunnelService');

  constructor(
    @InjectRepository(FunnelExecution, 'data')
    private readonly executionRepo: Repository<FunnelExecution>,
    @InjectRepository(FunnelStep, 'data')
    private readonly stepRepo: Repository<FunnelStep>,
    @InjectRepository(Product, 'data')
    private readonly productRepo: Repository<Product>,
  ) {}

  // --- Payload parsers (field names mirror sales-webhook.service.ts) ---

  parsePerfectPay(body: Record<string, unknown>): ParsedSale {
    const customer = (body.customer as Record<string, unknown>) || {};
    const statusEnum = Number(body.sale_status_enum);
    return {
      customerName: asText(customer.full_name),
      customerPhone:
        asText(customer.phone_formated_ddi) || `${asText(customer.phone_area_code)}${asText(customer.phone_number)}`,
      approved: statusEnum === 2 || statusEnum === 10,
    };
  }

  parseKirvano(body: Record<string, unknown>): ParsedSale {
    const customer = (body.customer as Record<string, unknown>) || {};
    const event = asText(body.event);
    return {
      customerName: asText(customer.name),
      customerPhone: asText(customer.phone_number),
      approved: event === 'SALE_APPROVED',
    };
  }

  /**
   * Generic endpoint for any other checkout platform. Accepts Portuguese or English keys and
   * treats "aprovada"/"approved"/"paid" (case-insensitive) as an approved sale.
   */
  parseGeneric(body: Record<string, unknown>): ParsedSale {
    const name = asText(body.nome ?? body.name ?? body.customerName);
    const phone = asText(body.telefone ?? body.phone ?? body.customerPhone);
    const status = asText(body.status).trim().toLowerCase();
    return {
      customerName: name,
      customerPhone: phone,
      approved: ['aprovada', 'aprovado', 'approved', 'paid'].includes(status),
    };
  }

  /**
   * Entry point for a webhook hit: validates approval + phone, applies dedupe, and creates a
   * running execution whose first step the scheduler will pick up. Returns a short outcome for
   * logging; the controller always answers 200 regardless so platforms don't retry-storm.
   */
  async startFromWebhook(
    product: Product,
    source: FunnelExecutionSource,
    sale: ParsedSale,
  ): Promise<{ started: boolean; reason?: string }> {
    if (!sale.approved) {
      return { started: false, reason: 'not-approved' };
    }
    const chatId = normalizeBrazilianPhoneToChatId(sale.customerPhone);
    if (!chatId) {
      this.logger.warn(`${source}: could not normalize phone "${sale.customerPhone}" for product ${product.id}`);
      return { started: false, reason: 'invalid-phone' };
    }

    const recent = await this.executionRepo.findOne({
      where: {
        productId: product.id,
        chatId,
        status: 'running',
        createdAt: MoreThan(new Date(Date.now() - DEDUPE_WINDOW_MS)),
      },
    });
    if (recent) {
      this.logger.log(`${source}: duplicate sale for product ${product.id} / ${chatId} within dedupe window, ignoring`);
      return { started: false, reason: 'duplicate' };
    }

    await this.createExecution(product, source, sale.customerName, sale.customerPhone, chatId);
    return { started: true };
  }

  /** Start a test run of a product's funnel to an arbitrary phone (dashboard "Testar funil"). */
  async startTest(productId: string, dto: TestFunnelDto): Promise<FunnelExecutionResponseDto> {
    const product = await this.getProductOr404(productId);
    const chatId = normalizeBrazilianPhoneToChatId(dto.phone);
    if (!chatId) {
      throw new BadRequestException(`Could not normalize phone "${dto.phone}"`);
    }
    const execution = await this.createExecution(product, 'test', 'Teste', dto.phone, chatId);
    const total = await this.stepRepo.count({ where: { productId } });
    return this.toResponse(execution, product.name, total);
  }

  async listExecutions(filters: { productId?: string; status?: string }): Promise<FunnelExecutionResponseDto[]> {
    const where: Record<string, unknown> = {};
    if (filters.productId) where.productId = filters.productId;
    if (filters.status) where.status = filters.status;

    const executions = await this.executionRepo.find({
      where,
      order: { createdAt: 'DESC' },
      take: 500,
    });
    return this.decorate(executions);
  }

  async getExecution(id: string): Promise<FunnelExecutionResponseDto> {
    const execution = await this.executionRepo.findOne({ where: { id } });
    if (!execution) throw new NotFoundException(`Execution ${id} not found`);
    const [decorated] = await this.decorate([execution]);
    return decorated;
  }

  async cancelExecution(id: string): Promise<FunnelExecutionResponseDto> {
    const execution = await this.executionRepo.findOne({ where: { id } });
    if (!execution) throw new NotFoundException(`Execution ${id} not found`);
    if (execution.status === 'running') {
      execution.status = 'cancelled';
      execution.nextStepAt = null;
      execution.completedAt = new Date();
      await this.executionRepo.save(execution);
      this.logger.log(`Cancelled execution ${id}`);
    }
    const [decorated] = await this.decorate([execution]);
    return decorated;
  }

  /** Dashboard counters: running now, completed today, failures today. */
  async getStats(): Promise<{ running: number; completedToday: number; failedToday: number }> {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const [running, completedToday, failedToday] = await Promise.all([
      this.executionRepo.count({ where: { status: 'running' } }),
      this.executionRepo.count({ where: { status: 'completed', completedAt: MoreThan(startOfDay) } }),
      this.executionRepo.count({ where: { status: 'failed', completedAt: MoreThan(startOfDay) } }),
    ]);
    return { running, completedToday, failedToday };
  }

  private async createExecution(
    product: Product,
    source: FunnelExecutionSource,
    customerName: string,
    customerPhone: string,
    chatId: string,
  ): Promise<FunnelExecution> {
    const steps = await this.stepRepo.find({ where: { productId: product.id }, order: { order: 'ASC' } });
    const now = new Date();
    // No steps → nothing to send; record a completed execution so the dashboard still shows it.
    const hasSteps = steps.length > 0;
    const firstDelayMs = hasSteps ? steps[0].delayMinutes * 60 * 1000 : 0;

    const execution = this.executionRepo.create({
      productId: product.id,
      customerName: customerName || '',
      customerPhone: customerPhone || '',
      chatId,
      source,
      currentStepIndex: 0,
      nextStepAt: hasSteps ? new Date(now.getTime() + firstDelayMs) : null,
      status: hasSteps ? 'running' : 'completed',
      stepResults: [],
      completedAt: hasSteps ? null : now,
    });
    const saved = await this.executionRepo.save(execution);
    this.logger.log(
      `Started ${source} funnel execution ${saved.id} for product ${product.id} / ${chatId} (${steps.length} step(s))`,
    );
    return saved;
  }

  private async getProductOr404(productId: string): Promise<Product> {
    const product = await this.productRepo.findOne({ where: { id: productId } });
    if (!product) throw new NotFoundException(`Product ${productId} not found`);
    return product;
  }

  private async decorate(executions: FunnelExecution[]): Promise<FunnelExecutionResponseDto[]> {
    if (!executions.length) return [];
    const productIds = [...new Set(executions.map(e => e.productId))];
    const products = await this.productRepo.find();
    const nameById = new Map(products.map(p => [p.id, p.name]));

    // Live total-step count per product so "step 2 of 5" reflects the current funnel length.
    const counts = new Map<string, number>();
    for (const productId of productIds) {
      counts.set(productId, await this.stepRepo.count({ where: { productId } }));
    }

    return executions.map(e => this.toResponse(e, nameById.get(e.productId), counts.get(e.productId) ?? 0));
  }

  private toResponse(
    e: FunnelExecution,
    productName: string | undefined,
    totalSteps: number,
  ): FunnelExecutionResponseDto {
    return {
      id: e.id,
      productId: e.productId,
      productName,
      customerName: e.customerName,
      customerPhone: e.customerPhone,
      chatId: e.chatId,
      source: e.source,
      currentStepIndex: e.currentStepIndex,
      totalSteps,
      nextStepAt: e.nextStepAt,
      status: e.status,
      stepResults: e.stepResults,
      createdAt: e.createdAt,
      completedAt: e.completedAt,
    };
  }
}
