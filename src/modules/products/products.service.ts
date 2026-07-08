import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { randomBytes } from 'crypto';
import { promises as fs } from 'fs';
import { join } from 'path';
import { createLogger } from '../../common/services/logger.service';
import { isUniqueConstraintError } from '../../common/utils/unique-constraint.util';
import { Product } from './entities/product.entity';
import { FunnelStep } from './entities/funnel-step.entity';
import { FunnelExecution } from './entities/funnel-execution.entity';
import {
  CreateProductDto,
  UpdateProductDto,
  FunnelStepInputDto,
  ProductResponseDto,
  FunnelStepResponseDto,
  MediaUploadResponseDto,
  MAX_MEDIA_FILENAME_LENGTH,
} from './dto/product.dto';

// Media accepted for funnel steps. WhatsApp caps media around 16MB; keep a matching ceiling
// so an oversized upload is rejected up front rather than failing at send time.
const MAX_MEDIA_BYTES = 16 * 1024 * 1024;
// Must live under ./data — in production that's the ONLY writable, persistent volume
// (the container rootfs is mounted read-only). Anywhere else EROFS-fails on upload and would
// be lost on restart. Matches the project's "all writable state under /app/data" convention.
const MEDIA_DIR = join(process.cwd(), 'data', 'funnel-media');

const ALLOWED_MEDIA_MIMETYPES: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'video/mp4': '.mp4',
  'video/3gpp': '.3gp',
  'video/quicktime': '.mov',
  'application/pdf': '.pdf',
  'application/msword': '.doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  'application/vnd.ms-excel': '.xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
};

@Injectable()
export class ProductsService {
  private readonly logger = createLogger('ProductsService');

  constructor(
    @InjectRepository(Product, 'data')
    private readonly productRepo: Repository<Product>,
    @InjectRepository(FunnelStep, 'data')
    private readonly stepRepo: Repository<FunnelStep>,
    @InjectRepository(FunnelExecution, 'data')
    private readonly executionRepo: Repository<FunnelExecution>,
  ) {}

  async findAll(): Promise<ProductResponseDto[]> {
    const products = await this.productRepo.find({ order: { createdAt: 'DESC' } });
    const steps = await this.stepRepo.find({ order: { order: 'ASC' } });
    const stepsByProduct = new Map<string, FunnelStep[]>();
    for (const step of steps) {
      const list = stepsByProduct.get(step.productId) || [];
      list.push(step);
      stepsByProduct.set(step.productId, list);
    }
    return products.map(p => this.toResponse(p, stepsByProduct.get(p.id) || []));
  }

  async findOne(id: string): Promise<ProductResponseDto> {
    const product = await this.productRepo.findOne({ where: { id } });
    if (!product) throw new NotFoundException(`Product ${id} not found`);
    const steps = await this.loadSteps(id);
    return this.toResponse(product, steps);
  }

  /** Internal lookup used by the webhook controller; null (not 404) when the token is unknown. */
  async findByToken(webhookToken: string): Promise<Product | null> {
    return this.productRepo.findOne({ where: { webhookToken } });
  }

  async loadSteps(productId: string): Promise<FunnelStep[]> {
    return this.stepRepo.find({ where: { productId }, order: { order: 'ASC' } });
  }

  async create(dto: CreateProductDto): Promise<ProductResponseDto> {
    const product = this.productRepo.create({
      name: dto.name.trim(),
      sessionId: dto.sessionId.trim(),
      active: dto.active ?? true,
      webhookToken: this.generateToken(),
    });

    let saved: Product;
    try {
      saved = await this.productRepo.save(product);
    } catch (err) {
      if (isUniqueConstraintError(err)) {
        // Token collision is astronomically unlikely; a single retry removes even that chance.
        product.webhookToken = this.generateToken();
        saved = await this.productRepo.save(product);
      } else {
        throw err;
      }
    }

    const steps = await this.replaceSteps(saved.id, dto.steps || []);
    this.logger.log(`Created product ${saved.id} (${saved.name}) with ${steps.length} step(s)`);
    return this.toResponse(saved, steps);
  }

  async update(id: string, dto: UpdateProductDto): Promise<ProductResponseDto> {
    const product = await this.productRepo.findOne({ where: { id } });
    if (!product) throw new NotFoundException(`Product ${id} not found`);

    if (dto.name !== undefined) product.name = dto.name.trim();
    if (dto.sessionId !== undefined) product.sessionId = dto.sessionId.trim();
    if (dto.active !== undefined) product.active = dto.active;
    await this.productRepo.save(product);

    // steps present (even empty array) fully replaces the funnel; absent leaves it untouched.
    const steps = dto.steps !== undefined ? await this.replaceSteps(id, dto.steps) : await this.loadSteps(id);

    this.logger.log(`Updated product ${id}`);
    return this.toResponse(product, steps);
  }

  async remove(id: string): Promise<void> {
    const product = await this.productRepo.findOne({ where: { id } });
    if (!product) throw new NotFoundException(`Product ${id} not found`);

    // Cancel in-flight executions so the scheduler stops touching this product before its rows
    // vanish. The DB FK also cascades steps/executions, but cancelling first keeps logs honest.
    const cancelled = await this.executionRepo.update(
      { productId: id, status: 'running' },
      { status: 'cancelled', nextStepAt: null, completedAt: new Date() },
    );
    if (cancelled.affected) {
      this.logger.log(`Cancelled ${cancelled.affected} running execution(s) for deleted product ${id}`);
    }

    await this.productRepo.remove(product);
    this.logger.log(`Deleted product ${id} (${product.name})`);
  }

  /** Persist an uploaded media file to disk and return the reference stored on a funnel step. */
  async saveMedia(file: {
    buffer?: Buffer;
    originalname?: string;
    mimetype?: string;
    size?: number;
  }): Promise<MediaUploadResponseDto> {
    if (!file?.buffer || !file.buffer.length) {
      throw new BadRequestException('No file uploaded');
    }
    if (file.buffer.length > MAX_MEDIA_BYTES) {
      throw new BadRequestException(`File exceeds the ${MAX_MEDIA_BYTES / (1024 * 1024)}MB limit`);
    }
    const mimetype = String(file.mimetype || '').toLowerCase();
    const ext = ALLOWED_MEDIA_MIMETYPES[mimetype];
    if (!ext) {
      throw new BadRequestException(`Unsupported media type "${mimetype || 'unknown'}"`);
    }

    await fs.mkdir(MEDIA_DIR, { recursive: true });
    const storedName = `${Date.now()}_${randomBytes(8).toString('hex')}${ext}`;
    await fs.writeFile(join(MEDIA_DIR, storedName), file.buffer);

    // Keep the original filename (bounded) for a friendly WhatsApp document name; fall back to
    // the generated name. Path stored relative to the media dir — never a caller-supplied path.
    const original = (file.originalname || storedName).slice(0, MAX_MEDIA_FILENAME_LENGTH);
    this.logger.log(`Stored funnel media ${storedName} (${mimetype}, ${file.buffer.length} bytes)`);
    return {
      mediaPath: storedName,
      mediaFilename: original,
      mediaMimetype: mimetype,
    };
  }

  /** Resolve a step's stored mediaPath to an absolute path inside the media dir (guards traversal). */
  resolveMediaPath(mediaPath: string): string {
    // Stored paths are basenames we generated; strip any directory component defensively so a
    // tampered DB value can't escape the media directory.
    const safe = mediaPath.replace(/[\\/]/g, '');
    return join(MEDIA_DIR, safe);
  }

  private async replaceSteps(productId: string, inputs: FunnelStepInputDto[]): Promise<FunnelStep[]> {
    await this.stepRepo.delete({ productId });
    if (!inputs.length) return [];

    const entities = inputs.map((input, index) =>
      this.stepRepo.create({
        productId,
        order: index,
        type: input.type,
        delayMinutes: input.delayMinutes,
        text: input.text ?? '',
        mediaPath: input.type === 'text' ? null : (input.mediaPath ?? null),
        mediaFilename: input.type === 'text' ? null : (input.mediaFilename ?? null),
        mediaMimetype: input.type === 'text' ? null : (input.mediaMimetype ?? null),
      }),
    );
    return this.stepRepo.save(entities);
  }

  private generateToken(): string {
    return 'prod_' + randomBytes(16).toString('hex');
  }

  private toResponse(product: Product, steps: FunnelStep[]): ProductResponseDto {
    return {
      id: product.id,
      name: product.name,
      webhookToken: product.webhookToken,
      sessionId: product.sessionId,
      active: product.active,
      steps: steps.map(s => this.toStepResponse(s)),
      createdAt: product.createdAt,
      updatedAt: product.updatedAt,
    };
  }

  private toStepResponse(step: FunnelStep): FunnelStepResponseDto {
    return {
      id: step.id,
      order: step.order,
      type: step.type,
      delayMinutes: step.delayMinutes,
      text: step.text,
      mediaPath: step.mediaPath,
      mediaFilename: step.mediaFilename,
      mediaMimetype: step.mediaMimetype,
    };
  }
}
