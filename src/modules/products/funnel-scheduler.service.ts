import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThanOrEqual } from 'typeorm';
import { promises as fs } from 'fs';
import { createLogger } from '../../common/services/logger.service';
import { MessageService } from '../message/message.service';
import { FunnelExecution, FunnelStepResult } from './entities/funnel-execution.entity';
import { FunnelStep } from './entities/funnel-step.entity';
import { Product } from './entities/product.entity';
import { ProductsService } from './products.service';

// How often the scheduler wakes to look for due steps. 15s keeps delays reasonably punctual
// without hammering the DB; delays are configured in minutes so sub-minute precision is moot.
const TICK_MS = 15 * 1000;

// A step that keeps failing (session offline, bad number) is retried until this window elapses
// from its first attempt; then it's marked failed and the funnel moves on to the next step.
const STEP_RETRY_WINDOW_MS = 30 * 60 * 1000;

@Injectable()
export class FunnelSchedulerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = createLogger('FunnelScheduler');
  private timer?: ReturnType<typeof setInterval>;
  // Guards against overlapping rounds if a tick's work outlasts the interval.
  private running = false;

  constructor(
    @InjectRepository(FunnelExecution, 'data')
    private readonly executionRepo: Repository<FunnelExecution>,
    @InjectRepository(FunnelStep, 'data')
    private readonly stepRepo: Repository<FunnelStep>,
    @InjectRepository(Product, 'data')
    private readonly productRepo: Repository<Product>,
    private readonly messageService: MessageService,
    private readonly productsService: ProductsService,
  ) {}

  onModuleInit(): void {
    // Fire once on boot so a restart immediately resumes any overdue executions.
    void this.tick();
    this.timer = setInterval(() => void this.tick(), TICK_MS);
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** Process every execution whose next step is due. Sequential to avoid overloading a session. */
  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const due = await this.executionRepo.find({
        where: { status: 'running', nextStepAt: LessThanOrEqual(new Date()) },
        order: { nextStepAt: 'ASC' },
        take: 50,
      });
      for (const execution of due) {
        try {
          await this.processExecution(execution);
        } catch (err) {
          this.logger.error(`Execution ${execution.id} failed unexpectedly: ${(err as Error).message}`);
        }
      }
    } catch (err) {
      this.logger.error(`Scheduler tick failed: ${(err as Error).message}`);
    } finally {
      this.running = false;
    }
  }

  private async processExecution(execution: FunnelExecution): Promise<void> {
    const product = await this.productRepo.findOne({ where: { id: execution.productId } });
    if (!product) {
      // Product deleted out from under a running execution — cancel it and stop.
      await this.finish(execution, 'cancelled');
      return;
    }

    // Read steps live each round so edits to the funnel are honoured mid-flight.
    const steps = await this.stepRepo.find({ where: { productId: execution.productId }, order: { order: 'ASC' } });
    const index = execution.currentStepIndex;

    if (index >= steps.length) {
      await this.finish(execution, 'completed');
      return;
    }

    const step = steps[index];
    const result = await this.trySendStep(product, execution, step);

    if (result === 'retry') {
      // Leave status running and nextStepAt in the past-ish so the next tick retries soon.
      execution.nextStepAt = new Date(Date.now() + TICK_MS);
      await this.executionRepo.save(execution);
      return;
    }

    // sent or failed(after window) → record result and advance to the next step.
    execution.stepResults[index] = result;
    const nextIndex = index + 1;
    execution.currentStepIndex = nextIndex;

    if (nextIndex >= steps.length) {
      execution.nextStepAt = null;
      await this.finish(execution, 'completed');
      return;
    }

    const nextDelayMs = steps[nextIndex].delayMinutes * 60 * 1000;
    execution.nextStepAt = new Date(Date.now() + nextDelayMs);
    await this.executionRepo.save(execution);
  }

  /**
   * Returns the FunnelStepResult to persist, or the literal 'retry' to try again next tick.
   * On the first failure it stamps firstAttemptAt; once the retry window elapses it gives up on
   * this step (result 'failed') so a permanently-broken step can't stall the whole funnel.
   */
  private async trySendStep(
    product: Product,
    execution: FunnelExecution,
    step: FunnelStep,
  ): Promise<FunnelStepResult | 'retry'> {
    try {
      await this.sendStep(product, execution, step);
      return { status: 'sent', sentAt: new Date().toISOString() };
    } catch (err) {
      const message = (err as Error).message;
      const existing = execution.stepResults[execution.currentStepIndex];
      const firstAttemptAt = existing?.firstAttemptAt || new Date().toISOString();
      const elapsed = Date.now() - new Date(firstAttemptAt).getTime();

      if (elapsed >= STEP_RETRY_WINDOW_MS) {
        this.logger.warn(
          `Step ${step.order} of execution ${execution.id} failed permanently after retry window: ${message}`,
        );
        return { status: 'failed', error: message, firstAttemptAt };
      }

      // Still within the window: stash firstAttemptAt so the next tick can measure elapsed time.
      this.logger.warn(`Step ${step.order} of execution ${execution.id} failed, will retry: ${message}`);
      execution.stepResults[execution.currentStepIndex] = {
        status: 'failed',
        error: message,
        firstAttemptAt,
      };
      return 'retry';
    }
  }

  private async sendStep(product: Product, execution: FunnelExecution, step: FunnelStep): Promise<void> {
    const chatId = execution.chatId;
    const caption = this.applyPlaceholders(step.text, execution.customerName, product.name);

    if (step.type === 'text') {
      await this.messageService.sendText(product.sessionId, { chatId, text: caption });
      return;
    }

    // Media step: read the stored file, send as base64 with the original filename/mimetype.
    if (!step.mediaPath || !step.mediaMimetype) {
      throw new Error(`Media step ${step.order} is missing mediaPath/mediaMimetype`);
    }
    const absolute = this.productsService.resolveMediaPath(step.mediaPath);
    const base64 = (await fs.readFile(absolute)).toString('base64');
    const dto = {
      chatId,
      base64,
      mimetype: step.mediaMimetype,
      filename: step.mediaFilename || undefined,
      caption: caption || undefined,
    };

    if (step.type === 'image') {
      await this.messageService.sendImage(product.sessionId, dto);
    } else if (step.type === 'video') {
      await this.messageService.sendVideo(product.sessionId, dto);
    } else {
      await this.messageService.sendDocument(product.sessionId, dto);
    }
  }

  private applyPlaceholders(text: string, customerName: string, productName: string): string {
    return (text || '')
      .replace(/{{\s*customerName\s*}}/gi, customerName || 'cliente')
      .replace(/{{\s*productName\s*}}/gi, productName || 'seu produto');
  }

  private async finish(execution: FunnelExecution, status: 'completed' | 'cancelled'): Promise<void> {
    execution.status = status;
    execution.nextStepAt = null;
    execution.completedAt = new Date();
    await this.executionRepo.save(execution);
    this.logger.log(`Execution ${execution.id} ${status}`);
  }
}
