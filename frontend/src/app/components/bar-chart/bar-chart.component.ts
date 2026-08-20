// ============================================================
// Ahadi — Bar Chart Component (County Comparison, ngx-echarts)
// ============================================================
import {
  Component,
  Input,
  Output,
  EventEmitter,
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
import { ComparisonData } from '../../models/population.model';
import { ThemeService } from '../../core/theme.service';

@Component({
  selector: 'app-bar-chart',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, NgxEchartsDirective],
  providers: [provideEchartsCore({ echarts: () => import('echarts') })],
  templateUrl: './bar-chart.component.html',
  styleUrls: ['./bar-chart.component.scss'],
})
export class BarChartComponent implements OnChanges {
  @Input() data: ComparisonData | null = null;
  @Input() indicatorName = '';
  @Input() indicatorUnit = '';
  @Input() title = '';
  @Input() selectedCounty = '';

  @Output() countyClicked = new EventEmitter<string>();

  readonly theme = inject(ThemeService);
  private readonly cdr = inject(ChangeDetectorRef);

  chartOption: EChartsOption = {};

  ngOnChanges(_changes: SimpleChanges): void {
    this.buildChart();
    this.cdr.markForCheck();
  }

  onChartClick(event: { name?: string }): void {
    if (event?.name) {
      this.countyClicked.emit(event.name);
    }
  }

  private buildChart(): void {
    if (!this.data?.entries?.length) {
      this.chartOption = this.emptyOption();
      return;
    }

    const isDark = this.theme.isDark();
    const textColor = isDark ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.65)';
    const lineColor = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.08)';

    // Sort descending
    const sorted = [...this.data.entries].sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
    const counties = sorted.map(e => e.county);
    const values = sorted.map(e => e.value ?? 0);

    const gradientColors = values.map((_, i) => {
      const t = 1 - i / (values.length - 1 || 1);
      return {
        type: 'linear' as const,
        x: 0, y: 0, x2: 1, y2: 0,
        colorStops: [
          { offset: 0, color: this.interpolateColor('#7c4dff', '#00d4aa', t) },
          { offset: 1, color: this.interpolateColor('#4a2fa0', '#00a896', t) },
        ],
      };
    });

    // Highlight selected county
    const seriesData = values.map((v, i) => ({
      value: v,
      itemStyle: {
        color: counties[i] === this.selectedCounty
          ? { type: 'linear' as const, x: 0, y: 0, x2: 1, y2: 0,
              colorStops: [
                { offset: 0, color: '#00d4aa' },
                { offset: 1, color: '#00ffcc' },
              ] }
          : gradientColors[i],
        borderRadius: [0, 6, 6, 0],
      },
      emphasis: {
        itemStyle: {
          color: { type: 'linear' as const, x: 0, y: 0, x2: 1, y2: 0,
            colorStops: [
              { offset: 0, color: '#00d4aa' },
              { offset: 1, color: '#00ffcc' },
            ] },
        },
      },
    }));

    this.chartOption = {
      backgroundColor: 'transparent',
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        backgroundColor: isDark ? 'rgba(21,25,55,0.97)' : 'rgba(255,255,255,0.97)',
        borderColor: isDark ? 'rgba(0,212,170,0.3)' : 'rgba(0,168,150,0.3)',
        borderWidth: 1,
        textStyle: { color: isDark ? '#fff' : '#111', fontSize: 12 },
        formatter: (params: any) => {
          const p = Array.isArray(params) ? params[0] : params;
          return `<div style="font-weight:700">${p.name}</div>
                  <div style="color:#00d4aa">${this.indicatorName}: <strong>${this.fmtNum(p.value)}</strong>
                  ${this.indicatorUnit ? `<span style="opacity:0.5;font-size:11px"> ${this.indicatorUnit}</span>` : ''}</div>`;
        },
      },
      grid: {
        left: '2%',
        right: '12%',
        top: '4%',
        bottom: '4%',
        containLabel: true,
      },
      xAxis: {
        type: 'value',
        splitLine: { lineStyle: { color: lineColor } },
        axisLabel: {
          color: textColor,
          fontSize: 11,
          formatter: (v: number) => this.fmtNum(v),
        },
        axisLine: { lineStyle: { color: lineColor } },
      },
      yAxis: {
        type: 'category',
        data: counties,
        inverse: true,
        axisLabel: {
          color: textColor,
          fontSize: 12,
          width: 100,
          overflow: 'truncate',
        },
        axisLine: { show: false },
        axisTick: { show: false },
      },
      series: [
        {
          name: this.indicatorName,
          type: 'bar',
          data: seriesData,
          barMaxWidth: 36,
          label: {
            show: true,
            position: 'right',
            color: textColor,
            fontSize: 11,
            formatter: (p: any) => this.fmtNum(p.value),
          },
        },
      ],
    };
  }

  private emptyOption(): EChartsOption {
    return {
      title: {
        text: 'No comparison data',
        left: 'center',
        top: 'middle',
        textStyle: { color: 'rgba(255,255,255,0.3)', fontSize: 14 },
      },
    };
  }

  private fmtNum(n: number): string {
    if (Math.abs(n) >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
    if (Math.abs(n) >= 1_000) return (n / 1_000).toFixed(0) + 'K';
    return n.toLocaleString();
  }

  private interpolateColor(hex1: string, hex2: string, t: number): string {
    const c1 = this.hexToRgb(hex1);
    const c2 = this.hexToRgb(hex2);
    const r = Math.round(c1[0] + (c2[0] - c1[0]) * t);
    const g = Math.round(c1[1] + (c2[1] - c1[1]) * t);
    const b = Math.round(c1[2] + (c2[2] - c1[2]) * t);
    return `rgb(${r},${g},${b})`;
  }

  private hexToRgb(hex: string): [number, number, number] {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result
      ? [parseInt(result[1], 16), parseInt(result[2], 16), parseInt(result[3], 16)]
      : [0, 0, 0];
  }
}


