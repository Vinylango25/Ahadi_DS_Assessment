// ============================================================
// Ahadi Kenya Population Analytics — API Service
// Handles backend schema shapes (FastAPI + Pydantic v2)
// ============================================================
import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { environment } from '../../environments/environment';
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

@Injectable({ providedIn: 'root' })
export class ApiService {
  private readonly http = inject(HttpClient);
  private readonly base = environment.apiUrl;

  // ── Metadata ──────────────────────────────────────────────────

  /** List all 47 counties. Backend returns string[] */
  getCounties(): Observable<County[]> {
    return this.http.get<string[]>(`${this.base}/api/counties`).pipe(
      map(names => names.map(name => ({ name, code: name })))
    );
  }

  /** List available census years (2021-2025). */
  getYears(): Observable<number[]> {
    return this.http.get<number[]>(`${this.base}/api/years`);
  }

  /** List available demographic indicators. Backend returns IndicatorsResponse */
  getIndicators(): Observable<Indicator[]> {
    return this.http.get<IndicatorsResponse>(`${this.base}/api/indicators`).pipe(
      map(res => (res.indicators ?? []).map(m => ({
        id: m.key,
        label: m.label,
        unit: m.unit,
        category: 'Demographics',
        description: m.description,
      })))
    );
  }

  // ── Map / Choropleth ──────────────────────────────────────────

  /**
   * Choropleth — backend returns full GeoJSON FeatureCollection with
   * indicator values in properties. We extract entries for the frontend model.
   */
  getChoropleth(year: number, indicator: string): Observable<ChoroplethData> {
    const params = new HttpParams()
      .set('year', year)
      .set('indicator', indicator);
    return this.http.get<GeoJSON.FeatureCollection>(`${this.base}/api/choropleth`, { params }).pipe(
      map(geojson => {
        const entries = (geojson.features ?? [])
          .filter(f => f.properties?.['value'] != null)
          .map(f => ({
            county: f.properties!['NAME_2'] ?? f.properties!['name'] ?? '',
            value: f.properties!['value'] as number,
          }));
        const values = entries.map(e => e.value).filter(isFinite);
        return {
          year,
          indicator,
          entries,
          min:  values.length ? Math.min(...values) : 0,
          max:  values.length ? Math.max(...values) : 0,
          mean: values.length ? values.reduce((s, v) => s + v, 0) / values.length : 0,
        };
      })
    );
  }

  /** GeoJSON FeatureCollection for Kenya GADM Level 2 boundaries. */
  getGeojson(): Observable<GeoJSON.FeatureCollection> {
    return this.http.get<GeoJSON.FeatureCollection>(`${this.base}/api/geojson`);
  }

  // ── County Detail ─────────────────────────────────────────────

  /** All demographic metrics for a single county + year. */
  getCountySummary(county: string, year: number): Observable<CountySummary> {
    const params = new HttpParams().set('year', year);
    return this.http.get<CountySummary>(
      `${this.base}/api/county/${encodeURIComponent(county)}`, { params }
    );
  }

  // ── Time-series ───────────────────────────────────────────────

  /**
   * Population time-series 2021-2025.
   * Backend returns NationalTimeseries { scope, indicator, data: [{year,value}] }
   * We normalise to include series alias for the chart component.
   */
  getTimeseries(county?: string): Observable<TimeseriesData> {
    let params = new HttpParams();
    if (county) params = params.set('county', county);
    return this.http.get<any>(`${this.base}/api/timeseries`, { params }).pipe(
      map(res => ({
        scope:     res.scope ?? 'Kenya',
        indicator: res.indicator ?? 'total_population',
        data:      res.data ?? [],
        series:    res.data ?? [],   // alias for timeseries-chart component
      }))
    );
  }

  // ── Ranking / Comparison ──────────────────────────────────────

  /**
   * Top-N county comparison.
   * Backend returns ComparisonResult { year, indicator, top[], bottom[] }
   * We add entries alias (top) for bar-chart component compatibility.
   */
  getComparison(year: number, indicator: string, n = 10): Observable<ComparisonData> {
    const params = new HttpParams()
      .set('year', year)
      .set('indicator', indicator)
      .set('n', n);
    return this.http.get<any>(`${this.base}/api/comparison`, { params }).pipe(
      map(res => ({
        year:      res.year,
        indicator: res.indicator,
        top:       res.top ?? [],
        bottom:    res.bottom ?? [],
        entries:   res.top ?? [],   // alias for bar-chart
        n,
      }))
    );
  }

  // ── Age Pyramid ───────────────────────────────────────────────

  /**
   * Population pyramid for a county.
   * Backend returns AgePyramid { county, year, age_groups: [{age_group, male, female}] }
   * We add rows alias and compute pct fields for the pyramid component.
   */
  getAgePyramid(county: string, year: number): Observable<AgePyramidData> {
    const params = new HttpParams()
      .set('county', county)
      .set('year', year);
    return this.http.get<any>(`${this.base}/api/age-pyramid`, { params }).pipe(
      map(res => {
        const ageGroups = res.age_groups ?? [];
        const totalMale   = ageGroups.reduce((s: number, r: any) => s + (r.male   ?? 0), 0);
        const totalFemale = ageGroups.reduce((s: number, r: any) => s + (r.female ?? 0), 0);
        const total = totalMale + totalFemale;

        const rows = ageGroups.map((r: any) => ({
          age_group:  r.age_group,
          male:       r.male   ?? 0,
          female:     r.female ?? 0,
          male_pct:   total > 0 ? ((r.male   ?? 0) / total) * 100 : 0,
          female_pct: total > 0 ? ((r.female ?? 0) / total) * 100 : 0,
        }));

        return {
          county:           res.county,
          year:             res.year,
          age_groups:       rows,
          rows,             // alias for pyramid component
          total_male:       totalMale,
          total_female:     totalFemale,
          total_population: total,
        };
      })
    );
  }
}
