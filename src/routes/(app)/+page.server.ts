import { error, redirect } from '@sveltejs/kit';
import type { PostgrestError } from '@supabase/supabase-js';
import type {
  GroupConsolidated,
  PeriodCompleteness,
  PeriodPnl,
  ReportingBasis,
  RevenuePresentation
} from '$lib/domain';
import {
  aggregateConsolidated,
  entityTotals,
  previousRange,
  rangeCompleteness,
  rangeLabel,
  resolveRange,
  type EntityTotals,
  type PeriodRange,
  type RangeCompleteness,
  type RangeConsolidated
} from '$lib/period-range';
import { canReadAllEntities, canReadOperational, canWriteOperational } from '$lib/roles';
import type { PageServerLoad } from './$types';

interface EntityRow {
  id: string;
  code: string;
  legal_name: string;
  business_line: string;
  icon_key: string;
  theme_color: string;
  reporting_basis: ReportingBasis;
  revenue_presentation: RevenuePresentation;
}

interface OpenPolicy {
  policy_key: string;
  entity_id: string | null;
}

/**
 * Postgres messages name tables, columns and policies. That is exactly what
 * an attacker probing the schema wants, so it goes to the server log and the
 * browser gets a fixed sentence.
 */
function fail(context: string, cause: PostgrestError): never {
  console.error(`[dashboard] ${context}:`, cause.code, cause.message, cause.details);
  error(500, 'Gagal memuat data dasbor.');
}

/**
 * One shape for every branch. SvelteKit widens a load's return type before it
 * reaches the component, so a discriminated union would not narrow there —
 * returning the same keys with empty defaults keeps the page honest without
 * non-null assertions.
 */
const EMPTY = {
  periods: [] as PeriodCompleteness[],
  range: null as PeriodRange | null,
  prior: null as PeriodRange | null,
  rangeLabel: '',
  priorLabel: '',
  period: null as string | null,
  completeness: null as RangeCompleteness | null,
  priorCompleteness: null as RangeCompleteness | null,
  consolidated: null as RangeConsolidated | null,
  previous: null as RangeConsolidated | null,
  pnl: [] as PeriodPnl[],
  totals: {} as Record<string, EntityTotals>,
  entities: [] as EntityRow[],
  openPolicies: [] as OpenPolicy[]
};

export const load: PageServerLoad = async ({ locals, url }) => {
  /**
   * A group total read under entity-scoped RLS is a different number, not a
   * smaller one (CONTEXT.md, "Kelengkapan"). Entity staff see only their own
   * entity, so rendering a "consolidated" figure for them would quietly show
   * one entity's revenue as the group's. Refuse — by sending each role
   * straight to the screen it works in, so logging in lands an operational
   * admin in their own PT's Operasional rather than on a dead end.
   *
   * Since 16 Oktober 2026 nobody lands on this dashboard: there is no
   * approval step in practice, so the consolidated figures it shows never
   * fill. Direksi and manajer go to the final reports, admin operasional to
   * its own module. The screen below stays for a role without operational
   * read, should one ever exist.
   */
  if (canReadOperational(locals.role) || !canReadAllEntities(locals.role)) {
    redirect(303, canWriteOperational(locals.role) ? '/operasional' : '/operasional/laporan');
  }

  const { supabase } = locals;

  const { data: periodRows, error: periodsError } = await supabase
    .from('v_period_completeness')
    .select('period, expected_entities, reported_entities, is_complete, missing_entities')
    .order('period', { ascending: false })
    .returns<PeriodCompleteness[]>();

  if (periodsError) fail('v_period_completeness', periodsError);

  const periods = periodRows ?? [];
  if (periods.length === 0) return { ...EMPTY, periods };

  const range = resolveRange(url.searchParams, periods[0].period);
  const prior = previousRange(range);

  const [consolidatedResult, previousResult, pnlResult, entitiesResult, policiesResult] =
    await Promise.all([
      supabase
        .from('v_group_consolidated')
        .select('*')
        .gte('period', range.from)
        .lte('period', range.to)
        .returns<GroupConsolidated[]>(),
      supabase
        .from('v_group_consolidated')
        .select('*')
        .gte('period', prior.from)
        .lte('period', prior.to)
        .returns<GroupConsolidated[]>(),
      supabase
        .from('v_period_pnl')
        .select('*')
        .gte('period', range.from)
        .lte('period', range.to)
        .returns<PeriodPnl[]>(),
      supabase
        .from('entities')
        .select(
          'id, code, legal_name, business_line, icon_key, theme_color, reporting_basis, revenue_presentation'
        )
        .eq('is_active', true)
        .order('code')
        .returns<EntityRow[]>(),
      // chosen_value IS NULL means the accountant has not decided. The UI has
      // to surface that rather than pick a default (invariant 8).
      supabase
        .from('accounting_policies')
        .select('policy_key, entity_id')
        .is('chosen_value', null)
        .returns<OpenPolicy[]>()
    ]);

  const firstError =
    consolidatedResult.error ??
    previousResult.error ??
    pnlResult.error ??
    entitiesResult.error ??
    policiesResult.error;
  if (firstError) fail('dashboard queries', firstError);

  const entities = entitiesResult.data ?? [];
  const activeCodes = entities.map((e) => e.code);
  const pnl = pnlResult.data ?? [];

  return {
    ...EMPTY,
    periods,
    range,
    prior,
    rangeLabel: rangeLabel(range),
    priorLabel: rangeLabel(prior),
    /** Kept for the single-month screens below that still speak in one period. */
    period: range.to,
    completeness: rangeCompleteness(range, periods, activeCodes),
    priorCompleteness: rangeCompleteness(prior, periods, activeCodes),
    consolidated: aggregateConsolidated(consolidatedResult.data ?? []),
    /** Same-length range just before. MoM, YoY, or "vs. sebelumnya" — never mislabelled. */
    previous: aggregateConsolidated(previousResult.data ?? []),
    pnl,
    totals: Object.fromEntries(entityTotals(pnl)),
    entities,
    openPolicies: policiesResult.data ?? []
  };
};
