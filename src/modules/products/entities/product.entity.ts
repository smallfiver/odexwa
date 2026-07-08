import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, UpdateDateColumn, OneToMany } from 'typeorm';
import { FunnelStep } from './funnel-step.entity';

@Entity('products')
export class Product {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 100 })
  name: string;

  // Random per-product secret embedded in the public webhook URLs
  // (/webhooks/produtos/:webhookToken/...). Unique-indexed by the migration.
  @Column({ type: 'varchar', length: 64, unique: true })
  webhookToken: string;

  // varchar (not a sessions FK) so deleting/recreating a WhatsApp session never cascades away
  // products; a missing session simply makes sends fail (and retry) until it reconnects.
  @Column({ type: 'varchar' })
  sessionId: string;

  @Column({ type: 'boolean', default: true })
  active: boolean;

  @OneToMany(() => FunnelStep, step => step.product)
  steps: FunnelStep[];

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
