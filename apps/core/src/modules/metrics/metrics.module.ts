import {
  CallHandler,
  Controller,
  ExecutionContext,
  Get,
  Header,
  Injectable,
  Module,
  NestInterceptor,
} from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { SkipThrottle } from '@nestjs/throttler';
import {
  Counter,
  Histogram,
  Registry,
  collectDefaultMetrics,
} from 'prom-client';
import type { Observable } from 'rxjs';
import { finalize } from 'rxjs/operators';
import { Public } from '../auth/auth.module';

// One registry per process: default Node metrics + ATLAS HTTP telemetry.
const registry = new Registry();
collectDefaultMetrics({ register: registry });

const httpRequests = new Counter({
  name: 'atlas_http_requests_total',
  help: 'HTTP requests served, by method/route/status',
  labelNames: ['method', 'route', 'status'] as const,
  registers: [registry],
});

const httpDuration = new Histogram({
  name: 'atlas_http_request_duration_seconds',
  help: 'HTTP request duration, by method/route',
  labelNames: ['method', 'route'] as const,
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [registry],
});

interface MetricRequest {
  method: string;
  url: string;
  route?: { path?: string };
}

interface MetricResponse {
  statusCode: number;
}

@Injectable()
export class MetricsInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<MetricRequest>();
    const response = context.switchToHttp().getResponse<MetricResponse>();
    const endTimer = httpDuration.startTimer();
    return next.handle().pipe(
      finalize(() => {
        // The route PATTERN (e.g. /api/tender/tenders/:id) keeps label
        // cardinality bounded — never the concrete URL.
        const route = request.route?.path ?? 'unmatched';
        endTimer({ method: request.method, route });
        httpRequests.inc({
          method: request.method,
          route,
          status: String(response.statusCode),
        });
      }),
    );
  }
}

@Controller('metrics')
export class MetricsController {
  /** Prometheus scrape target — bind behind loopback/VPN in production. */
  @Public()
  @SkipThrottle()
  @Get()
  @Header('Content-Type', registry.contentType)
  async metrics(): Promise<string> {
    return registry.metrics();
  }
}

@Module({
  controllers: [MetricsController],
  providers: [{ provide: APP_INTERCEPTOR, useClass: MetricsInterceptor }],
})
export class MetricsModule {}
