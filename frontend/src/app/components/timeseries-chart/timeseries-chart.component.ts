// ============================================================
// Ahadi — Timeseries Chart Component
// Animated area chart: Kenya total population 2021–2025
// ============================================================
import {
  Component,
  Input,
  OnChanges,
  SimpleChanges,
  inject,
  ChangeDetectionStrategy,
  ChangeDetectorRef,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { NgxEchartsDirective, provideEchartsCore } from 'ngx-echarts';
import * as echarts from 'echarts';
import type { EChartsOption } from 'echarts';
import { TimeseriesData } from '../../models/population.model';
import { ThemeService } from '../../core/theme.service';

@Component({
  selector: 'app-timeseries-chart',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, NgxEchartsDirective],
  providers: [provideEchartsCore({ echarts: () => import('echarts') })],
  template: `
    <div class="ts-container">
      <div echarts
           [options]="chartOption"
           [autoResize]="true"
           class="ts-chart"
           *ngIf="hasData; else empty">
      </div>
      <ng-template #empty>
        <div class="empty-state">
          <span class="material-symbols-rounded">show_chart</span>
          <p>No timeseries data available</p>
        </div>
      </ng-template>
    </div>
  `,
  styles: [`
    .ts-container { width: 100%; height: 100%; min-height: 220px; }
    .ts-chart { width: 100%; height: 100%; min-height: 220px; }
    .empty-state {
      display: flex; flex-direction: column; align-items: center;
      justify-content: center; height: 220px; gap: 12px;
      color: var(--text-tertiary); font-size: 0.85rem;
    }
    .empty-state .material-symbols-rounded { font-size: 2rem; }
  `],
})
export class TimeseriesChartComponent implements OnChanges {
  @Input() data: TimeseriesData | null = null;
  @Input() county = '';
  @Input() indicator = 'total_population';

  readonly theme = inject(ThemeService);
  private readonly cdr = inject(ChangeDetectorRef);

  chartOption: EChartsOption = {};
  hasData = false;

  ngOnChanges(_: SimpleChanges): void {
    this.buildChart();
    this.cdr.markForCheck();
  }

  private buildChart(): void {
    const series = this.data?.series ?? this.data?.data ?? [];
    this.hasData = series.length > 0;
    if (!this.hasData) return;

    const isDark = this.theme.isDark();
    const textColor = isDark ? 'rgba(232,234,246,0.75)' : 'rgba(0,0,0,0.6)';
    const lineColor = isDark ? 'rgba(159,168,218,0.08)' : 'rgba(0,0,0,0.07)';
    const years = series.map(p => p.year.toString());
    const values = series.map(p => p.value);

    // Compute % change for annotation
    const first = values[0] ?? 0;
    const last = values[values.length - 1] ?? 0;
    const pctChange = first > 0 ? (((last - first) / first) * 100).toFixed(1) : null;

    this.chartOption = {
      backgroundColor: 'transparent',
      animation: true,
      animationDuration: 1200,
      animationEasing: 'cubicOut',
      tooltip: {
        trigger: 'axis',
        backgroundColor: isDark ? 'rgba(21,25,55,0.97)' : 'rgba(255,255,255,0.97)',
        borderColor: isDark ? 'rgba(0,212,170,0.3)' : 'rgba(0,168,150,0.3)',
        borderWidth: 1,
        textStyle: { color: isDark ? '#e8eaf6' : '#111', fontSize: 12 },
        formatter: (params: any) => {
          const p = Array.isArray(params) ? params[0] : params;
          return `
            <div style="font-weight:700;margin-bottom:4px">${p.axisValue}</div>
            <div style="color:#00d4aa">Population: <strong>${this.fmtLarge(p.value)}</strong></div>
          `;
        },
      },
      grid: { left: '2%', right: '3%', top: '10%', bottom: '12%', containLabel: true },
      xAxis: {
        type: 'category',
        data: years,
        axisLabel: { color: textColor, fontSize: 12, fontWeight: 600 },
        axisLine: { lineStyle: { color: lineColor } },
        axisTick: { show: false },
        boundaryGap: false,
      },
      yAxis: {
        type: 'value',
        splitLine: { lineStyle: { color: lineColor } },
        axisLabel: {
          color: textColor,
          fontSize: 11,
          formatter: (v: number) => this.fmtLarge(v),
        },
        axisLine: { show: false },
      },
      series: [
        {
          name: this.data?.indicator ?? 'Total Population',
          type: 'line',
          data: values,
          smooth: true,
          symbol: 'circle',
          symbolSize: 8,
          lineStyle: { color: '#00d4aa', width: 3 },
          itemStyle: {
            color: '#00d4aa',
            borderColor: isDark ? '#151937' : '#fff',
            borderWidth: 2,
          },
          areaStyle: {
            color: {
              type: 'linear',
              x: 0, y: 0, x2: 0, y2: 1,
              colorStops: [
                { offset: 0, color: 'rgba(0,212,170,0.35)' },
                { offset: 1, color: 'rgba(0,212,170,0.02)' },
              ],
            },
          },
          emphasis: {
            scale: true,
            itemStyle: { color: '#00ffcc', borderColor: '#00d4aa', borderWidth: 3 },
          },
          // Annotate last point with % change
          markPoint: pctChange ? {
            data: [{ type: 'max', name: 'Peak' }],
            symbol: 'pin',
            symbolSize: 46,
            label: {
              formatter: `+${pctChange}%`,
              color: '#0a0e27',
              fontWeight: 700,
              fontSize: 11,
            },
            itemStyle: { color: '#00d4aa' },
          } : undefined,
        },
      ],
    };
  }

  private fmtLarge(n: number): string {
    if (Math.abs(n) >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
    if (Math.abs(n) >= 1_000) return (n / 1_000).toFixed(0) + 'K';
    return n.toLocaleString();
  }
}

