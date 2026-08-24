// ============================================================
// Ahadi — Age Pyramid Component (ngx-echarts)
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
import type { EChartsOption, SeriesOption } from 'echarts';
import { AgePyramidData } from '../../models/population.model';
import { ThemeService } from '../../core/theme.service';
import { SexFilter } from '../../features/dashboard/dashboard.component';

@Component({
  selector: 'app-age-pyramid',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, NgxEchartsDirective],
  providers: [provideEchartsCore({ echarts: () => import('echarts') })],
  templateUrl: './age-pyramid.component.html',
  styleUrls: ['./age-pyramid.component.scss'],
})
export class AgePyramidComponent implements OnChanges {
  @Input() data: AgePyramidData | null = null;
  @Input() countyName = '';
  @Input() sex: SexFilter = 'Total';

  readonly theme = inject(ThemeService);
  private readonly cdr = inject(ChangeDetectorRef);

  chartOption: EChartsOption = {};

  constructor() {
    // Rebuild chart whenever dark/light theme toggles
    effect(() => {
      void this.theme.isDark(); // track the signal
      this.buildChart();
      this.cdr.markForCheck();
    });
  }

  ngOnChanges(_changes: SimpleChanges): void {
    this.buildChart();
    this.cdr.markForCheck();
  }

  private buildChart(): void {
    if (!this.data?.rows?.length) {
      this.chartOption = this.emptyOption();
      return;
    }

    const rows = [...this.data.rows].reverse(); // oldest on top
    const ageGroups = rows.map(r => r.age_group);
    const females = rows.map(r => -Math.abs(r.female)); // negative for left side
    const males = rows.map(r => Math.abs(r.male));

    const isDark = this.theme.isDark();
    const textColor = isDark ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.65)';
    const lineColor = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.08)';
    const bgColor = 'transparent';

    const showFemale = this.sex === 'Total' || this.sex === 'Female';
    const showMale   = this.sex === 'Total' || this.sex === 'Male';

    const series: SeriesOption[] = [];

    if (showFemale) {
      series.push({
        name: 'Female',
        type: 'bar',
        stack: 'pyramid',
        data: females,
        itemStyle: {
          color: {
            type: 'linear',
            x: 0, y: 0, x2: 1, y2: 0,
            colorStops: [
              { offset: 0, color: '#00d4aa' },
              { offset: 1, color: '#00a896' },
            ],
          },
          borderRadius: [4, 0, 0, 4],
        },
        label: {
          show: false,
        },
        emphasis: {
          itemStyle: { color: '#00ffcc' },
        },
        barMaxWidth: 28,
      });
    }

    if (showMale) {
      series.push({
        name: 'Male',
        type: 'bar',
        stack: 'pyramid',
        data: showFemale ? males : males, // always positive
        itemStyle: {
          color: {
            type: 'linear',
            x: 0, y: 0, x2: 1, y2: 0,
            colorStops: [
              { offset: 0, color: '#9c72ff' },
              { offset: 1, color: '#7c4dff' },
            ],
          },
          borderRadius: [0, 4, 4, 0],
        },
        label: {
          show: false,
        },
        emphasis: {
          itemStyle: { color: '#b39dff' },
        },
        barMaxWidth: 28,
      });
    }

    const maxVal = Math.max(
      ...rows.map(r => Math.abs(r.male)),
      ...rows.map(r => Math.abs(r.female)),
    );

    const axisMax = Math.ceil(maxVal * 1.15);

    this.chartOption = {
      backgroundColor: bgColor,
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        backgroundColor: isDark ? 'rgba(21,25,55,0.97)' : 'rgba(255,255,255,0.97)',
        borderColor: isDark ? 'rgba(0,212,170,0.3)' : 'rgba(0,168,150,0.3)',
        borderWidth: 1,
        textStyle: { color: isDark ? '#fff' : '#111', fontSize: 12 },
        formatter: (params: any) => {
          const idx = params[0].dataIndex;
          const row = rows[idx];
          return `
            <div style="font-weight:700;margin-bottom:6px;color:${isDark ? '#fff' : '#111'}">${row.age_group} years</div>
            <div style="color:#00d4aa">Female: ${this.fmtNum(row.female)} (${(row.female_pct ?? 0).toFixed(1)}%)</div>
            <div style="color:#9c72ff">Male: ${this.fmtNum(row.male)} (${(row.male_pct ?? 0).toFixed(1)}%)</div>
          `;
        },
      },
      legend: {
        data: ['Female', 'Male'],
        top: 4,
        textStyle: { color: textColor, fontSize: 12 },
        itemWidth: 14,
        itemHeight: 10,
      },
      grid: {
        left: '18%',
        right: '5%',
        top: '14%',
        bottom: '8%',
        containLabel: false,
      },
      xAxis: {
        type: 'value',
        min: showFemale ? -axisMax : 0,
        max: showMale ? axisMax : 0,
        splitLine: { lineStyle: { color: lineColor } },
        axisLabel: {
          color: textColor,
          fontSize: 10,
          formatter: (v: number) => this.fmtNum(Math.abs(v)),
        },
        axisLine: { lineStyle: { color: lineColor } },
      },
      yAxis: {
        type: 'category',
        data: ageGroups,
        axisLabel: { color: textColor, fontSize: 11 },
        axisLine: { lineStyle: { color: lineColor } },
        axisTick: { show: false },
      },
      series,
    };
  }

  private emptyOption(): EChartsOption {
    const isDark = this.theme.isDark();
    return {
      title: {
        text: 'No data available',
        left: 'center',
        top: 'middle',
        textStyle: { color: isDark ? 'rgba(255,255,255,0.3)' : 'rgba(0,0,0,0.3)', fontSize: 14 },
      },
    };
  }

  private fmtNum(n: number): string {
    if (Math.abs(n) >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
    if (Math.abs(n) >= 1_000) return (n / 1_000).toFixed(0) + 'K';
    return n.toLocaleString();
  }
}


