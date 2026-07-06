import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Param,
  Body,
  HttpCode,
  HttpStatus,
  UseInterceptors,
  UploadedFile,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiOperation, ApiResponse, ApiParam, ApiConsumes } from '@nestjs/swagger';
import { ProductsService } from './products.service';
import { FunnelService } from './funnel.service';
import {
  CreateProductDto,
  UpdateProductDto,
  TestFunnelDto,
  ProductResponseDto,
  MediaUploadResponseDto,
  FunnelExecutionResponseDto,
} from './dto/product.dto';
import { RequireRole } from '../auth/decorators/auth.decorators';
import { ApiKeyRole } from '../auth/entities/api-key.entity';

// WhatsApp caps media around 16MB; mirror that ceiling on the multipart interceptor so an
// oversized upload is rejected before it reaches disk (the service re-checks the buffer too).
const MAX_MEDIA_UPLOAD_BYTES = 16 * 1024 * 1024;

@ApiTags('products')
@Controller('products')
export class ProductsController {
  constructor(
    private readonly productsService: ProductsService,
    private readonly funnelService: FunnelService,
  ) {}

  @Get()
  @RequireRole(ApiKeyRole.OPERATOR)
  @ApiOperation({ summary: 'List all products with their funnel steps' })
  @ApiResponse({ status: 200, description: 'List of products', type: [ProductResponseDto] })
  findAll(): Promise<ProductResponseDto[]> {
    return this.productsService.findAll();
  }

  // Static route declared before ':id' so "media" isn't captured as a product id.
  @Post('media')
  @RequireRole(ApiKeyRole.OPERATOR)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_MEDIA_UPLOAD_BYTES } }))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Upload a media file for a funnel step' })
  @ApiResponse({ status: 201, description: 'Media stored', type: MediaUploadResponseDto })
  @ApiResponse({ status: 400, description: 'Missing, oversized, or unsupported media' })
  uploadMedia(@UploadedFile() file: { buffer?: Buffer; originalname?: string; mimetype?: string; size?: number }): Promise<MediaUploadResponseDto> {
    return this.productsService.saveMedia(file || {});
  }

  @Get(':id')
  @RequireRole(ApiKeyRole.OPERATOR)
  @ApiOperation({ summary: 'Get a product by ID' })
  @ApiParam({ name: 'id', description: 'Product ID' })
  @ApiResponse({ status: 200, description: 'Product details', type: ProductResponseDto })
  @ApiResponse({ status: 404, description: 'Product not found' })
  findOne(@Param('id') id: string): Promise<ProductResponseDto> {
    return this.productsService.findOne(id);
  }

  @Post()
  @RequireRole(ApiKeyRole.OPERATOR)
  @ApiOperation({ summary: 'Create a product and its funnel' })
  @ApiResponse({ status: 201, description: 'Product created', type: ProductResponseDto })
  create(@Body() dto: CreateProductDto): Promise<ProductResponseDto> {
    return this.productsService.create(dto);
  }

  @Put(':id')
  @RequireRole(ApiKeyRole.OPERATOR)
  @ApiOperation({ summary: 'Update a product; when steps are present they replace the funnel' })
  @ApiParam({ name: 'id', description: 'Product ID' })
  @ApiResponse({ status: 200, description: 'Product updated', type: ProductResponseDto })
  @ApiResponse({ status: 404, description: 'Product not found' })
  update(@Param('id') id: string, @Body() dto: UpdateProductDto): Promise<ProductResponseDto> {
    return this.productsService.update(id, dto);
  }

  @Delete(':id')
  @RequireRole(ApiKeyRole.OPERATOR)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a product, its steps, and cancel running executions' })
  @ApiParam({ name: 'id', description: 'Product ID' })
  @ApiResponse({ status: 204, description: 'Product deleted' })
  @ApiResponse({ status: 404, description: 'Product not found' })
  remove(@Param('id') id: string): Promise<void> {
    return this.productsService.remove(id);
  }

  @Post(':id/test')
  @RequireRole(ApiKeyRole.OPERATOR)
  @ApiOperation({ summary: 'Run this product funnel against a test phone number' })
  @ApiParam({ name: 'id', description: 'Product ID' })
  @ApiResponse({ status: 201, description: 'Test execution started', type: FunnelExecutionResponseDto })
  @ApiResponse({ status: 400, description: 'Invalid phone number' })
  @ApiResponse({ status: 404, description: 'Product not found' })
  test(@Param('id') id: string, @Body() dto: TestFunnelDto): Promise<FunnelExecutionResponseDto> {
    return this.funnelService.startTest(id, dto);
  }
}
