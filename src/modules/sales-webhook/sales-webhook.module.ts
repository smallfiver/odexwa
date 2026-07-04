import { Module } from '@nestjs/common';
import { MessageModule } from '../message/message.module';
import { SalesWebhookController } from './sales-webhook.controller';
import { SalesWebhookService } from './sales-webhook.service';

@Module({
  imports: [MessageModule],
  controllers: [SalesWebhookController],
  providers: [SalesWebhookService],
})
export class SalesWebhookModule {}
