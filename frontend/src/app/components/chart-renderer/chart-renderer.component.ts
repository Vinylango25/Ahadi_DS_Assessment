// ============================================================
// Ahadi — Chart Renderer Component
// Renders 50+ ECharts chart types based on query intent + data
// ============================================================
import {
  Component,
  Input,
  OnChanges,
  SimpleChanges,
  inject,
  effect,
  ChangeDetectionStrategy,
  ChangeDetectorRef,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { NgxEchartsDirective, provideEchartsCore } from 'ngx-echarts';
import * as echarts from 'echarts';
import type { EChartsOption } from 'echarts';
import { ThemeService } from '../../core/theme.service';

// ── Chart type catalogue ─────────────────────────────────────
export type ChartKind =
  // Ranking / comparison
  | 'bar-horizontal'       // top/bottom N counties
  | 'bar-vertical'         // distribution across all counties
  | 'bar-gradient'         // gradient bar — single metric all counties
  | 'bar-negative'         // positive/negative values (growth rates)
  | 'bar-grouped'          // two metrics side by side
  | 'bar-stacked'          // stacked sub-groups
  | 'bar-stacked-pct'      // 100% stacked
  | 'bar-3d-like'          // bar with shadow depth effect
  | 'waterfall'            // running total / delta chart
  // Trend / time series
  | 'line'                 // single trend over years
  | 'line-multi'           // multiple counties trend
  | 'line-area'            // area chart
  | 'line-area-stacked'    // stacked area
  | 'line-step'            // step-line (YoY change)
  | 'line-smooth'          // smooth curve
  | 'line-smooth-filled'   // filled smooth
  // Part-to-whole
  | 'pie'                  // standard pie
  | 'donut'                // doughnut with centre label
  | 'donut-nested'         // nested donut (two metrics)
  | 'nightingale'          // polar rose chart
  | 'sunburst'             // sunburst drill-down
  | 'treemap'              // treemap by population size
  | 'funnel'               // funnel (sorted)
  // Statistical
  | 'scatter'              // two numeric fields
  | 'scatter-labeled'      // scatter with county labels
  | 'bubble'               // 3-variable (x, y, size)
  | 'boxplot'              // distribution box
  | 'histogram'            // frequency distribution
  | 'heatmap-calendar'     // value across years × counties grid
  | 'heatmap-matrix'       // metric × county heat grid
  // Composition / profile
  | 'radar'                // single county multi-metric spider
  | 'radar-multi'          // compare two counties spider
  | 'polar-bar'            // polar coordinate bar
  | 'gauge'                // single KPI gauge
  // Flow / hierarchy
  | 'sankey'               // flow sankey (if applicable)
  | 'graph-force'          // force-directed network
  // Geo / map
  | 'pictorial'            // pictorial bar (people icons)
  // Big number
  | 'kpi-card'             // aggregate single-value
  | 'kpi-multi'            // multiple KPI tiles
  // Parallel / multi-dimension
  | 'parallel'             // parallel coordinates
  | 'themeriver';          // theme river over time

// ── Classification engine ────────────────────────────────────
export interface ChartConfig {
  kind: ChartKind;
  title: string;
  subtitle?: string;
}

/**
 * Classify query intent + data shape → best chart type.
 * Priority rules: aggregate → time-series → RANKING → compare → all-counties → pct → scatter → other
 */
export function classifyChart(
  intent: string,
  results: Record<string, any>[],
): ChartConfig {
  if (!results?.length) return { kind: 'kpi-card', title: 'Result' };

  const i  = intent.toLowerCase();
  const keys    = Object.keys(results[0]);
  const numKeys = keys.filter(k => typeof results[0][k] === 'number' && k !== 'year');
  const hasCounty = keys.includes('county');
  const hasYear   = keys.includes('year');
  const n = results.length;

  // ── 1. Single aggregate value ──────────────────────────────
  if (n === 1 && numKeys.length <= 2 && !hasYear) {
    return { kind: 'kpi-card', title: intentTitle(intent) };
  }
  // Single county full profile → radar spider
  if (n === 1 && numKeys.length >= 3) {
    return { kind: 'radar', title: intentTitle(intent) };
  }

  // ── 2. Time-series / trend (always a line chart) ───────────
  if (hasYear && hasCounty) {
    const counties  = [...new Set(results.map(r => r['county']))];
    const yearVals  = [...new Set(results.map(r => r['year']))];
    // Only use line when we have multiple years (actual trend).
    // Single-year multi-county → comparison → handled below as bar.
    if (yearVals.length >= 2) {
      if (counties.length === 1 && n <= 10)  return { kind: 'line-area',  title: intentTitle(intent) };
      if (counties.length >= 2 && counties.length <= 6 && n <= 30) return { kind: 'line-multi', title: intentTitle(intent) };
    }
  }
  if (hasYear && !hasCounty && n <= 10) {
    const yearVals = [...new Set(results.map(r => r['year']))];
    if (yearVals.length >= 2) return { kind: 'line-smooth-filled', title: intentTitle(intent) };
  }
  // Explicit trend/timeseries keywords → line even without year column
  if (i.includes('trend') || i.includes('over years') || i.includes('2021') || i.includes('timeseries')) {
    return { kind: 'line-area', title: intentTitle(intent) };
  }

  // ── 3. Explicit ranking keywords — horizontal bar ──────────
  const isRanking =
    i.includes('top ') || i.includes('bottom ') ||
    i.includes('highest') || i.includes('lowest') ||
    i.includes('most populous') || i.includes('rank') ||
    i.includes('largest') || i.includes('smallest');
  if (isRanking && n <= 20) {
    return { kind: 'bar-horizontal', title: intentTitle(intent) };
  }

  // ── 4. Comparison: ≤5 items (bar-horizontal or pie) ────────
  // "compare X to Y", "X vs Y", "X and Y" — 2–5 counties side by side
  const isCompare =
    i.includes('compare') || i.includes(' vs ') || i.includes(' and ') ||
    i.includes('versus') || i.includes('between');
  if (isCompare || (n >= 2 && n <= 5)) {
    // 2 counties, single metric → pie for share comparison
    if (n === 2 && numKeys.length === 1) {
      return { kind: 'pie', title: intentTitle(intent) };
    }
    // 2–5 items → horizontal bar (clear, labelled, easy to read)
    if (n <= 5) {
      return { kind: 'bar-horizontal', title: intentTitle(intent) };
    }
    // 6–10 items with compare intent → horizontal bar still beats radar
    if (n <= 10) {
      return { kind: 'bar-horizontal', title: intentTitle(intent) };
    }
  }

  // ── 5. All counties (≥ 30 rows) ────────────────────────────
  if (n >= 30) {
    const pctK = numKeys.filter(k => k.startsWith('pct_'));
    if (pctK.length >= 2) return { kind: 'bar-stacked-pct', title: intentTitle(intent) };
    if (i.includes('population')) return { kind: 'treemap', title: intentTitle(intent) };
    return { kind: 'bar-gradient', title: intentTitle(intent) };
  }

  // ── 6. Percentage breakdowns ───────────────────────────────
  const pctKeys = numKeys.filter(k => k.startsWith('pct_'));
  if (pctKeys.length >= 2) return { kind: 'bar-stacked-pct', title: intentTitle(intent) };
  if (pctKeys.length === 1 && n <= 20) return { kind: 'donut', title: intentTitle(intent) };

  // ── 7. Explicitly requested scatter / correlation ──────────
  if (i.includes('scatter') || i.includes('correlat') || i.includes('against')) {
    return { kind: 'scatter-labeled', title: intentTitle(intent) };
  }

  // ── 8. Bubble — area + population ─────────────────────────
  if (numKeys.includes('county_area_km2') || (i.includes('area') && i.includes('population'))) {
    return { kind: 'bubble', title: intentTitle(intent) };
  }

  // ── 9. Sex ratio distribution → histogram ─────────────────
  if (i.includes('sex ratio') || i.includes('sex_ratio')) {
    return { kind: 'histogram', title: intentTitle(intent) };
  }

  // ── 10. Growth / change ─────────────────────────────────────
  if (i.includes('growth') || i.includes('change') || i.includes('delta')) {
    return { kind: 'bar-negative', title: intentTitle(intent) };
  }

  // ── 11. Filter results (counties that exceed threshold) → horizontal bar
  if (i.includes('where') || i.includes('exceed') || i.includes('above') || i.includes('below') || i.includes('over')) {
    return { kind: 'bar-horizontal', title: intentTitle(intent) };
  }

  // ── 12. Small N (≤ 8) single metric ordered list → funnel when ranking
  // Funnel works well for top-N rankings where the visual hierarchy matters
  if (n >= 3 && n <= 8 && numKeys.length === 1) {
    const isFunnelCandidate =
      i.includes('top ') || i.includes('highest') || i.includes('most') ||
      i.includes('largest') || i.includes('rank');
    if (isFunnelCandidate) return { kind: 'funnel', title: intentTitle(intent) };
    // Otherwise bar is clearer for small sets
    return { kind: 'bar-horizontal', title: intentTitle(intent) };
  }

  // Default
  return { kind: 'bar-horizontal', title: intentTitle(intent) };
}

function intentTitle(intent: string): string {
  return intent
    .replace(/^\/\*\s*|\s*\*\//g, '')
    .replace(/^(top|bottom|highest|lowest)\s+\d+\s+/i, '')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase())
    .trim();
}

// ── Colour palettes — distinct per chart family ───────────────
// Ranked bars: gold-to-teal gradient per bar
const PALETTE_RANK   = ['#ffd700','#ffb347','#ff8c42','#00d4aa','#00b8a9','#7c4dff','#40c4ff','#00e676','#ff5252','#ff8a65',
                         '#26c6da','#ab47bc','#66bb6a','#ef5350','#42a5f5','#ffca28'];
// Line / area: vibrant distinct colours
const PALETTE_TEAL   = ['#00d4aa','#7c4dff','#ff6b6b','#ffd700','#40c4ff','#00e676','#ff8a65','#ab47bc','#26c6da','#66bb6a'];
// Warm: pie, rose, funnel
const PALETTE_WARM   = ['#ff6b6b','#ffa94d','#ffd43b','#a9e34b','#4dabf7','#cc5de8','#f783ac','#ff8787','#63e6be','#74c0fc'];
// Cool: grouped bars, parallel
const PALETTE_COOL   = ['#4263eb','#1c7ed6','#0ca678','#f59f00','#e64980','#7950f2','#1098ad','#37b24d','#f76707','#c92a2a'];
// Vivid: scatter, bubble, heatmap
const PALETTE_VIVID  = ['#e74c3c','#3498db','#2ecc71','#f39c12','#9b59b6','#1abc9c','#e67e22','#e91e63','#00bcd4','#8bc34a',
                         '#ff5722','#607d8b','#795548','#cddc39','#03a9f4','#673ab7'];

// ── Component ────────────────────────────────────────────────
@Component({
  selector: 'app-chart-renderer',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, NgxEchartsDirective],
  providers: [provideEchartsCore({ echarts: () => import('echarts') })],
  template: `
    <div class="cr-wrap">
      @if (config && results.length) {
        <div class="cr-header">
          <span class="cr-kind-badge">{{ kindLabel(config.kind) }}</span>
          <span class="cr-title">{{ config.title }}</span>
        </div>
        <div echarts
             [options]="option"
             [autoResize]="true"
             class="cr-canvas"
             (chartInit)="onInit($event)">
        </div>
      }
    </div>
  `,
  styles: [`
    :host { display: block; width: 100%; }
    .cr-wrap  { width: 100%; background: transparent; }
    .cr-header {
      display: flex; align-items: center; gap: 8px;
      padding: 8px 0 6px 0;
    }
    .cr-kind-badge {
      font-size: 0.68rem; font-weight: 700; text-transform: uppercase;
      letter-spacing: 0.06em; padding: 2px 8px; border-radius: 20px;
      background: rgba(0,212,170,0.15); color: #00d4aa; flex-shrink: 0;
    }
    .cr-title {
      font-size: 0.82rem; font-weight: 600;
      color: var(--text-secondary);
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .cr-canvas {
      width: 100%; height: 340px;
      /* Ensure canvas text is readable in both modes */
      color-scheme: dark light;
    }
    @media (max-width: 768px) {
      .cr-canvas { height: 260px; }
      .cr-title  { font-size: 0.76rem; }
    }
    @media (max-width: 480px) {
      .cr-canvas { height: 220px; }
    }
  `],
})
export class ChartRendererComponent implements OnChanges {
  @Input() config!: ChartConfig;
  @Input() results: Record<string, any>[] = [];

  private readonly themeService = inject(ThemeService);
  private readonly cdr = inject(ChangeDetectorRef);

  option: EChartsOption = {};
  get isDark(): boolean { return this.themeService.isDark(); }

  constructor() {
    effect(() => {
      void this.themeService.isDark(); // track theme signal
      this.buildOption();
      this.cdr.markForCheck();
    });
  }

  ngOnChanges(_: SimpleChanges): void {
    this.buildOption();
    this.cdr.markForCheck();
  }

  onInit(_chart: any): void { /* chart instance available if needed */ }

  kindLabel(kind: ChartKind): string {
    const map: Partial<Record<ChartKind, string>> = {
      'bar-horizontal': 'Bar Chart', 'bar-vertical': 'Bar Chart', 'bar-gradient': 'Bar Chart',
      'bar-negative': 'Bar Chart', 'bar-grouped': 'Grouped Bar', 'bar-stacked': 'Stacked Bar',
      'bar-stacked-pct': '100% Stacked', 'waterfall': 'Waterfall',
      'line': 'Line Chart', 'line-multi': 'Multi-Line', 'line-area': 'Area Chart',
      'line-area-stacked': 'Stacked Area', 'line-step': 'Step Chart',
      'line-smooth': 'Smooth Line', 'line-smooth-filled': 'Area Chart',
      'pie': 'Pie Chart', 'donut': 'Donut Chart', 'donut-nested': 'Nested Donut',
      'nightingale': 'Rose Chart', 'sunburst': 'Sunburst', 'treemap': 'Treemap', 'funnel': 'Funnel',
      'scatter': 'Scatter Plot', 'scatter-labeled': 'Scatter Plot', 'bubble': 'Bubble Chart',
      'boxplot': 'Box Plot', 'histogram': 'Histogram', 'heatmap-matrix': 'Heatmap',
      'radar': 'Radar Chart', 'radar-multi': 'Radar Chart', 'polar-bar': 'Polar Bar', 'gauge': 'Gauge',
      'pictorial': 'Pictorial Bar', 'parallel': 'Parallel Coords',
      'kpi-card': 'KPI', 'kpi-multi': 'KPI Dashboard',
    };
    return map[kind] ?? kind;
  }

  // ── Master builder ───────────────────────────────────────
  private buildOption(): void {
    if (!this.config || !this.results.length) { this.option = {}; return; }
    // Theme-aware colors
    const dark  = this.isDark;
    const text  = dark ? 'rgba(232,234,246,0.9)'  : 'rgba(20,20,40,0.85)';
    const text2 = dark ? 'rgba(200,210,230,0.65)' : 'rgba(40,40,80,0.55)';
    const grid  = dark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)';
    const bg    = 'transparent';

    const base: EChartsOption = {
      backgroundColor: bg,
      animation: true,
      animationDuration: 800,
      animationEasing: 'cubicOut',
      tooltip: {
        backgroundColor: 'rgba(21,25,55,0.97)',
        borderColor: 'rgba(0,212,170,0.3)',
        borderWidth: 1,
        textStyle: { color: '#e8eaf6', fontSize: 12 },
      },
    };

    const k = this.config.kind;

    // ── Dispatch ──────────────────────────────────────────
    let specific: EChartsOption = {};

    if (k === 'bar-horizontal' || k === 'bar-gradient' || k === 'bar-3d-like')
      specific = this.barHorizontal(text, grid);
    else if (k === 'bar-vertical')
      specific = this.barVertical(text, grid);
    else if (k === 'bar-negative')
      specific = this.barNegative(text, grid);
    else if (k === 'bar-grouped')
      specific = this.barGrouped(text, grid);
    else if (k === 'bar-stacked')
      specific = this.barStacked(text, grid);
    else if (k === 'bar-stacked-pct')
      specific = this.barStackedPct(text, grid);
    else if (k === 'waterfall')
      specific = this.waterfall(text, grid);
    else if (k === 'line' || k === 'line-smooth')
      specific = this.lineChart(text, grid, false);
    else if (k === 'line-area' || k === 'line-smooth-filled')
      specific = this.lineChart(text, grid, true);
    else if (k === 'line-multi')
      specific = this.lineMulti(text, grid);
    else if (k === 'line-area-stacked')
      specific = this.lineAreaStacked(text, grid);
    else if (k === 'line-step')
      specific = this.lineStep(text, grid);
    else if (k === 'pie')
      specific = this.pieChart(text, false);
    else if (k === 'donut' || k === 'donut-nested')
      specific = this.pieChart(text, true);
    else if (k === 'nightingale')
      specific = this.nightingale(text);
    else if (k === 'sunburst')
      specific = this.sunburst();
    else if (k === 'treemap')
      specific = this.treemap(text);
    else if (k === 'funnel')
      specific = this.funnel(text);
    else if (k === 'scatter' || k === 'scatter-labeled')
      specific = this.scatter(text, k === 'scatter-labeled');
    else if (k === 'bubble')
      specific = this.bubble(text);
    else if (k === 'histogram')
      specific = this.histogram(text, grid);
    else if (k === 'heatmap-matrix')
      specific = this.heatmapMatrix(text);
    else if (k === 'radar' || k === 'radar-multi')
      specific = this.radar(text);
    else if (k === 'polar-bar')
      specific = this.polarBar(text);
    else if (k === 'gauge')
      specific = this.gauge();
    else if (k === 'parallel')
      specific = this.parallel(text);
    else if (k === 'pictorial')
      specific = this.pictorial(text);
    else if (k === 'kpi-card' || k === 'kpi-multi')
      specific = this.kpiOption(text);
    else
      specific = this.barHorizontal(text, grid); // safe fallback

    this.option = { ...base, ...specific };
  }

  // ── Helpers ────────────────────────────────────────────
  private keys()    { return Object.keys(this.results[0]); }
  private numKeys() { return this.keys().filter(k => typeof this.results[0][k] === 'number' && k !== 'year'); }
  private labelKey(){ return this.keys().find(k => k === 'county') ?? this.keys()[0]; }
  private valKey()  {
    const nk = this.numKeys();
    // prefer primary data field over dependency_ratio-like fields when multiple exist
    return nk[0] ?? null;
  }
  private labels()  { return this.results.map(r => String(r[this.labelKey()] ?? '')); }
  private values()  { return this.results.map(r => r[this.valKey()!] as number); }
  private fmt(n: number): string {
    if (!isFinite(n)) return '—';
    if (Math.abs(n) >= 1e6)  return (n/1e6).toFixed(1)+'M';
    if (Math.abs(n) >= 1e3)  return (n/1e3).toFixed(0)+'K';
    return n.toLocaleString('en-US', { maximumFractionDigits: 2 });
  }
  private fmtHeader(k: string): string {
    return k.replace(/_/g,' ').replace(/\b\w/g, c => c.toUpperCase());
  }
  private gradient(c1: string, c2: string, vert = false): any {
    return { type: 'linear', x: 0, y: vert ? 0 : 0, x2: vert ? 0 : 1, y2: vert ? 1 : 0,
             colorStops: [{ offset: 0, color: c1 }, { offset: 1, color: c2 }] };
  }

  // ── Chart builders ─────────────────────────────────────

  private barHorizontal(text: string, grid: string): EChartsOption {
    const labs = this.labels();
    const vals = this.values();
    const maxV = Math.max(...vals);
    const vk   = this.valKey()!;
    const data = vals.map((v, i) => ({
      value: v,
      itemStyle: {
        color: this.gradient(PALETTE_TEAL[i % PALETTE_TEAL.length], '#00d4aa'),
        borderRadius: [0, 6, 6, 0],
      },
    }));
    return {
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' },
        formatter: (p: any) => {
          const row = Array.isArray(p) ? p[0] : p;
          return `<b>${row.name}</b><br/>${this.fmtHeader(vk)}: <b style="color:#00d4aa">${this.fmt(row.value)}</b>`;
        },
      },
      grid: { left: 8, right: 60, top: 8, bottom: 8, containLabel: true },
      xAxis: { type: 'value', splitLine: { lineStyle: { color: grid } },
               axisLabel: { color: text, fontSize: 11, formatter: (v: number) => this.fmt(v) },
               max: maxV * 1.12 },
      yAxis: { type: 'category', data: labs, inverse: false,
               axisLabel: { color: text, fontSize: 11, width: 100, overflow: 'truncate' },
               axisLine: { show: false }, axisTick: { show: false } },
      series: [{ type: 'bar', data, barMaxWidth: 32,
        label: { show: true, position: 'right', color: text, fontSize: 10,
                 formatter: (p: any) => this.fmt(p.value) } }],
    };
  }

  private barVertical(text: string, grid: string): EChartsOption {
    const labs = this.labels();
    const vals = this.values();
    const vk   = this.valKey()!;
    return {
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' },
        formatter: (p: any) => {
          const r = Array.isArray(p) ? p[0] : p;
          return `<b>${r.name}</b><br/>${this.fmtHeader(vk)}: <b style="color:#00d4aa">${this.fmt(r.value)}</b>`;
        }
      },
      grid: { left: 10, right: 10, top: 20, bottom: 60, containLabel: true },
      xAxis: { type: 'category', data: labs,
               axisLabel: { color: text, fontSize: 9, rotate: 45, interval: 0 },
               axisTick: { show: false }, axisLine: { show: false } },
      yAxis: { type: 'value', splitLine: { lineStyle: { color: grid } },
               axisLabel: { color: text, fontSize: 10, formatter: (v: number) => this.fmt(v) } },
      series: [{ type: 'bar', data: vals.map((v, i) => ({
        value: v,
        itemStyle: {
          color: this.gradient(PALETTE_COOL[i % PALETTE_COOL.length], PALETTE_TEAL[i % PALETTE_TEAL.length], true),
          borderRadius: [4, 4, 0, 0],
        },
      })), barMaxWidth: 24 }],
    };
  }

  private barNegative(text: string, grid: string): EChartsOption {
    const labs  = this.labels();
    const vals  = this.values();
    const vk    = this.valKey()!;
    return {
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' },
        formatter: (p: any) => {
          const r = Array.isArray(p) ? p[0] : p;
          return `<b>${r.name}</b><br/>${this.fmtHeader(vk)}: <b>${this.fmt(r.value)}</b>`;
        }
      },
      grid: { left: 10, right: 60, top: 8, bottom: 8, containLabel: true },
      xAxis: { type: 'value', splitLine: { lineStyle: { color: grid } },
               axisLabel: { color: text, fontSize: 10, formatter: (v: number) => this.fmt(v) } },
      yAxis: { type: 'category', data: labs,
               axisLabel: { color: text, fontSize: 10 },
               axisLine: { show: false }, axisTick: { show: false } },
      series: [{ type: 'bar', data: vals.map(v => ({
        value: v,
        itemStyle: {
          color: v >= 0 ? '#00d4aa' : '#ff5252',
          borderRadius: (v >= 0 ? [0, 6, 6, 0] : [6, 0, 0, 6]) as number[],
        },
        label: {
          show: true,
          position: (v >= 0 ? 'right' : 'insideLeft') as any,
          color: text,
          fontSize: 10,
          formatter: () => this.fmt(v),
        },
      })), barMaxWidth: 28 }],
    };
  }

  private barGrouped(text: string, grid: string): EChartsOption {
    const nk   = this.numKeys().slice(0, 4);
    const labs  = this.labels();
    return {
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
      legend: { textStyle: { color: text }, top: 4, itemHeight: 10 },
      grid: { left: 10, right: 10, top: 36, bottom: 8, containLabel: true },
      xAxis: { type: 'category', data: labs,
               axisLabel: { color: text, fontSize: 10, rotate: 30, interval: 0 },
               axisTick: { show: false } },
      yAxis: { type: 'value', splitLine: { lineStyle: { color: grid } },
               axisLabel: { color: text, fontSize: 10, formatter: (v: number) => this.fmt(v) } },
      series: nk.map((k, i) => ({
        name: this.fmtHeader(k),
        type: 'bar' as const,
        data: this.results.map(r => r[k]),
        barMaxWidth: 20,
        itemStyle: { color: PALETTE_TEAL[i], borderRadius: [3, 3, 0, 0] },
      })),
    };
  }

  private barStacked(text: string, grid: string): EChartsOption {
    const nk   = this.numKeys().slice(0, 5);
    const labs  = this.labels();
    return {
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
      legend: { textStyle: { color: text }, top: 4, itemHeight: 10 },
      grid: { left: 10, right: 10, top: 36, bottom: 8, containLabel: true },
      xAxis: { type: 'category', data: labs,
               axisLabel: { color: text, fontSize: 10, rotate: 30 }, axisTick: { show: false } },
      yAxis: { type: 'value', splitLine: { lineStyle: { color: grid } },
               axisLabel: { color: text, fontSize: 10, formatter: (v: number) => this.fmt(v) } },
      series: nk.map((k, i) => ({
        name: this.fmtHeader(k), type: 'bar' as const, stack: 'total',
        data: this.results.map(r => r[k]),
        itemStyle: { color: PALETTE_TEAL[i] },
      })),
    };
  }

  private barStackedPct(text: string, grid: string): EChartsOption {
    const nk  = this.numKeys().filter(k => k.startsWith('pct_')).slice(0, 4);
    const labs = this.labels();
    return {
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
      legend: { textStyle: { color: text }, top: 4, itemHeight: 10 },
      grid: { left: 10, right: 10, top: 36, bottom: 8, containLabel: true },
      xAxis: { type: 'category', data: labs,
               axisLabel: { color: text, fontSize: 10, rotate: 30 }, axisTick: { show: false } },
      yAxis: { type: 'value', max: 100, splitLine: { lineStyle: { color: grid } },
               axisLabel: { color: text, fontSize: 10, formatter: (v: number) => v + '%' } },
      series: nk.map((k, i) => ({
        name: this.fmtHeader(k), type: 'bar' as const, stack: 'pct',
        data: this.results.map(r => r[k]),
        itemStyle: { color: PALETTE_TEAL[i] },
        label: { show: true, position: 'inside', formatter: (p: any) => p.value?.toFixed(1) + '%', fontSize: 9 },
      })),
    };
  }

  private waterfall(text: string, grid: string): EChartsOption {
    const vals  = this.values();
    const labs  = this.labels();
    const placeholders: number[] = [];
    let cumulative = 0;
    const data = vals.map(v => {
      placeholders.push(cumulative);
      cumulative += v;
      return v;
    });
    return {
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
      grid: { left: 10, right: 10, top: 8, bottom: 8, containLabel: true },
      xAxis: { type: 'category', data: labs,
               axisLabel: { color: text, fontSize: 10, rotate: 30 }, axisTick: { show: false } },
      yAxis: { type: 'value', splitLine: { lineStyle: { color: grid } },
               axisLabel: { color: text, fontSize: 10, formatter: (v: number) => this.fmt(v) } },
      series: [
        { type: 'bar', stack: 'wf', itemStyle: { color: 'transparent', borderColor: 'transparent' }, data: placeholders, barMaxWidth: 32, silent: true },
        { type: 'bar', stack: 'wf', data: data.map(v => ({
          value: v, itemStyle: { color: v >= 0 ? '#00d4aa' : '#ff5252', borderRadius: [3, 3, 0, 0] }
        })), barMaxWidth: 32 },
      ],
    };
  }

  private lineChart(text: string, grid: string, filled: boolean): EChartsOption {
    const vk  = this.valKey()!;
    const xk  = this.keys().find(k => k === 'year') ?? this.labelKey();
    const labs = this.results.map(r => String(r[xk]));
    const vals = this.results.map(r => r[vk] as number);
    return {
      tooltip: { trigger: 'axis',
        formatter: (p: any) => {
          const r = Array.isArray(p) ? p[0] : p;
          return `<b>${r.axisValue}</b><br/>${this.fmtHeader(vk)}: <b style="color:#00d4aa">${this.fmt(r.value)}</b>`;
        }
      },
      grid: { left: 10, right: 20, top: 20, bottom: 8, containLabel: true },
      xAxis: { type: 'category', data: labs, boundaryGap: false,
               axisLabel: { color: text, fontSize: 11 },
               axisLine: { lineStyle: { color: grid } }, axisTick: { show: false } },
      yAxis: { type: 'value', splitLine: { lineStyle: { color: grid } },
               axisLabel: { color: text, fontSize: 10, formatter: (v: number) => this.fmt(v) } },
      series: [{
        type: 'line', data: vals, smooth: true,
        symbol: 'circle', symbolSize: 7,
        lineStyle: { color: '#00d4aa', width: 3 },
        itemStyle: { color: '#00d4aa', borderColor: this.isDark ? '#151937' : '#fff', borderWidth: 2 },
        areaStyle: filled ? { color: this.gradient('rgba(0,212,170,0.35)', 'rgba(0,212,170,0.02)', true) } : undefined,
      }],
    };
  }

  private lineMulti(text: string, grid: string): EChartsOption {
    const counties = [...new Set(this.results.map(r => r['county']))];
    const years    = [...new Set(this.results.map(r => r['year']))].sort();
    const vk       = this.numKeys()[0];
    return {
      tooltip: { trigger: 'axis' },
      legend: { data: counties.map(String), textStyle: { color: text }, top: 4, itemHeight: 10 },
      grid: { left: 10, right: 20, top: 36, bottom: 8, containLabel: true },
      xAxis: { type: 'category', data: years.map(String), boundaryGap: false,
               axisLabel: { color: text, fontSize: 11 }, axisTick: { show: false } },
      yAxis: { type: 'value', splitLine: { lineStyle: { color: grid } },
               axisLabel: { color: text, fontSize: 10, formatter: (v: number) => this.fmt(v) } },
      series: counties.map((c, i) => ({
        name: String(c),
        type: 'line' as const,
        data: years.map(y => {
          const row = this.results.find(r => r['county'] === c && r['year'] === y);
          return row ? (row[vk] as number) : null;
        }),
        smooth: true, symbol: 'circle', symbolSize: 6,
        lineStyle: { color: PALETTE_TEAL[i % PALETTE_TEAL.length], width: 2 },
        itemStyle: { color: PALETTE_TEAL[i % PALETTE_TEAL.length] },
      })),
    };
  }

  private lineAreaStacked(text: string, grid: string): EChartsOption {
    const nk   = this.numKeys().slice(0, 4);
    const labs  = this.labels();
    return {
      tooltip: { trigger: 'axis' },
      legend: { textStyle: { color: text }, top: 4, itemHeight: 10 },
      grid: { left: 10, right: 20, top: 36, bottom: 8, containLabel: true },
      xAxis: { type: 'category', data: labs, boundaryGap: false,
               axisLabel: { color: text, fontSize: 10 }, axisTick: { show: false } },
      yAxis: { type: 'value', splitLine: { lineStyle: { color: grid } },
               axisLabel: { color: text, fontSize: 10, formatter: (v: number) => this.fmt(v) } },
      series: nk.map((k, i) => ({
        name: this.fmtHeader(k), type: 'line' as const, stack: 'total', smooth: true,
        data: this.results.map(r => r[k]),
        areaStyle: { color: PALETTE_TEAL[i] + '55' },
        lineStyle: { color: PALETTE_TEAL[i] },
        itemStyle: { color: PALETTE_TEAL[i] },
      })),
    };
  }

  private lineStep(text: string, grid: string): EChartsOption {
    const vk  = this.valKey()!;
    const xk  = this.keys().find(k => k === 'year') ?? this.labelKey();
    const labs = this.results.map(r => String(r[xk]));
    const vals = this.results.map(r => r[vk] as number);
    return {
      tooltip: { trigger: 'axis' },
      grid: { left: 10, right: 20, top: 8, bottom: 8, containLabel: true },
      xAxis: { type: 'category', data: labs,
               axisLabel: { color: text, fontSize: 11 }, axisTick: { show: false } },
      yAxis: { type: 'value', splitLine: { lineStyle: { color: grid } },
               axisLabel: { color: text, fontSize: 10, formatter: (v: number) => this.fmt(v) } },
      series: [{ type: 'line', step: 'middle', data: vals,
                 lineStyle: { color: '#7c4dff', width: 2 },
                 itemStyle: { color: '#7c4dff' },
                 areaStyle: { color: 'rgba(124,77,255,0.15)' } }],
    };
  }

  private pieChart(text: string, donut: boolean): EChartsOption {
    const lk  = this.labelKey();
    const vk  = this.valKey()!;
    const data = this.results.slice(0, 20).map((r, i) => ({
      name: String(r[lk] ?? ''),
      value: r[vk] as number,
      itemStyle: { color: PALETTE_TEAL[i % PALETTE_TEAL.length] },
    }));
    const total = data.reduce((s, d) => s + (d.value || 0), 0);

    return {
      tooltip: {
        trigger: 'item',
        backgroundColor: this.isDark ? 'rgba(21,25,55,0.97)' : 'rgba(255,255,255,0.97)',
        borderColor: 'rgba(0,212,170,0.3)',
        borderWidth: 1,
        textStyle: { color: this.isDark ? '#e8eaf6' : '#111', fontSize: 12 },
        formatter: (p: any) =>
          `<b>${p.name}</b><br/>${this.fmtHeader(vk)}: <b style="color:#00d4aa">${this.fmt(p.value)}</b><br/>Share: <b>${p.percent?.toFixed(1)}%</b>`,
      },
      legend: {
        orient: 'vertical', right: 4, top: 'center',
        textStyle: { color: text, fontSize: 10 }, itemHeight: 10,
        formatter: (name: string) => {
          const d = data.find(x => x.name === name);
          const pct = d && total > 0 ? ((d.value / total) * 100).toFixed(1) : '0';
          return `${name}  (${pct}%)`;
        },
      },
      series: [{
        type: 'pie',
        radius: donut ? ['40%', '65%'] : '65%',
        center: ['38%', '50%'],
        data,
        label: {
          show: true,
          color: text,
          fontSize: 10,
          fontWeight: 600,
          // Show: "County Name\n1.23M (45.6%)"
          formatter: (p: any) =>
            `${p.name}\n${this.fmt(p.value)} (${p.percent?.toFixed(1)}%)`,
        },
        labelLine: { length: 12, length2: 10, smooth: true },
        emphasis: {
          scale: true, scaleSize: 8,
          itemStyle: { shadowBlur: 12, shadowColor: 'rgba(0,0,0,0.3)' },
          label: { fontSize: 11, fontWeight: 700 },
        },
        ...(donut ? {
          graphic: [{
            type: 'text',
            left: '33%', top: '44%',
            style: { text: this.fmt(total), fill: '#00d4aa', fontSize: 16, fontWeight: 700, textAlign: 'center' },
          },
          {
            type: 'text',
            left: '33%', top: '58%',
            style: { text: 'Total', fill: text, fontSize: 10, textAlign: 'center' },
          }] as any,
        } : {}),
      }],
    };
  }

  private nightingale(text: string): EChartsOption {
    const lk  = this.labelKey();
    const vk  = this.valKey()!;
    const data = this.results.slice(0, 16).map((r, i) => ({
      name: String(r[lk] ?? ''),
      value: r[vk] as number,
      itemStyle: { color: PALETTE_WARM[i % PALETTE_WARM.length] },
    }));
    const total = data.reduce((s, d) => s + (d.value || 0), 0);
    return {
      tooltip: {
        trigger: 'item',
        backgroundColor: this.isDark ? 'rgba(21,25,55,0.97)' : 'rgba(255,255,255,0.97)',
        borderColor: 'rgba(0,212,170,0.3)', borderWidth: 1,
        textStyle: { color: this.isDark ? '#e8eaf6' : '#111', fontSize: 12 },
        formatter: (p: any) =>
          `<b>${p.name}</b><br/>${this.fmt(p.value)}<br/><b>${p.percent?.toFixed(1)}%</b>`,
      },
      legend: {
        bottom: 0, textStyle: { color: text, fontSize: 9 }, itemHeight: 8,
        formatter: (name: string) => {
          const d = data.find(x => x.name === name);
          const pct = d && total > 0 ? ((d.value / total) * 100).toFixed(1) : '0';
          return `${name}  ${pct}%`;
        },
      },
      series: [{
        type: 'pie', roseType: 'area', radius: ['15%', '65%'], center: ['50%', '46%'],
        data,
        label: {
          show: true, color: text, fontSize: 9,
          formatter: (p: any) => `${p.name}\n${p.percent?.toFixed(1)}%`,
        },
        labelLine: { length: 8, length2: 6 },
        emphasis: { scale: true, scaleSize: 6 },
      }],
    };
  }

  private sunburst(): EChartsOption {
    const lk  = this.labelKey();
    const vk  = this.valKey()!;
    const children = this.results.slice(0, 20).map((r, i) => ({
      name: String(r[lk] ?? ''),
      value: r[vk] as number,
      itemStyle: { color: PALETTE_TEAL[i % PALETTE_TEAL.length] + 'cc' },
    }));
    return {
      tooltip: { formatter: (p: any) => `<b>${p.name}</b>: ${this.fmt(p.value)}` },
      series: [{
        type: 'sunburst', radius: ['20%', '85%'], center: ['50%', '50%'],
        data: [{ name: 'Counties', children, itemStyle: { color: '#00d4aa33' } }],
        label: { fontSize: 9, rotate: 'tangential' as any },
        emphasis: { focus: 'ancestor' as any },
      }],
    };
  }

  private treemap(text: string): EChartsOption {
    const lk   = this.labelKey();
    const vk   = this.valKey()!;
    const data  = this.results.slice(0, 47).map((r, i) => ({
      name: String(r[lk] ?? ''),
      value: r[vk] as number,
      itemStyle: { color: PALETTE_TEAL[i % PALETTE_TEAL.length] },
    }));
    return {
      tooltip: { formatter: (p: any) => `<b>${p.name}</b>: ${this.fmt(p.value)}` },
      series: [{
        type: 'treemap',
        data,
        label: { color: '#fff', fontSize: 10, fontWeight: 600 },
        breadcrumb: { show: false },
        levels: [{ itemStyle: { borderWidth: 2, borderColor: 'rgba(0,0,0,0.2)', gapWidth: 2 } }],
      }],
    };
  }

  private funnel(text: string): EChartsOption {
    const lk   = this.labelKey();
    const vk   = this.valKey()!;
    const sorted = [...this.results].sort((a, b) => (b[vk] as number) - (a[vk] as number));
    const data  = sorted.slice(0, 12).map((r, i) => ({
      name: String(r[lk] ?? ''),
      value: r[vk] as number,
      itemStyle: { color: PALETTE_TEAL[i % PALETTE_TEAL.length] },
    }));
    return {
      tooltip: { trigger: 'item', formatter: (p: any) => `<b>${p.name}</b>: ${this.fmt(p.value)}` },
      series: [{
        type: 'funnel', left: '10%', right: '10%', top: '4%', bottom: '8%',
        sort: 'descending', gap: 2,
        label: { color: text, fontSize: 10, formatter: (p: any) => `${p.name}\n${this.fmt(p.value)}` },
        data,
      }],
    };
  }

  private scatter(text: string, labeled: boolean): EChartsOption {
    const nk   = this.numKeys();
    const xk   = nk[0] ?? 'total_population';
    const yk   = nk[1] ?? nk[0];
    const lk   = this.labelKey();
    const data  = this.results.map(r => ({
      value: [r[xk] as number, r[yk] as number],
      name: String(r[lk] ?? ''),
    }));
    return {
      tooltip: {
        formatter: (p: any) => `<b>${p.name ?? ''}</b><br/>${this.fmtHeader(xk)}: ${this.fmt(p.value[0])}<br/>${this.fmtHeader(yk)}: ${this.fmt(p.value[1])}`,
      },
      grid: { left: 10, right: 20, top: 20, bottom: 8, containLabel: true },
      xAxis: { type: 'value', name: this.fmtHeader(xk), nameTextStyle: { color: text, fontSize: 10 },
               axisLabel: { color: text, fontSize: 9, formatter: (v: number) => this.fmt(v) },
               splitLine: { lineStyle: { color: 'rgba(255,255,255,0.05)' } } },
      yAxis: { type: 'value', name: this.fmtHeader(yk), nameTextStyle: { color: text, fontSize: 10 },
               axisLabel: { color: text, fontSize: 9, formatter: (v: number) => this.fmt(v) },
               splitLine: { lineStyle: { color: 'rgba(255,255,255,0.05)' } } },
      series: [{
        type: 'scatter', data,
        symbolSize: 10,
        itemStyle: { color: '#00d4aa', opacity: 0.85 },
        label: labeled ? { show: true, formatter: (p: any) => p.name, fontSize: 8, color: text, position: 'top' } : { show: false },
      }],
    };
  }

  private bubble(text: string): EChartsOption {
    const nk   = this.numKeys();
    const xk   = nk[0] ?? 'total_population';
    const yk   = nk[1] ?? 'dependency_ratio';
    const sk   = nk[2] ?? 'county_area_km2';
    const lk   = this.labelKey();
    const sVals = this.results.map(r => r[sk] as number);
    const maxS  = Math.max(...sVals.filter(isFinite));
    const data  = this.results.map((r, i) => ({
      value: [r[xk] as number, r[yk] as number, r[sk] as number],
      name: String(r[lk] ?? ''),
      symbolSize: Math.max(8, ((r[sk] as number) / maxS) * 50),
      itemStyle: { color: PALETTE_TEAL[i % PALETTE_TEAL.length], opacity: 0.75 },
    }));
    return {
      tooltip: {
        formatter: (p: any) => `<b>${p.name}</b><br/>${this.fmtHeader(xk)}: ${this.fmt(p.value[0])}<br/>${this.fmtHeader(yk)}: ${this.fmt(p.value[1])}<br/>${this.fmtHeader(sk)}: ${this.fmt(p.value[2])}`,
      },
      grid: { left: 10, right: 20, top: 20, bottom: 8, containLabel: true },
      xAxis: { type: 'value', name: this.fmtHeader(xk), nameTextStyle: { color: text, fontSize: 10 },
               axisLabel: { color: text, fontSize: 9, formatter: (v: number) => this.fmt(v) },
               splitLine: { lineStyle: { color: 'rgba(255,255,255,0.05)' } } },
      yAxis: { type: 'value', name: this.fmtHeader(yk), nameTextStyle: { color: text, fontSize: 10 },
               axisLabel: { color: text, fontSize: 9, formatter: (v: number) => this.fmt(v) },
               splitLine: { lineStyle: { color: 'rgba(255,255,255,0.05)' } } },
      series: [{ type: 'scatter', data }],
    };
  }

  private histogram(text: string, grid: string): EChartsOption {
    const vk   = this.valKey()!;
    const vals  = this.results.map(r => r[vk] as number).filter(isFinite);
    const min   = Math.min(...vals), max = Math.max(...vals);
    const bins  = 10;
    const width = (max - min) / bins;
    const counts: number[] = Array(bins).fill(0);
    const binLabels: string[] = [];
    for (let i = 0; i < bins; i++) {
      const lo = min + i * width, hi = lo + width;
      binLabels.push(`${lo.toFixed(1)}–${hi.toFixed(1)}`);
      vals.forEach(v => { if (v >= lo && v < hi + (i === bins - 1 ? 0.001 : 0)) counts[i]++; });
    }
    return {
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' },
        formatter: (p: any) => `Range: ${(Array.isArray(p) ? p[0] : p).axisValue}<br/>Count: ${(Array.isArray(p) ? p[0] : p).value}`
      },
      grid: { left: 10, right: 10, top: 8, bottom: 8, containLabel: true },
      xAxis: { type: 'category', data: binLabels,
               axisLabel: { color: text, fontSize: 9, rotate: 30 }, axisTick: { show: false } },
      yAxis: { type: 'value', splitLine: { lineStyle: { color: grid } },
               axisLabel: { color: text, fontSize: 10 }, name: 'Count', nameTextStyle: { color: text, fontSize: 9 } },
      series: [{ type: 'bar', data: counts.map((c, i) => ({
        value: c,
        itemStyle: { color: PALETTE_TEAL[i % PALETTE_TEAL.length], borderRadius: [3, 3, 0, 0] },
      })), barWidth: '90%' }],
    };
  }

  private heatmapMatrix(text: string): EChartsOption {
    const lk    = this.labelKey();
    const nk    = this.numKeys();
    const counties = this.results.map(r => String(r[lk] ?? ''));
    const fields   = nk.slice(0, 6);
    const data: [number, number, number][] = [];
    this.results.forEach((r, ci) => {
      fields.forEach((f, fi) => { data.push([fi, ci, r[f] as number]); });
    });
    const vals = data.map(d => d[2]).filter(isFinite);
    return {
      tooltip: {
        formatter: (p: any) => `<b>${counties[p.value[1]]}</b><br/>${this.fmtHeader(fields[p.value[0]])}: ${this.fmt(p.value[2])}`,
      },
      grid: { left: 10, right: 10, top: 8, bottom: 8, containLabel: true },
      xAxis: { type: 'category', data: fields.map(f => this.fmtHeader(f)),
               axisLabel: { color: text, fontSize: 9, rotate: 30 }, axisTick: { show: false } },
      yAxis: { type: 'category', data: counties,
               axisLabel: { color: text, fontSize: 9 }, axisTick: { show: false } },
      visualMap: { min: Math.min(...vals), max: Math.max(...vals), calculable: true,
                   orient: 'horizontal', left: 'center', bottom: 0,
                   inRange: { color: ['#0a1628','#00d4aa'] }, textStyle: { color: text, fontSize: 9 } },
      series: [{ type: 'heatmap', data, label: { show: false } }],
    };
  }

  private radar(text: string): EChartsOption {
    const nk      = this.numKeys().slice(0, 8);
    const lk      = this.labelKey();
    const vals    = nk.map(k => Math.max(...this.results.map(r => r[k] as number).filter(isFinite)));
    const indicators = nk.map((k, i) => ({ name: this.fmtHeader(k), max: vals[i] * 1.1 }));
    const series = this.results.slice(0, 3).map((r, i) => ({
      name: String(r[lk] ?? ''),
      value: nk.map(k => r[k] as number),
      lineStyle: { color: PALETTE_TEAL[i] },
      areaStyle: { color: PALETTE_TEAL[i] + '33' },
      itemStyle: { color: PALETTE_TEAL[i] },
    }));
    return {
      tooltip: { trigger: 'item' },
      legend: { textStyle: { color: text, fontSize: 9 }, top: 0, itemHeight: 9 },
      radar: { indicator: indicators, radius: '65%',
               axisName: { color: text, fontSize: 9 },
               splitLine: { lineStyle: { color: 'rgba(255,255,255,0.1)' } },
               splitArea: { areaStyle: { color: ['rgba(255,255,255,0.02)', 'transparent'] } } },
      series: [{ type: 'radar', data: series }],
    };
  }

  private polarBar(text: string): EChartsOption {
    const labs  = this.labels().slice(0, 16);
    const vals  = this.values().slice(0, 16);
    return {
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
      polar: { radius: ['18%', '80%'] },
      angleAxis: { type: 'category', data: labs,
                   axisLabel: { color: text, fontSize: 8, rotate: 30 } },
      radiusAxis: { axisLabel: { color: text, fontSize: 8, formatter: (v: number) => this.fmt(v) } },
      series: [{ type: 'bar', data: vals.map((v, i) => ({
        value: v, itemStyle: { color: PALETTE_TEAL[i % PALETTE_TEAL.length] }
      })), coordinateSystem: 'polar', barMaxWidth: 20 }],
    };
  }

  private gauge(): EChartsOption {
    const vk    = this.valKey()!;
    const val   = this.results[0]?.[vk] as number ?? 0;
    const maxV  = 200; // generic max — sex ratio, dep ratio, etc.
    return {
      series: [{
        type: 'gauge',
        startAngle: 200, endAngle: -20,
        min: 0, max: maxV,
        radius: '85%', center: ['50%', '58%'],
        axisLine: { lineStyle: { width: 18,
          color: [[0.3, '#67e0e3'], [0.7, '#37a2da'], [1, '#fd666d']] } },
        pointer: { itemStyle: { color: 'auto' }, length: '55%', width: 5 },
        axisTick: { distance: -22, length: 6, lineStyle: { color: '#fff', width: 1 } },
        splitLine: { distance: -28, length: 14, lineStyle: { color: '#fff', width: 2 } },
        axisLabel: { color: 'inherit', distance: 30, fontSize: 10 },
        detail: { valueAnimation: true, fontSize: 22, fontWeight: 700,
                  color: '#00d4aa', formatter: (v: number) => this.fmt(v),
                  offsetCenter: [0, '30%'] },
        title: { offsetCenter: [0, '55%'], color: '#999', fontSize: 11 },
        data: [{ value: val, name: this.fmtHeader(vk) }],
      }],
    };
  }

  private parallel(text: string): EChartsOption {
    const nk   = this.numKeys().slice(0, 6);
    const lk   = this.labelKey();
    const dims = nk.map((k, i) => ({
      dim: i, name: this.fmtHeader(k),
      nameTextStyle: { color: text, fontSize: 9 },
      axisLabel: { color: text, fontSize: 8 },
    }));
    const data = this.results.slice(0, 20).map((r, i) => ({
      value: nk.map(k => r[k] as number),
      lineStyle: { color: PALETTE_TEAL[i % PALETTE_TEAL.length], opacity: 0.75, width: 1.5 },
    }));
    return {
      tooltip: { trigger: 'item' },
      parallelAxis: dims,
      series: [{ type: 'parallel', data, lineStyle: { width: 1.5, opacity: 0.7 } }],
    };
  }

  private pictorial(text: string): EChartsOption {
    const labs  = this.labels().slice(0, 15);
    const vals  = this.values().slice(0, 15);
    return {
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
      grid: { left: 10, right: 60, top: 8, bottom: 8, containLabel: true },
      xAxis: { type: 'value', axisLabel: { color: text, fontSize: 9, formatter: (v: number) => this.fmt(v) } },
      yAxis: { type: 'category', data: labs, axisLabel: { color: text, fontSize: 10 }, axisTick: { show: false } },
      series: [{
        type: 'pictorialBar',
        symbol: 'roundRect',
        symbolRepeat: true,
        symbolSize: [10, 14],
        symbolMargin: 2,
        data: vals.map((v, i) => ({ value: v, itemStyle: { color: PALETTE_WARM[i % PALETTE_WARM.length] } })),
        label: { show: true, position: 'right', color: text, fontSize: 10,
                 formatter: (p: any) => this.fmt(p.value) },
      }],
    };
  }

  private kpiOption(text: string): EChartsOption {
    // Render as a centred big-number stat using ECharts graphic layer
    const vk  = this.valKey()!;
    const val = this.results[0]?.[vk] as number ?? 0;
    return {
      graphic: {
        elements: [
          {
            type: 'text',
            left: 'center',
            top: '36%',
            style: {
              text: this.fmt(val),
              fill: '#00d4aa',
              fontSize: 38,
              fontWeight: 'bold',
              textAlign: 'center',
            },
          } as any,
          {
            type: 'text',
            left: 'center',
            top: '62%',
            style: {
              text: this.fmtHeader(vk),
              fill: text,
              fontSize: 13,
              textAlign: 'center',
            },
          } as any,
        ],
      },
    };
  }
}
