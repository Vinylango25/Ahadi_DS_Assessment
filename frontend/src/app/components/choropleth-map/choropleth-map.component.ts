// ============================================================
// Ahadi — Interactive Kenya Population Map (Leaflet)
// Features: County choropleth, major city markers,
//           regional grouping, drill-down click, rich tooltips
// ============================================================
import {
  Component,
  Input,
  Output,
  EventEmitter,
  OnChanges,
  OnDestroy,
  AfterViewInit,
  SimpleChanges,
  ViewChild,
  ElementRef,
  inject,
  signal,
  ChangeDetectionStrategy,
  NgZone,
  PLATFORM_ID,
} from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import type * as L from 'leaflet';
import { ThemeService } from '../../core/theme.service';

declare const require: (mod: string) => typeof L;

// ── Kenya major cities / towns ────────────────────────────────
const KENYA_CITIES = [
  { name: 'Nairobi',   lat: -1.2921, lng: 36.8219, population: 4937000, type: 'capital' },
  { name: 'Mombasa',   lat: -4.0435, lng: 39.6682, population: 1200000, type: 'city' },
  { name: 'Kisumu',    lat: -0.1022, lng: 34.7617, population:  610000, type: 'city' },
  { name: 'Nakuru',    lat: -0.3031, lng: 36.0800, population:  570000, type: 'city' },
  { name: 'Eldoret',   lat:  0.5143, lng: 35.2698, population:  475000, type: 'city' },
  { name: 'Thika',     lat: -1.0332, lng: 37.0693, population:  280000, type: 'town' },
  { name: 'Malindi',   lat: -3.2138, lng: 40.1169, population:  119000, type: 'town' },
  { name: 'Kitale',    lat:  1.0154, lng: 35.0062, population:  106000, type: 'town' },
  { name: 'Garissa',   lat: -0.4532, lng: 39.6461, population:  141000, type: 'town' },
  { name: 'Nyeri',     lat: -0.4167, lng: 36.9500, population:  133000, type: 'town' },
];

// ── Kenya administrative regions ────────────────────────────────
const KENYA_REGIONS: Record<string, string[]> = {
  'Nairobi': ['Nairobi'],
  'Central': ['Kiambu', 'Murang\'a', 'Kirinyaga', 'Nyeri', 'Nyandarua'],
  'Coast': ['Mombasa', 'Kwale', 'Kilifi', 'Tana River', 'Lamu', 'Taita Taveta'],
  'Eastern': ['Machakos', 'Makueni', 'Kitui', 'Embu', 'Tharaka Nithi', 'Meru', 'Marsabit', 'Isiolo'],
  'North Eastern': ['Garissa', 'Wajir', 'Mandera'],
  'Nyanza': ['Kisumu', 'Siaya', 'Homa Bay', 'Migori', 'Kisii', 'Nyamira'],
  'Rift Valley': ['Nakuru', 'Narok', 'Kajiado', 'Kericho', 'Bomet', 'Nandi', 'Uasin Gishu',
                  'Elgeyo Marakwet', 'Trans Nzoia', 'West Pokot', 'Baringo', 'Laikipia', 'Samburu', 'Turkana'],
  'Western': ['Kakamega', 'Vihiga', 'Bungoma', 'Busia'],
};

@Component({
  selector: 'app-choropleth-map',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule],
  template: `
    <div class="map-wrapper">
      <!-- Map container -->
      <div #mapContainer class="map-container">
        @if (!mapReady()) {
          <div class="map-skeleton">
            <span class="material-symbols-rounded">map</span>
            <p>Loading map…</p>
          </div>
        }
      </div>

      <!-- Map controls overlay -->
      <div class="map-controls">
        <button class="map-ctrl-btn" (click)="resetView()" title="Reset view">
          <span class="material-symbols-rounded">center_focus_strong</span>
        </button>
        <button class="map-ctrl-btn"
                [class.active]="showCities()"
                (click)="toggleCities()"
                title="Toggle city markers">
          <span class="material-symbols-rounded">location_city</span>
        </button>
      </div>

      <!-- Region legend strip -->
      <div class="region-strip" *ngIf="mapReady()">
        @for (region of regionKeys; track region) {
          <div class="region-chip"
               [style.background]="regionColor(region)"
               [title]="region + ': ' + regionCounties(region)">
            {{ region }}
          </div>
        }
      </div>
    </div>
  `,
  styleUrls: ['./choropleth-map.component.scss'],
})
export class ChoroplethMapComponent implements AfterViewInit, OnChanges, OnDestroy {
  @ViewChild('mapContainer', { static: true }) mapContainer!: ElementRef<HTMLDivElement>;

  @Input() geoJsonData: GeoJSON.FeatureCollection | null = null;
  @Input() choroplethData: Record<string, number> = {};
  @Input() indicatorName = 'Population';
  @Input() indicatorUnit = '';
  @Input() isRatio = false;
  @Input() selectedCounty = '';

  @Output() countyClicked = new EventEmitter<string>();

  private leaflet: typeof L | null = null;
  private map: L.Map | null = null;
  private geoLayer: L.GeoJSON | null = null;
  private legend: L.Control | null = null;
  private cityLayerGroup: L.LayerGroup | null = null;

  readonly mapReady = signal(false);
  readonly showCities = signal(true);

  readonly regionKeys = Object.keys(KENYA_REGIONS);

  private readonly zone = inject(NgZone);
  private readonly theme = inject(ThemeService);
  private readonly platformId = inject(PLATFORM_ID);

  private readonly KENYA_CENTER: [number, number] = [0.0236, 37.9062];
  private readonly KENYA_ZOOM = 6;

  // Distinct colors per region for border highlights
  private readonly REGION_COLORS: Record<string, string> = {
    'Nairobi':       '#ff6b6b',
    'Central':       '#ffd93d',
    'Coast':         '#4ecdc4',
    'Eastern':       '#ff9f43',
    'North Eastern': '#a29bfe',
    'Nyanza':        '#00d4aa',
    'Rift Valley':   '#fd79a8',
    'Western':       '#74b9ff',
  };

  regionColor(r: string): string {
    return (this.REGION_COLORS[r] ?? '#888') + '33'; // translucent
  }

  regionCounties(r: string): string {
    return (KENYA_REGIONS[r] ?? []).join(', ');
  }

  async ngAfterViewInit(): Promise<void> {
    if (!isPlatformBrowser(this.platformId)) return;
    this.leaflet = (await import('leaflet') as any).default ?? await import('leaflet');
    this.zone.runOutsideAngular(() => this.initMap());
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (!this.map || !this.leaflet) return;
    if (changes['geoJsonData'] || changes['choroplethData'] || changes['isRatio']) {
      this.renderGeoLayer();
      this.updateLegend();
    }
    if (changes['selectedCounty']) this.highlightSelected();
    if (changes['indicatorName'])  this.updateLegend();
  }

  ngOnDestroy(): void {
    this.map?.remove();
    this.map = null;
  }

  resetView(): void {
    this.map?.setView(this.KENYA_CENTER, this.KENYA_ZOOM);
  }

  toggleCities(): void {
    this.showCities.update(v => !v);
    if (this.showCities()) {
      this.cityLayerGroup?.addTo(this.map!);
    } else {
      this.cityLayerGroup?.remove();
    }
  }

  // ── Map init ──────────────────────────────────────────────────
  private initMap(): void {
    const L = this.leaflet!;

    this.map = L.map(this.mapContainer.nativeElement, {
      center: this.KENYA_CENTER,
      zoom: this.KENYA_ZOOM,
      zoomControl: false,
      attributionControl: true,
      preferCanvas: true,
    });

    // Custom zoom position
    L.control.zoom({ position: 'topright' }).addTo(this.map);

    this.applyTiles();
    this.renderGeoLayer();
    this.addCityMarkers();
    this.addLegend();

    this.zone.run(() => this.mapReady.set(true));
  }

  private applyTiles(): void {
    const L = this.leaflet!;
    const isDark = this.theme.isDark();

    const tileUrl = isDark
      ? 'https://{s}.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}{r}.png'
      : 'https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png';
    const labelUrl = isDark
      ? 'https://{s}.basemaps.cartocdn.com/dark_only_labels/{z}/{x}/{y}{r}.png'
      : 'https://{s}.basemaps.cartocdn.com/light_only_labels/{z}/{x}/{y}{r}.png';

    const attrib = '&copy; <a href="https://carto.com">CARTO</a> &copy; <a href="https://openstreetmap.org">OSM</a>';
    L.tileLayer(tileUrl, { attribution: attrib, maxZoom: 18 }).addTo(this.map!);
    L.tileLayer(labelUrl, { maxZoom: 18, zIndex: 500 }).addTo(this.map!);
  }

  // ── GeoJSON choropleth ────────────────────────────────────────
  private renderGeoLayer(): void {
    const L = this.leaflet!;
    if (!this.map) return;
    if (this.geoLayer) { this.map.removeLayer(this.geoLayer); this.geoLayer = null; }
    if (!this.geoJsonData) return;

    const values = Object.values(this.choroplethData).filter(isFinite);
    const min = values.length ? Math.min(...values) : 0;
    const max = values.length ? Math.max(...values) : 1;

    this.geoLayer = L.geoJSON(this.geoJsonData as any, {
      style: (f) => this.featureStyle(f, min, max),
      onEachFeature: (f, layer) => this.bindFeatureEvents(f, layer, min, max),
    }).addTo(this.map);
  }

  private featureStyle(feature: GeoJSON.Feature | undefined, min: number, max: number): L.PathOptions {
    const name = this.getCountyName(feature);
    const value = name ? this.choroplethData[name] : undefined;
    const region = this.getRegion(name);
    const isSelected = name === this.selectedCounty;

    return {
      fillColor: value !== undefined ? this.getColor(value, min, max) : (this.theme.isDark() ? '#1a2040' : '#e8ecf0'),
      weight: isSelected ? 3 : 1,
      opacity: 1,
      color: isSelected ? '#00d4aa' : (region ? this.REGION_COLORS[region] + '60' : 'rgba(255,255,255,0.2)'),
      fillOpacity: 0.82,
      dashArray: isSelected ? undefined : undefined,
    };
  }

  private bindFeatureEvents(
    feature: GeoJSON.Feature,
    layer: L.Layer,
    min: number,
    max: number,
  ): void {
    const L = this.leaflet!;
    const name = this.getCountyName(feature);
    const value = name ? this.choroplethData[name] : undefined;
    const region = this.getRegion(name);

    // Build rich tooltip
    const countyPop = value !== undefined ? this.formatValue(value) : 'N/A';
    const tooltipHtml = `
      <div class="ahadi-tooltip">
        <div class="tip-header">
          <span class="tip-county">${name ?? 'Unknown'}</span>
          ${region ? `<span class="tip-region" style="color:${this.REGION_COLORS[region] ?? '#aaa'}">${region}</span>` : ''}
        </div>
        <div class="tip-metric">
          <span class="tip-label">${this.indicatorName}</span>
          <span class="tip-value">${countyPop}${this.indicatorUnit ? ' ' + this.indicatorUnit : ''}</span>
        </div>
        <div class="tip-hint">Click to explore county details</div>
      </div>`;

    (layer as L.Path).bindTooltip(tooltipHtml, {
      sticky: true,
      className: 'ahadi-tooltip-wrap',
      offset: [14, 0],
    });

    layer.on({
      mouseover: (e) => {
        const path = e.target as L.Path;
        path.setStyle({ weight: 2.5, color: '#00d4aa', fillOpacity: 0.96 });
        path.bringToFront();
      },
      mouseout: (e) => {
        if (this.geoLayer) this.geoLayer.resetStyle(e.target as L.Path);
        this.highlightSelected();
      },
      click: (e) => {
        L.DomEvent.stopPropagation(e);
        if (name) this.zone.run(() => this.countyClicked.emit(name));
        // Zoom into county
        this.map!.fitBounds((e.target as L.Polygon).getBounds(), { padding: [30, 30], maxZoom: 9 });
      },
    });
  }

  private highlightSelected(): void {
    if (!this.geoLayer) return;
    const values = Object.values(this.choroplethData).filter(isFinite);
    const min = values.length ? Math.min(...values) : 0;
    const max = values.length ? Math.max(...values) : 1;

    this.geoLayer.eachLayer((layer) => {
      const f = (layer as any).feature as GeoJSON.Feature | undefined;
      const name = this.getCountyName(f);
      const value = name ? this.choroplethData[name] : undefined;
      const region = this.getRegion(name);
      const isSelected = name === this.selectedCounty;

      (layer as L.Path).setStyle({
        fillColor: value !== undefined ? this.getColor(value, min, max) : (this.theme.isDark() ? '#1a2040' : '#e8ecf0'),
        weight: isSelected ? 3 : 1,
        color: isSelected ? '#00d4aa' : (region ? this.REGION_COLORS[region] + '60' : 'rgba(255,255,255,0.2)'),
        fillOpacity: isSelected ? 0.96 : 0.82,
      });
      if (isSelected) (layer as L.Path).bringToFront();
    });
  }

  // ── City markers ──────────────────────────────────────────────
  private addCityMarkers(): void {
    const L = this.leaflet!;
    this.cityLayerGroup = L.layerGroup();

    KENYA_CITIES.forEach(city => {
      const isCapital = city.type === 'capital';
      const radius = isCapital ? 10 : city.type === 'city' ? 7 : 5;
      const color = isCapital ? '#ff6b6b' : city.type === 'city' ? '#ffd93d' : '#74b9ff';

      const marker = L.circleMarker([city.lat, city.lng], {
        radius,
        fillColor: color,
        color: this.theme.isDark() ? '#0a0e27' : '#fff',
        weight: 2,
        fillOpacity: 0.92,
        className: 'city-marker',
      });

      const popHtml = `
        <div class="city-popup">
          <div class="city-name">${city.name}</div>
          <div class="city-type">${isCapital ? '🏛 Capital City' : city.type === 'city' ? '🏙 Major City' : '🏘 Town'}</div>
          <div class="city-pop">Est. Population: <strong>${(city.population / 1000).toFixed(0)}K</strong></div>
        </div>`;

      marker.bindPopup(popHtml, {
        className: 'city-popup-wrap',
        maxWidth: 200,
      });

      // Permanent label for capital and major cities
      if (city.type !== 'town') {
        marker.bindTooltip(city.name, {
          permanent: true,
          direction: 'top',
          offset: [0, -radius - 3],
          className: 'city-label',
        });
      }

      this.cityLayerGroup!.addLayer(marker);
    });

    this.cityLayerGroup.addTo(this.map!);
  }

  // ── Legend ────────────────────────────────────────────────────
  private addLegend(): void {
    const L = this.leaflet!;
    const self = this;
    const LegendCtrl = L.Control.extend({
      options: { position: 'bottomright' },
      onAdd(): HTMLElement {
        const div = L.DomUtil.create('div', 'map-legend');
        self.buildLegendHtml(div);
        return div;
      },
    });
    this.legend = new LegendCtrl();
    this.legend.addTo(this.map!);
  }

  private updateLegend(): void {
    const container = (this.legend as any)?.getContainer?.() as HTMLElement | undefined;
    if (container) this.buildLegendHtml(container);
  }

  private buildLegendHtml(div: HTMLElement): void {
    const values = Object.values(this.choroplethData).filter(isFinite);
    const min = values.length ? Math.min(...values) : 0;
    const max = values.length ? Math.max(...values) : 1;
    const steps = 5;

    let html = `<div class="legend-title">${this.indicatorName}${this.indicatorUnit ? ` (${this.indicatorUnit})` : ''}</div><div class="legend-scale">`;
    for (let i = 0; i <= steps; i++) {
      const v = min + (i * (max - min)) / steps;
      html += `<div class="legend-item">
        <span class="legend-swatch" style="background:${this.getColor(v, min, max)}"></span>
        <span class="legend-lbl">${this.formatValue(v)}</span>
      </div>`;
    }
    html += '</div>';

    // City legend
    html += `<div class="legend-divider"></div>
      <div class="legend-cities">
        <div class="legend-item"><span class="legend-swatch" style="background:#ff6b6b;border-radius:50%"></span><span class="legend-lbl">Capital</span></div>
        <div class="legend-item"><span class="legend-swatch" style="background:#ffd93d;border-radius:50%"></span><span class="legend-lbl">Major City</span></div>
        <div class="legend-item"><span class="legend-swatch" style="background:#74b9ff;border-radius:50%"></span><span class="legend-lbl">Town</span></div>
      </div>`;

    div.innerHTML = html;
  }

  // ── Color scales ──────────────────────────────────────────────
  private getColor(value: number, min: number, max: number): string {
    const t = max === min ? 0.5 : (value - min) / (max - min);
    return this.isRatio ? this.divergingColor(t) : this.sequentialColor(t);
  }

  /** Dark navy (#0d1b3e) → teal (#00d4aa) */
  private sequentialColor(t: number): string {
    const r = Math.round(13 + t * (0 - 13));
    const g = Math.round(27 + t * (212 - 27));
    const b = Math.round(62 + t * (170 - 62));
    return `rgb(${r},${g},${b})`;
  }

  /** Purple (#7c4dff) → neutral → teal (#00d4aa) */
  private divergingColor(t: number): string {
    if (t < 0.5) {
      const u = t * 2;
      return `rgb(${Math.round(124 + u * 56)},${Math.round(77 + u * 103)},${Math.round(255 - u * 35)})`;
    }
    const u = (t - 0.5) * 2;
    return `rgb(${Math.round(180 - u * 180)},${Math.round(180 + u * 32)},${Math.round(220 - u * 50)})`;
  }

  // ── Helpers ───────────────────────────────────────────────────
  private getCountyName(feature?: GeoJSON.Feature | null): string | undefined {
    if (!feature?.properties) return undefined;
    const p = feature.properties;
    return p['NAME_1'] ?? p['name'] ?? p['county'] ?? p['County'] ?? p['shapeName'] ?? p['NAME_2'];
  }

  private getRegion(county?: string): string | undefined {
    if (!county) return undefined;
    return Object.keys(KENYA_REGIONS).find(r => KENYA_REGIONS[r].includes(county));
  }

  private formatValue(value: number): string {
    if (Math.abs(value) >= 1_000_000) return (value / 1_000_000).toFixed(1) + 'M';
    if (Math.abs(value) >= 1_000)     return (value / 1_000).toFixed(1) + 'K';
    return value % 1 === 0 ? value.toLocaleString() : value.toFixed(2);
  }
}
