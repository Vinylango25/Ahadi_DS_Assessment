// ============================================================
// StaticDataService
// Serves all dashboard data from static JSON assets when no
// backend API URL is configured (i.e. production on Vercel).
// Loads /population.json once and caches it in memory.
// ============================================================
import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, of, shareReplay } from 'rxjs';
import { map, switchMap } from 'rxjs/operators';
import {
  AgePyramidData,
  ChoroplethData,
  ComparisonData,
  County,
  Indicator,
  IndicatorsResponse,
  CountySummary,
  TimeseriesData,
} from '../models/population.model';

/** Shape of the population.json bundle */
interface PopulationBundle {
  counties:         string[];
  years:            number[];
  indicators:       IndicatorsResponse;
  county_summaries: Record<string, CountySummary>;
  choropleth:       Record<string, any>;
  comparison:       Record<string, any>;
  timeseries:       Record<string, any>;
  age_pyramid:      Record<string, any>;
}

@Injectable({ providedIn: 'root' })
export class StaticDataService {
  private readonly http    = inject(HttpClient);

  /** Single shared load — cached for the lifetime of the app */
  private readonly bundle$: Observable<PopulationBundle> = this.http
    .get<PopulationBundle>('/population.json')
    .pipe(shareReplay(1));

  // ── Metadata ──────────────────────────────────────────────────

  getCounties(): Observable<County[]> {
    return this.bundle$.pipe(
      map(b => b.counties.map(name => ({ name, code: name })))
    );
  }

  getYears(): Observable<number[]> {
    return this.bundle$.pipe(map(b => [...b.years].sort((a, z) => z - a)));
  }

  getIndicators(): Observable<Indicator[]> {
    return this.bundle$.pipe(
      map(b => (b.indicators.indicators ?? []).map(m => ({
        id:          m.key,
        label:       m.label,
        unit:        m.unit,
        category:    'Demographics',
        description: m.description,
      })))
    );
  }

  // ── GeoJSON ───────────────────────────────────────────────────

  getGeojson(): Observable<GeoJSON.FeatureCollection> {
    return this.http.get<GeoJSON.FeatureCollection>('/kenya_counties.geojson');
  }

  // ── Choropleth ────────────────────────────────────────────────

  getChoropleth(year: number, indicator: string): Observable<ChoroplethData> {
    return this.bundle$.pipe(
      map(b => {
        const key  = `${year}_${indicator}`;
        const raw  = b.choropleth[key];
        if (!raw) {
          return { year, indicator, entries: [], min: 0, max: 0, mean: 0 } as ChoroplethData;
        }
        return raw as ChoroplethData;
      })
    );
  }

  // ── County summary ────────────────────────────────────────────

  getCountySummary(county: string, year: number): Observable<CountySummary> {
    return this.bundle$.pipe(
      map(b => {
        const key = `${county}_${year}`;
        return b.county_summaries[key] ?? { county, year } as CountySummary;
      })
    );
  }

  // ── Timeseries ────────────────────────────────────────────────

  getTimeseries(county?: string): Observable<TimeseriesData> {
    return this.bundle$.pipe(
      map(b => {
        const key = county && county.trim() ? county : 'national';
        const raw = b.timeseries[key] ?? b.timeseries['national'];
        return {
          scope:     raw?.scope     ?? (county || 'Kenya'),
          indicator: raw?.indicator ?? 'total_population',
          data:      raw?.data      ?? [],
          series:    raw?.data      ?? [],
        } as TimeseriesData;
      })
    );
  }

  // ── Comparison ────────────────────────────────────────────────

  getComparison(year: number, indicator: string, n = 10): Observable<ComparisonData> {
    return this.bundle$.pipe(
      map(b => {
        const key = `${year}_${indicator}`;
        const raw = b.comparison[key];
        if (!raw) {
          return { year, indicator, top: [], bottom: [], entries: [], n } as ComparisonData;
        }
        return {
          year:      raw.year,
          indicator: raw.indicator,
          unit:      raw.unit,
          label:     raw.label,
          top:       (raw.top    ?? []).slice(0, n),
          bottom:    (raw.bottom ?? []).slice(0, n),
          entries:   (raw.top    ?? []).slice(0, n),
          n,
        } as ComparisonData;
      })
    );
  }

  // ── Age Pyramid ───────────────────────────────────────────────

  getAgePyramid(county: string, year: number): Observable<AgePyramidData> {
    return this.bundle$.pipe(
      map(b => {
        const key     = `${county}_${year}`;
        const raw     = b.age_pyramid[key];
        if (!raw) {
          return { county, year, age_groups: [], rows: [] } as AgePyramidData;
        }
        const rows = raw.age_groups ?? [];
        return {
          county:           raw.county,
          year:             raw.year,
          age_groups:       rows,
          rows,
          total_male:       raw.total_male,
          total_female:     raw.total_female,
          total_population: raw.total_population,
        } as AgePyramidData;
      })
    );
  }
}
