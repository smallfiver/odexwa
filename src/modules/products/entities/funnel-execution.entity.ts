import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, ManyToOne, JoinColumn, Index } from 'typeorm';
import { Product } from './product.entity';
import { DateTransformer } from '../../../common/transformers/date.transformer';
import { jsonColumnType, dateColumnType } from '../../../common/utils/column-types';

export type FunnelExecutionSource = 'perfectpay' | 'kirvano' | 'generic' | 'test';
export type FunnelExecutionStatus = 'running' | 'completed' | 'cancelled' | 'failed';

export interface FunnelStepResult {
  status: 'sent' | 'failed' | 'skipped';
  sentAt?: string;
  error?: string;
  // Set on the first failed attempt; the scheduler retries until now - firstAttemptAt
  // exceeds the retry window, then marks the step failed and moves on.
  firstAttemptAt?: string;
}

@Entity('funnel_executions')
export class FunnelExecution {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // varchar (not uuid) to match the authoritative migration DDL; the data connection
  // runs synchronize:false, so a 'uuid' decorator here would only mislead schema diffs.
  @Column({ type: 'varchar' })
  productId: string;

  @ManyToOne(() => Product, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'productId' })
  product: Product;

  @Column({ type: 'varchar', length: 255, default: '' })
  customerName: string;

  @Column({ type: 'varchar', length: 64, default: '' })
  customerPhone: string;

  @Column({ type: 'varchar', length: 64 })
  chatId: string;

  @Column({ type: 'varchar', length: 20 })
  source: FunnelExecutionSource;

  @Column({ type: 'int', default: 0 })
  currentStepIndex: number;

  // Absolute time of the next message — the field that makes executions survive restarts.
  @Index()
  @Column({ type: dateColumnType(), nullable: true, transformer: DateTransformer })
  nextStepAt: Date | null;

  @Column({ type: 'varchar', length: 20, default: 'running' })
  status: FunnelExecutionStatus;

  // One entry per already-processed step, keyed by array position (step order).
  @Column({ type: jsonColumnType(), default: '[]' })
  stepResults: FunnelStepResult[];

  @CreateDateColumn()
  createdAt: Date;

  @Column({ type: dateColumnType(), nullable: true, transformer: DateTransformer })
  completedAt: Date | null;
}
