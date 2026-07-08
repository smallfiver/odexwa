import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsBoolean,
  IsInt,
  IsIn,
  IsArray,
  Min,
  Max,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import type { FunnelStepType } from '../entities/funnel-step.entity';
import type {
  FunnelExecutionSource,
  FunnelExecutionStatus,
  FunnelStepResult,
} from '../entities/funnel-execution.entity';

export const MAX_PRODUCT_NAME_LENGTH = 100;
export const MAX_STEP_TEXT_LENGTH = 4096;
export const MAX_MEDIA_PATH_LENGTH = 1024;
export const MAX_MEDIA_FILENAME_LENGTH = 255;
export const MAX_MEDIA_MIMETYPE_LENGTH = 127;
export const MAX_PHONE_LENGTH = 32;
// 30 days — hard cap so a unit-conversion bug in the dashboard can't schedule a step years out.
export const MAX_DELAY_MINUTES = 43200;

export const FUNNEL_STEP_TYPES: FunnelStepType[] = ['text', 'image', 'video', 'document'];

export class FunnelStepInputDto {
  @ApiProperty({ description: 'Step type', enum: FUNNEL_STEP_TYPES })
  @IsIn(FUNNEL_STEP_TYPES)
  type: FunnelStepType;

  @ApiProperty({ description: 'Wait after the previous step, in minutes (0 = immediate)', minimum: 0 })
  @IsInt()
  @Min(0)
  @Max(MAX_DELAY_MINUTES)
  delayMinutes: number;

  @ApiPropertyOptional({
    description: 'Message body (text) or media caption; supports {{customerName}}/{{productName}}',
  })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_STEP_TEXT_LENGTH)
  text?: string;

  @ApiPropertyOptional({ description: 'Server path returned by POST /products/media (media steps only)' })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_MEDIA_PATH_LENGTH)
  mediaPath?: string;

  @ApiPropertyOptional({ description: 'Original filename of the uploaded media' })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_MEDIA_FILENAME_LENGTH)
  mediaFilename?: string;

  @ApiPropertyOptional({ description: 'Mimetype of the uploaded media' })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_MEDIA_MIMETYPE_LENGTH)
  mediaMimetype?: string;
}

export class CreateProductDto {
  @ApiProperty({ description: 'Product name', maxLength: MAX_PRODUCT_NAME_LENGTH })
  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_PRODUCT_NAME_LENGTH)
  name: string;

  @ApiProperty({ description: 'WhatsApp session id used to send the funnel messages' })
  @IsString()
  @IsNotEmpty()
  sessionId: string;

  @ApiPropertyOptional({ description: 'Whether webhooks for this product are processed', default: true })
  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @ApiPropertyOptional({ description: 'Ordered funnel steps', type: [FunnelStepInputDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => FunnelStepInputDto)
  steps?: FunnelStepInputDto[];
}

export class UpdateProductDto {
  @ApiPropertyOptional({ description: 'Product name', maxLength: MAX_PRODUCT_NAME_LENGTH })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_PRODUCT_NAME_LENGTH)
  name?: string;

  @ApiPropertyOptional({ description: 'WhatsApp session id used to send the funnel messages' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  sessionId?: string;

  @ApiPropertyOptional({ description: 'Whether webhooks for this product are processed' })
  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @ApiPropertyOptional({
    description: 'Ordered funnel steps; when present, fully replaces the existing steps',
    type: [FunnelStepInputDto],
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => FunnelStepInputDto)
  steps?: FunnelStepInputDto[];
}

export class TestFunnelDto {
  @ApiProperty({ description: 'Phone number (Brazilian format accepted) to receive the test funnel' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_PHONE_LENGTH)
  phone: string;
}

export class FunnelStepResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  order: number;

  @ApiProperty({ enum: FUNNEL_STEP_TYPES })
  type: FunnelStepType;

  @ApiProperty()
  delayMinutes: number;

  @ApiProperty()
  text: string;

  @ApiPropertyOptional({ nullable: true })
  mediaPath: string | null;

  @ApiPropertyOptional({ nullable: true })
  mediaFilename: string | null;

  @ApiPropertyOptional({ nullable: true })
  mediaMimetype: string | null;
}

export class ProductResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  name: string;

  @ApiProperty()
  webhookToken: string;

  @ApiProperty()
  sessionId: string;

  @ApiProperty()
  active: boolean;

  @ApiProperty({ type: [FunnelStepResponseDto] })
  steps: FunnelStepResponseDto[];

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}

export class MediaUploadResponseDto {
  @ApiProperty({ description: 'Server path to reference in FunnelStepInputDto.mediaPath' })
  mediaPath: string;

  @ApiProperty()
  mediaFilename: string;

  @ApiProperty()
  mediaMimetype: string;
}

export class FunnelExecutionResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  productId: string;

  @ApiPropertyOptional({ description: 'Product name (joined for the dashboard listing)' })
  productName?: string;

  @ApiProperty()
  customerName: string;

  @ApiProperty()
  customerPhone: string;

  @ApiProperty()
  chatId: string;

  @ApiProperty({ enum: ['perfectpay', 'kirvano', 'generic', 'test'] })
  source: FunnelExecutionSource;

  @ApiProperty()
  currentStepIndex: number;

  @ApiProperty({ description: 'Total steps in the product funnel (live count)' })
  totalSteps: number;

  @ApiPropertyOptional({ nullable: true })
  nextStepAt: Date | null;

  @ApiProperty({ enum: ['running', 'completed', 'cancelled', 'failed'] })
  status: FunnelExecutionStatus;

  @ApiProperty({ description: 'Per-step results, indexed by step order' })
  stepResults: FunnelStepResult[];

  @ApiProperty()
  createdAt: Date;

  @ApiPropertyOptional({ nullable: true })
  completedAt: Date | null;
}
