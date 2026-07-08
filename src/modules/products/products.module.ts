import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MessageModule } from '../message/message.module';
import { Product } from './entities/product.entity';
import { FunnelStep } from './entities/funnel-step.entity';
import { FunnelExecution } from './entities/funnel-execution.entity';
import { ProductsService } from './products.service';
import { FunnelService } from './funnel.service';
import { FunnelSchedulerService } from './funnel-scheduler.service';
import { ProductsController } from './products.controller';
import { FunnelExecutionsController } from './funnel-executions.controller';
import { ProductWebhookController } from './product-webhook.controller';

@Module({
  imports: [
    // Products data lives on the 'data' connection (migration-managed, postgres-capable).
    TypeOrmModule.forFeature([Product, FunnelStep, FunnelExecution], 'data'),
    MessageModule,
  ],
  controllers: [ProductsController, FunnelExecutionsController, ProductWebhookController],
  providers: [ProductsService, FunnelService, FunnelSchedulerService],
  exports: [ProductsService],
})
export class ProductsModule {}
