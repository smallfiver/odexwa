import { Repository } from 'typeorm';
import { FunnelSchedulerService } from './funnel-scheduler.service';
import { FunnelExecution } from './entities/funnel-execution.entity';
import { FunnelStep } from './entities/funnel-step.entity';
import { Product } from './entities/product.entity';
import { MessageService } from '../message/message.service';
import { ProductsService } from './products.service';

const STEP_RETRY_WINDOW_MS = 30 * 60 * 1000;

/**
 * Unit tests for FunnelSchedulerService's placeholder substitution, retry-window logic, and
 * step advancement. Repositories and the message service are mocked; the scheduler's private
 * methods are exercised directly since they hold the non-trivial logic.
 */
describe('FunnelSchedulerService', () => {
  let service: FunnelSchedulerService;
  let executionRepo: jest.Mocked<Pick<Repository<FunnelExecution>, 'find' | 'findOne' | 'save'>>;
  let stepRepo: jest.Mocked<Pick<Repository<FunnelStep>, 'find'>>;
  let productRepo: jest.Mocked<Pick<Repository<Product>, 'findOne'>>;
  let messageService: jest.Mocked<Pick<MessageService, 'sendText' | 'sendImage' | 'sendVideo' | 'sendDocument'>>;
  let productsService: jest.Mocked<Pick<ProductsService, 'resolveMediaPath'>>;

  beforeEach(() => {
    executionRepo = {
      find: jest.fn(),
      findOne: jest.fn(),
      save: jest.fn((e: FunnelExecution): Promise<FunnelExecution> => Promise.resolve(e)),
    } as never;
    stepRepo = { find: jest.fn() };
    productRepo = { findOne: jest.fn() };
    messageService = {
      sendText: jest.fn(),
      sendImage: jest.fn(),
      sendVideo: jest.fn(),
      sendDocument: jest.fn(),
    };
    productsService = { resolveMediaPath: jest.fn() };

    service = new FunnelSchedulerService(
      executionRepo as unknown as Repository<FunnelExecution>,
      stepRepo as unknown as Repository<FunnelStep>,
      productRepo as unknown as Repository<Product>,
      messageService as unknown as MessageService,
      productsService as unknown as ProductsService,
    );
  });

  describe('applyPlaceholders', () => {
    const apply = (text: string, name: string, product: string): string =>
      (service as unknown as { applyPlaceholders(t: string, n: string, p: string): string }).applyPlaceholders(
        text,
        name,
        product,
      );

    it('substitutes customerName and productName', () => {
      expect(apply('Oi {{customerName}}, obrigado por comprar {{productName}}!', 'Maria', 'Curso')).toBe(
        'Oi Maria, obrigado por comprar Curso!',
      );
    });

    it('is case-insensitive and tolerates inner whitespace', () => {
      expect(apply('{{ CustomerName }} / {{PRODUCTNAME}}', 'Ana', 'X')).toBe('Ana / X');
    });

    it('falls back to defaults when values are empty', () => {
      expect(apply('{{customerName}} - {{productName}}', '', '')).toBe('cliente - seu produto');
    });

    it('handles empty/undefined text safely', () => {
      expect(apply('', 'Ana', 'X')).toBe('');
      expect(apply(undefined as unknown as string, 'Ana', 'X')).toBe('');
    });
  });

  describe('trySendStep', () => {
    const product = { id: 'p1', name: 'Curso', sessionId: 's1' } as Product;
    const step = { order: 0, type: 'text', text: 'oi', delayMinutes: 0 } as FunnelStep;
    const trySend = (execution: FunnelExecution): Promise<unknown> =>
      (
        service as unknown as {
          trySendStep(p: Product, e: FunnelExecution, s: FunnelStep): Promise<unknown>;
        }
      ).trySendStep(product, execution, step);

    it("returns a 'sent' result when the message is delivered", async () => {
      messageService.sendText.mockResolvedValue(undefined as never);
      const execution = {
        currentStepIndex: 0,
        stepResults: [],
        chatId: 'c',
        customerName: 'A',
      } as unknown as FunnelExecution;
      const result = (await trySend(execution)) as { status: string; sentAt: string };
      expect(result.status).toBe('sent');
      expect(result.sentAt).toBeTruthy();
      expect(messageService.sendText).toHaveBeenCalledWith('s1', { chatId: 'c', text: 'oi' });
    });

    it("returns 'retry' and stashes firstAttemptAt on the first failure", async () => {
      messageService.sendText.mockRejectedValue(new Error('offline'));
      const execution = {
        currentStepIndex: 0,
        stepResults: [],
        chatId: 'c',
        customerName: 'A',
      } as unknown as FunnelExecution;
      const result = await trySend(execution);
      expect(result).toBe('retry');
      expect(execution.stepResults[0]).toMatchObject({ status: 'failed', error: 'offline' });
      expect(execution.stepResults[0].firstAttemptAt).toBeTruthy();
    });

    it("returns a 'failed' result once the retry window has elapsed", async () => {
      messageService.sendText.mockRejectedValue(new Error('offline'));
      const oldAttempt = new Date(Date.now() - STEP_RETRY_WINDOW_MS - 1000).toISOString();
      const execution = {
        currentStepIndex: 0,
        stepResults: [{ status: 'failed', error: 'offline', firstAttemptAt: oldAttempt }],
        chatId: 'c',
        customerName: 'A',
      } as unknown as FunnelExecution;
      const result = (await trySend(execution)) as { status: string; firstAttemptAt: string };
      expect(result.status).toBe('failed');
      expect(result.firstAttemptAt).toBe(oldAttempt);
    });
  });

  describe('processExecution', () => {
    const process = (execution: FunnelExecution): Promise<void> =>
      (service as unknown as { processExecution(e: FunnelExecution): Promise<void> }).processExecution(execution);

    it('cancels the execution if its product was deleted', async () => {
      productRepo.findOne.mockResolvedValue(null);
      const execution = {
        id: 'e1',
        productId: 'gone',
        currentStepIndex: 0,
        stepResults: [],
      } as unknown as FunnelExecution;
      await process(execution);
      expect(execution.status).toBe('cancelled');
      expect(execution.completedAt).toBeInstanceOf(Date);
    });

    it('sends the current step and schedules the next by its delay', async () => {
      productRepo.findOne.mockResolvedValue({ id: 'p1', name: 'Curso', sessionId: 's1' } as Product);
      stepRepo.find.mockResolvedValue([
        { order: 0, type: 'text', text: 'a', delayMinutes: 0 } as FunnelStep,
        { order: 1, type: 'text', text: 'b', delayMinutes: 10 } as FunnelStep,
      ]);
      messageService.sendText.mockResolvedValue(undefined as never);
      const execution = {
        id: 'e1',
        productId: 'p1',
        currentStepIndex: 0,
        stepResults: [],
        chatId: 'c',
        customerName: 'A',
        status: 'running',
      } as unknown as FunnelExecution;

      const before = Date.now();
      await process(execution);

      expect(execution.stepResults[0].status).toBe('sent');
      expect(execution.currentStepIndex).toBe(1);
      expect(execution.status).toBe('running');
      expect((execution.nextStepAt as Date).getTime()).toBeGreaterThanOrEqual(before + 10 * 60 * 1000);
    });

    it('completes the execution after the last step is sent', async () => {
      productRepo.findOne.mockResolvedValue({ id: 'p1', name: 'Curso', sessionId: 's1' } as Product);
      stepRepo.find.mockResolvedValue([{ order: 0, type: 'text', text: 'a', delayMinutes: 0 } as FunnelStep]);
      messageService.sendText.mockResolvedValue(undefined as never);
      const execution = {
        id: 'e1',
        productId: 'p1',
        currentStepIndex: 0,
        stepResults: [],
        chatId: 'c',
        customerName: 'A',
        status: 'running',
      } as unknown as FunnelExecution;

      await process(execution);

      expect(execution.currentStepIndex).toBe(1);
      expect(execution.status).toBe('completed');
      expect(execution.nextStepAt).toBeNull();
      expect(execution.completedAt).toBeInstanceOf(Date);
    });

    it('completes immediately when currentStepIndex is past the last step', async () => {
      productRepo.findOne.mockResolvedValue({ id: 'p1', name: 'Curso', sessionId: 's1' } as Product);
      stepRepo.find.mockResolvedValue([{ order: 0, type: 'text', text: 'a', delayMinutes: 0 } as FunnelStep]);
      const execution = {
        id: 'e1',
        productId: 'p1',
        currentStepIndex: 5,
        stepResults: [],
        status: 'running',
      } as unknown as FunnelExecution;

      await process(execution);
      expect(execution.status).toBe('completed');
      expect(messageService.sendText).not.toHaveBeenCalled();
    });
  });
});
