import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Product } from './product.entity';

export type FunnelStepType = 'text' | 'image' | 'video' | 'document';

@Entity('funnel_steps')
export class FunnelStep {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // varchar (not uuid) to match the authoritative migration DDL; the data connection
  // runs synchronize:false, so a 'uuid' decorator here would only mislead schema diffs.
  @Column({ type: 'varchar' })
  productId: string;

  @ManyToOne(() => Product, product => product.steps, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'productId' })
  product: Product;

  // 0-based position in the funnel sequence.
  @Column({ type: 'int' })
  order: number;

  // Wait AFTER the previous step (0 = immediate). The dashboard offers min/hour/day units
  // and converts to minutes before saving.
  @Column({ type: 'int', default: 0 })
  delayMinutes: number;

  @Column({ type: 'varchar', length: 20 })
  type: FunnelStepType;

  // Message body (type=text) or media caption; supports {{customerName}} / {{productName}}.
  @Column({ type: 'text', default: '' })
  text: string;

  // Basename of the stored file under data/funnel-media/ for media steps; null for text steps.
  @Column({ type: 'varchar', length: 1024, nullable: true })
  mediaPath: string | null;

  // Original upload filename + mimetype so the scheduler can send base64 media correctly.
  @Column({ type: 'varchar', length: 255, nullable: true })
  mediaFilename: string | null;

  @Column({ type: 'varchar', length: 127, nullable: true })
  mediaMimetype: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
