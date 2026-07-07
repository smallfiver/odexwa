import { Repository } from 'typeorm';
import { FunnelService } from './funnel.service';
import { FunnelExecution } from './entities/funnel-execution.entity';
import { FunnelStep } from './entities/funnel-step.entity';
import { Product } from './entities/product.entity';

/**
 * Unit tests for the pure/near-pure parts of FunnelService: the checkout-platform payload
 * parsers and the webhook entry point (approval + phone validation + dedupe). Repositories are
 * mocked; the parsers don't touch them, and startFromWebhook only needs findOne/find/create/save.
 */
describe('FunnelService', () => {
  let service: FunnelService;
  let executionRepo: jest.Mocked<Pick<Repository<FunnelExecution>, 'findOne' | 'find' | 'create' | 'save'>>;
  let stepRepo: jest.Mocked<Pick<Repository<FunnelStep>, 'find' | 'count'>>;
  let productRepo: jest.Mocked<Pick<Repository<Product>, 'findOne' | 'find'>>;

  beforeEach(() => {
    executionRepo = {
      findOne: jest.fn(),
      find: jest.fn(),
      create: jest.fn((e: Partial<FunnelExecution>): FunnelExecution => e as FunnelExecution),
      save: jest.fn((e: Partial<FunnelExecution>): Promise<FunnelExecution> =>
        Promise.resolve({ id: 'exec-1', createdAt: new Date(), ...e } as FunnelExecution),
      ),
    } as never;
    stepRepo = { find: jest.fn().mockResolvedValue([]), count: jest.fn() };
    productRepo = { findOne: jest.fn(), find: jest.fn() };

    service = new FunnelService(
      executionRepo as unknown as Repository<FunnelExecution>,
      stepRepo as unknown as Repository<FunnelStep>,
      productRepo as unknown as Repository<Product>,
    );
  });

  describe('parsePerfectPay', () => {
    it('marks status 2 (approved) as approved and reads the DDI-formatted phone', () => {
      const result = service.parsePerfectPay({
        sale_status_enum: 2,
        customer: { full_name: 'Maria Silva', phone_formated_ddi: '+55 (11) 98765-4321' },
      });
      expect(result).toEqual({
        customerName: 'Maria Silva',
        customerPhone: '+55 (11) 98765-4321',
        approved: true,
      });
    });

    it('marks status 10 as approved', () => {
      expect(service.parsePerfectPay({ sale_status_enum: 10, customer: {} }).approved).toBe(true);
    });

    it('marks other statuses as not approved', () => {
      expect(service.parsePerfectPay({ sale_status_enum: 1, customer: {} }).approved).toBe(false);
    });

    it('falls back to area code + number when the formatted phone is absent', () => {
      const result = service.parsePerfectPay({
        sale_status_enum: 2,
        customer: { full_name: 'X', phone_area_code: '11', phone_number: '987654321' },
      });
      expect(result.customerPhone).toBe('11987654321');
    });
  });

  describe('parseKirvano', () => {
    it('treats SALE_APPROVED as approved', () => {
      const result = service.parseKirvano({
        event: 'SALE_APPROVED',
        customer: { name: 'João', phone_number: '5511999998888' },
      });
      expect(result).toEqual({
        customerName: 'João',
        customerPhone: '5511999998888',
        approved: true,
      });
    });

    it('treats any other event as not approved', () => {
      expect(service.parseKirvano({ event: 'SALE_REFUNDED', customer: {} }).approved).toBe(false);
    });
  });

  describe('parseGeneric', () => {
    it('accepts Portuguese keys (nome/telefone) and "aprovada"', () => {
      const result = service.parseGeneric({ nome: 'Ana', telefone: '11987654321', status: 'aprovada' });
      expect(result).toEqual({ customerName: 'Ana', customerPhone: '11987654321', approved: true });
    });

    it('accepts English keys (name/phone) and is case-insensitive on status', () => {
      const result = service.parseGeneric({ name: 'Bob', phone: '11987654321', status: '  Approved  ' });
      expect(result).toEqual({ customerName: 'Bob', customerPhone: '11987654321', approved: true });
    });

    it('accepts "paid" and "aprovado" as approved', () => {
      expect(service.parseGeneric({ status: 'paid' }).approved).toBe(true);
      expect(service.parseGeneric({ status: 'aprovado' }).approved).toBe(true);
    });

    it('rejects unknown statuses', () => {
      expect(service.parseGeneric({ status: 'pending' }).approved).toBe(false);
      expect(service.parseGeneric({}).approved).toBe(false);
    });
  });

  describe('startFromWebhook', () => {
    const product = { id: 'prod-1', name: 'Curso' } as Product;

    it('does nothing for a non-approved sale', async () => {
      const result = await service.startFromWebhook(product, 'perfectpay', {
        customerName: 'X',
        customerPhone: '11987654321',
        approved: false,
      });
      expect(result).toEqual({ started: false, reason: 'not-approved' });
      expect(executionRepo.save).not.toHaveBeenCalled();
    });

    it('reports invalid-phone when the number cannot be normalized', async () => {
      const result = await service.startFromWebhook(product, 'kirvano', {
        customerName: 'X',
        customerPhone: 'not-a-number',
        approved: true,
      });
      expect(result).toEqual({ started: false, reason: 'invalid-phone' });
      expect(executionRepo.save).not.toHaveBeenCalled();
    });

    it('ignores a duplicate running execution within the dedupe window', async () => {
      executionRepo.findOne.mockResolvedValue({ id: 'existing' } as FunnelExecution);
      const result = await service.startFromWebhook(product, 'generico', {
        customerName: 'X',
        customerPhone: '11987654321',
        approved: true,
      });
      expect(result).toEqual({ started: false, reason: 'duplicate' });
      expect(executionRepo.save).not.toHaveBeenCalled();
    });

    it('creates an execution for a fresh approved sale', async () => {
      executionRepo.findOne.mockResolvedValue(null);
      const result = await service.startFromWebhook(product, 'perfectpay', {
        customerName: 'Maria',
        customerPhone: '11987654321',
        approved: true,
      });
      expect(result).toEqual({ started: true });
      expect(executionRepo.save).toHaveBeenCalledTimes(1);
      const created = executionRepo.create.mock.calls[0][0] as Partial<FunnelExecution>;
      expect(created.productId).toBe('prod-1');
      expect(created.chatId).toBe('5511987654321@c.us');
      expect(created.source).toBe('perfectpay');
    });

    it('records a step-less funnel as completed rather than running', async () => {
      executionRepo.findOne.mockResolvedValue(null);
      stepRepo.find.mockResolvedValue([]);
      await service.startFromWebhook(product, 'perfectpay', {
        customerName: 'Maria',
        customerPhone: '11987654321',
        approved: true,
      });
      const created = executionRepo.create.mock.calls[0][0] as Partial<FunnelExecution>;
      expect(created.status).toBe('completed');
      expect(created.nextStepAt).toBeNull();
    });

    it('schedules the first step in the future for a funnel with steps', async () => {
      executionRepo.findOne.mockResolvedValue(null);
      stepRepo.find.mockResolvedValue([{ order: 0, delayMinutes: 5 } as FunnelStep]);
      const before = Date.now();
      await service.startFromWebhook(product, 'perfectpay', {
        customerName: 'Maria',
        customerPhone: '11987654321',
        approved: true,
      });
      const created = executionRepo.create.mock.calls[0][0] as Partial<FunnelExecution>;
      expect(created.status).toBe('running');
      const nextStepAt = (created.nextStepAt as Date).getTime();
      expect(nextStepAt).toBeGreaterThanOrEqual(before + 5 * 60 * 1000);
    });
  });
});
