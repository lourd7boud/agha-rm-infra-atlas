import { NextResponse, type NextRequest } from 'next/server';
import { apiGet, AtlasApiError } from '@/lib/api';
import type { PricingRunView } from '@/lib/bdc';

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ runId: string }> },
): Promise<Response> {
  const { runId } = await context.params;
  try {
    const run = await apiGet<PricingRunView>(
      `/bdc/pricing-runs/${encodeURIComponent(runId)}`,
      { timeoutMs: 15_000 },
    );
    return NextResponse.json(run, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    const status = error instanceof AtlasApiError ? error.status : 503;
    return NextResponse.json(
      { error: 'Statut du chiffrage indisponible' },
      { status },
    );
  }
}
