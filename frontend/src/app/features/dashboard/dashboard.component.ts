// ============================================================
// Ahadi Kenya Population Analytics — Dashboard Component
// Implements ALL Part 2 requirements from README:
//  ✓ County dropdown, Year, Sex toggle, Indicator dropdown
//  ✓ Choropleth Map (primary) + city markers + regional borders
//  ✓ Age Pyramid (secondary)
//  ✓ County Comparison Bar Chart
//  ✓ Summary Statistics Cards (5 KPIs)
//  ✓ Interpretation / Public Health Context panel
//  ✓ Timeseries chart (2021-2025)
//  ✓ AI Insights panel (Groq LLaMA 3.1)
//  ✓ Natural Language SQL querying
// ============================================================
import {
  Component,
  OnInit,
  OnDestroy,
  inject,
  signal,
  computed,
  effect,
  ChangeDetectionStrategy,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subject, forkJoin, of } from 'rxjs';
import { takeUntil, catchError, finalize } from 'rxjs/operators';

import { ApiService }    from '../../core/api.service';
import { ThemeService }  from '../../core/theme.service';
import {
  County, Indicator, ChoroplethData, AgePyramidData,
  ComparisonData, CountySummary, TimeseriesData,
} from '../../models/population.model';

import { ChoroplethMapComponent }  from '../../components/choropleth-map/choropleth-map.component';
import { AgePyramidComponent }     from '../../components/age-pyramid/age-pyramid.component';
import { BarChartComponent }       from '../../components/bar-chart/bar-chart.component';
import { SummaryCardsComponent }   from '../../components/summary-cards/summary-cards.component';
import { InterpretationComponent } from '../../components/interpretation/interpretation.component';
import { TimeseriesChartComponent } from '../../components/timeseries-chart/timeseries-chart.component';
import { AIPanelComponent }        from '../../components/ai-panel/ai-panel.component';

export type SexFilter = 'Total' | 'Male' | 'Female';

@Component({
  selector:   'app-dashboard',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule, FormsModule,
    ChoroplethMapComponent, AgePyramidComponent, BarChartComponent,
    SummaryCardsComponent, InterpretationComponent,
    TimeseriesChartComponent, AIPanelComponent,
  ],
  templateUrl: './dashboard.component.html',
  styleUrls:   ['./dashboard.component.scss'],
})
export class DashboardComponent implements OnInit, OnDestroy {
  private readonly api      = inject(ApiService);
  readonly theme            = inject(ThemeService);
  private readonly destroy$ = new Subject<void>();

  // ── Filter state ─────────────────────────────────────────────
  readonly selectedCounty    = signal<string>('');
  readonly selectedYear      = signal<number>(2025);
  readonly selectedSex       = signal<SexFilter>('Total');
  readonly selectedIndicator = signal<string>('total_population');

  // ── Reference data ───────────────────────────────────────────
  readonly counties   = signal<County[]>([]);
  readonly years      = signal<number[]>([]);
  readonly indicators = signal<Indicator[]>([]);

  // ── Remote data ──────────────────────────────────────────────
  readonly choroplethData = signal<ChoroplethData | null>(null);
  readonly geoJsonData    = signal<GeoJSON.FeatureCollection | null>(null);
  readonly agePyramidData = signal<AgePyramidData | null>(null);
  readonly comparisonData = signal<ComparisonData | null>(null);
  readonly countySummary  = signal<CountySummary | null>(null);
  readonly timeseriesData = signal<TimeseriesData | null>(null);

  // ── Loading flags ────────────────────────────────────────────
  readonly loadingMeta        = signal(true);
  readonly loadingChoropleth  = signal(false);
  readonly loadingPyramid     = signal(false);
  readonly loadingComparison  = signal(false);
  readonly loadingSummary     = signal(false);
  readonly loadingTimeseries  = signal(false);

  // ── UI state ─────────────────────────────────────────────────
  readonly errorMessage = signal<string | null>(null);
  readonly activeMapTab = signal<'map' | 'timeseries'>('map');

  readonly sexOptions: SexFilter[] = ['Total', 'Male', 'Female'];

  // ── Computed ─────────────────────────────────────────────────
  readonly currentIndicatorLabel = computed(() =>
    this.indicators().find(i => i.id === this.selectedIndicator())?.label ?? this.selectedIndicator()
  );

  readonly currentIndicatorUnit = computed(() =>
    this.indicators().find(i => i.id === this.selectedIndicator())?.unit ?? ''
  );

  readonly choroplethMap = computed<Record<string, number>>(() => {
    const data = this.choroplethData();
    if (!data) return {};
    return Object.fromEntries(data.entries.map(e => [e.county, e.value]));
  });

  readonly isRatioIndicator = computed(() =>
    /ratio|pct|density/.test(this.selectedIndicator())
  );

  readonly nationalStats = computed(() => {
    const entries = this.choroplethData()?.entries ?? [];
    if (!entries.length) return null;
    const vals = entries.map(e => e.value).filter(isFinite);
    const total = vals.reduce((s, v) => s + v, 0);
    const max   = Math.max(...vals);
    const topCounty = entries.find(e => e.value === max);
    return { total, max, topCounty };
  });

  constructor() {
    // Reload choropleth + comparison when year or indicator changes
    effect(
      () => { void this.selectedYear(); void this.selectedIndicator(); this.loadChoroplethAndComparison(); },
      { allowSignalWrites: true },
    );

    // Reload county detail when county or year changes
    effect(
      () => {
        const county = this.selectedCounty();
        void this.selectedYear();
        if (county) { this.loadCountyDetail(); }
        else { this.agePyramidData.set(null); this.countySummary.set(null); }
      },
      { allowSignalWrites: true },
    );
  }

  ngOnInit(): void { this.loadMetadata(); }
  ngOnDestroy(): void { this.destroy$.next(); this.destroy$.complete(); }

  // ── Data loading ─────────────────────────────────────────────

  private loadMetadata(): void {
    this.loadingMeta.set(true);
    forkJoin({
      counties:   this.api.getCounties().pipe(catchError(() => of([] as County[]))),
      years:      this.api.getYears().pipe(catchError(() => of([2025,2024,2023,2022,2021] as number[]))),
      indicators: this.api.getIndicators().pipe(catchError(() => of([] as Indicator[]))),
      geojson:    this.api.getGeojson().pipe(catchError(() => of(null as GeoJSON.FeatureCollection | null))),
    })
      .pipe(takeUntil(this.destroy$), finalize(() => this.loadingMeta.set(false)))
      .subscribe({
        next: ({ counties, years, indicators, geojson }) => {
          this.counties.set(counties);
          const sorted = [...years].sort((a, b) => b - a);
          this.years.set(sorted);
          this.indicators.set(indicators);
          if (geojson) this.geoJsonData.set(geojson);
          if (sorted.length) this.selectedYear.set(sorted[0]);
          if (indicators.length) this.selectedIndicator.set(indicators[0].id);
        },
        error: () => this.errorMessage.set('Failed to load metadata. Is the backend running on :8000?'),
      });
  }

  loadChoroplethAndComparison(): void {
    const year = this.selectedYear(); const indicator = this.selectedIndicator();
    if (!year || !indicator) return;

    this.loadingChoropleth.set(true);
    this.loadingComparison.set(true);

    this.api.getChoropleth(year, indicator)
      .pipe(takeUntil(this.destroy$), catchError(() => of(null)), finalize(() => this.loadingChoropleth.set(false)))
      .subscribe(d => this.choroplethData.set(d));

    this.api.getComparison(year, indicator, 10)
      .pipe(takeUntil(this.destroy$), catchError(() => of(null)), finalize(() => this.loadingComparison.set(false)))
      .subscribe(d => this.comparisonData.set(d));

    this.loadTimeseries();
  }

  private loadCountyDetail(): void {
    const county = this.selectedCounty(); const year = this.selectedYear();
    if (!county || !year) return;

    this.loadingPyramid.set(true); this.loadingSummary.set(true);

    this.api.getAgePyramid(county, year)
      .pipe(
        takeUntil(this.destroy$),
        catchError(() => of(null)),
        finalize(() => this.loadingPyramid.set(false)),
      )
      .subscribe(d => this.agePyramidData.set(d));

    this.api.getCountySummary(county, year)
      .pipe(
        takeUntil(this.destroy$),
        catchError(() => of(null)),
        finalize(() => this.loadingSummary.set(false)),
      )
      .subscribe(d => this.countySummary.set(d));
  }

  private loadTimeseries(): void {
    this.loadingTimeseries.set(true);
    this.api.getTimeseries(this.selectedCounty() || undefined)
      .pipe(takeUntil(this.destroy$), catchError(() => of(null)), finalize(() => this.loadingTimeseries.set(false)))
      .subscribe(d => this.timeseriesData.set(d));
  }

  // ── Filter handlers ──────────────────────────────────────────
  onCountyChange(v: string)    { this.selectedCounty.set(v); }
  onYearChange(v: string)      { this.selectedYear.set(Number(v)); }
  onSexChange(s: SexFilter)    { this.selectedSex.set(s); }
  onIndicatorChange(v: string) { this.selectedIndicator.set(v); }
  onCountyClick(name: string)  { this.selectedCounty.set(name); }
  onClearCounty()              { this.selectedCounty.set(''); }
  setMapTab(t: 'map'|'timeseries') { this.activeMapTab.set(t); }

  trackByCounty     = (_: number, c: County): string    => c.name;
  trackByYear       = (_: number, y: number): number    => y;
  trackByIndicator  = (_: number, i: Indicator): string => i.id;
}
