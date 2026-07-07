import { Controller, Get, Post, Param, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam, ApiQuery } from '@nestjs/swagger';
import { FunnelService } from './funnel.service';
import { FunnelExecutionResponseDto } from './dto/product.dto';
import { RequireRole } from '../auth/decorators/auth.decorators';
import { ApiKeyRole } from '../auth/entities/api-key.entity';

@ApiTags('funnel-executions')
@Controller('funnel-executions')
export class FunnelExecutionsController {
  constructor(private readonly funnelService: FunnelService) {}

  @Get()
  @RequireRole(ApiKeyRole.OPERATOR)
  @ApiOperation({ summary: 'List funnel executions (Disparos), newest first' })
  @ApiQuery({ name: 'productId', required: false, description: 'Filter by product' })
  @ApiQuery({ name: 'status', required: false, description: 'Filter by status' })
  @ApiResponse({ status: 200, description: 'List of executions', type: [FunnelExecutionResponseDto] })
  list(
    @Query('productId') productId?: string,
    @Query('status') status?: string,
  ): Promise<FunnelExecutionResponseDto[]> {
    return this.funnelService.listExecutions({ productId, status });
  }

  // Declared before ':id' so "stats" isn't captured as an execution id.
  @Get('stats')
  @RequireRole(ApiKeyRole.OPERATOR)
  @ApiOperation({ summary: 'Dashboard counters: running now, completed today, failures today' })
  @ApiResponse({ status: 200, description: 'Execution counters' })
  stats(): Promise<{ running: number; completedToday: number; failedToday: number }> {
    return this.funnelService.getStats();
  }

  @Get(':id')
  @RequireRole(ApiKeyRole.OPERATOR)
  @ApiOperation({ summary: 'Get an execution with its per-step timeline' })
  @ApiParam({ name: 'id', description: 'Execution ID' })
  @ApiResponse({ status: 200, description: 'Execution details', type: FunnelExecutionResponseDto })
  @ApiResponse({ status: 404, description: 'Execution not found' })
  getOne(@Param('id') id: string): Promise<FunnelExecutionResponseDto> {
    return this.funnelService.getExecution(id);
  }

  @Post(':id/cancel')
  @RequireRole(ApiKeyRole.OPERATOR)
  @ApiOperation({ summary: 'Cancel a running execution' })
  @ApiParam({ name: 'id', description: 'Execution ID' })
  @ApiResponse({
    status: 201,
    description: 'Execution cancelled (or already finished)',
    type: FunnelExecutionResponseDto,
  })
  @ApiResponse({ status: 404, description: 'Execution not found' })
  cancel(@Param('id') id: string): Promise<FunnelExecutionResponseDto> {
    return this.funnelService.cancelExecution(id);
  }
}
