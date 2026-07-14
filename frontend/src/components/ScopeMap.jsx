import { useEffect, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { lookupCoord, societyCoords } from '../utils/societyCoords.js';
import { cityBoundary } from '../utils/cityBoundary.js';
import { useTheme } from '../contexts/ThemeContext.jsx';

const NCR_CENTER = [77.2, 28.55]; // [lng, lat]

// Hardcoded city centres so the map can highlight cities with no API.
const CITY_CENTERS = {
  Gurgaon: [28.4595, 77.0266],
  Noida: [28.5355, 77.3910],
  Ghaziabad: [28.6692, 77.4538],
};
const cityCenter = (city) => CITY_CENTERS[city] || null;

// Theme-aware palette. Light = Direct's white/orange. Dark = black background,
// pink roads, red societies (per request).
function palette(dark) {
  return {
    bg: dark ? '#121212' : '#ffffff',
    water: dark ? '#1b1b1b' : '#f4f4f5',
    road: dark ? '#fe1492' : '#FEBA4F',     // roads: pink in dark
    society: dark ? '#06b6d4' : '#ea580c',  // society dots: cyan in dark, orange in light
    stroke: dark ? '#121212' : '#ffffff',   // marker outline = background colour
    label: dark ? '#ffffff' : '#111111',
    halo: dark ? '#000000' : '#ffffff',
    cityFill: dark ? '#fe1492' : '#fb923c',
    cityLine: dark ? '#fe1492' : '#ea580c',
    // Heatmap density ramp. Dark: blue (sparse) → hot pink (dense). Light: the
    // classic blue→cyan→lime→yellow→red heat ramp.
    heat: dark ? [
      'interpolate', ['linear'], ['heatmap-density'],
      0, 'rgba(37, 99, 235, 0)',
      0.15, 'rgba(37, 99, 235, 0.75)',  // blue
      0.45, '#7c3aed',                  // violet
      0.7, '#db2777',                   // pink
      1, '#fe1492',                     // hot pink — densest
    ] : [
      'interpolate', ['linear'], ['heatmap-density'],
      0, 'rgba(255, 237, 160, 0)',
      0.15, 'rgba(255, 237, 160, 0.8)',  // pale yellow — sparse
      0.4, '#fed976',                    // yellow
      0.6, '#fd8d3c',                    // orange
      0.8, '#f03b20',                    // red-orange
      1, '#bd0026',                      // deep red — densest
    ],
  };
}

// Vector style over OpenFreeMap tiles (no key).
function buildStyle(c) {
  return {
    version: 8,
    glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
    sources: { omt: { type: 'vector', url: 'https://tiles.openfreemap.org/planet' } },
    layers: [
      { id: 'bg', type: 'background', paint: { 'background-color': c.bg } },
      { id: 'water', type: 'fill', source: 'omt', 'source-layer': 'water', paint: { 'fill-color': c.water } },
      {
        id: 'roads', type: 'line', source: 'omt', 'source-layer': 'transportation',
        paint: { 'line-color': c.road, 'line-width': ['interpolate', ['linear'], ['zoom'], 6, 0.4, 10, 1, 14, 2.4, 18, 7] },
      },
      {
        id: 'roads-major', type: 'line', source: 'omt', 'source-layer': 'transportation',
        filter: ['match', ['get', 'class'], ['motorway', 'trunk', 'primary'], true, false],
        paint: { 'line-color': c.road, 'line-width': ['interpolate', ['linear'], ['zoom'], 6, 1, 10, 2.4, 14, 5, 18, 12] },
      },
      // No OSM text labels — we add our own city labels (see 'city-labels' layer).
    ],
  };
}

const emptyFC = () => ({ type: 'FeatureCollection', features: [] });

// Grow a LngLatBounds to include a GeoJSON Polygon/MultiPolygon's coords.
function extendBoundsWithGeometry(bounds, geom) {
  if (!geom) return;
  const polys = geom.type === 'MultiPolygon' ? geom.coordinates : [geom.coordinates];
  for (const poly of polys) for (const ring of poly) for (const c of ring) bounds.extend(c);
}

export default function ScopeMap({ cities = [], society = [], plotAll = false, societyCounts = {}, heatmap = false }) {
  const { theme } = useTheme();
  const elRef = useRef(null);
  const mapRef = useRef(null);
  const loadedRef = useRef(false);
  const renderRef = useRef(() => {});
  const heatmapRef = useRef(heatmap);
  heatmapRef.current = heatmap;
  const [note, setNote] = useState('');

  // Toggle dots ↔ heatmap by flipping layer visibility (both share the
  // 'societies' source; no re-fetch).
  const applyMode = () => {
    const map = mapRef.current;
    if (!map || !loadedRef.current) return;
    const heat = heatmapRef.current;
    if (map.getLayer('soc')) map.setLayoutProperty('soc', 'visibility', heat ? 'none' : 'visible');
    if (map.getLayer('soc-heat')) map.setLayoutProperty('soc-heat', 'visibility', heat ? 'visible' : 'none');
  };

  // Latest renderer (captures current props) — called on load + on scope change.
  renderRef.current = async () => {
    const map = mapRef.current;
    if (!map || !loadedRef.current) return;
    setNote('');
    const socFeats = [];
    const bounds = new maplibregl.LngLatBounds();
    let any = false;
    const extend = ([lat, lng]) => { bounds.extend([lng, lat]); any = true; };

    // Centre the map on the scope city/cities and place our own labels there.
    const cityLabelFeats = [];
    for (const c of cities) {
      const ctr = cityCenter(c);
      if (!ctr) continue;
      extend(ctr);
      cityLabelFeats.push({ type: 'Feature', properties: { name: c }, geometry: { type: 'Point', coordinates: [ctr[1], ctr[0]] } });
    }
    map.getSource('city-labels')?.setData({ type: 'FeatureCollection', features: cityLabelFeats });

    // Societies → markers from the bundled coordinate map (no geocoding). Each
    // marker carries its submission `count` (shown as a label on the dot).
    const coords = await societyCoords();
    if (!mapRef.current) return;
    let plotted = 0;
    if (plotAll) {
      for (const it of coords.items) {
        socFeats.push({ type: 'Feature', properties: { name: it.name, count: societyCounts[it.name] || 1 }, geometry: { type: 'Point', coordinates: [it.lng, it.lat] } });
        extend([it.lat, it.lng]);
        plotted += 1;
      }
    } else {
      for (const s of society) {
        const pt = lookupCoord(coords, s, cities);
        if (!pt) continue;
        socFeats.push({ type: 'Feature', properties: { name: s, count: societyCounts[s] || 1 }, geometry: { type: 'Point', coordinates: [pt[1], pt[0]] } });
        extend(pt);
        plotted += 1;
      }
    }
    map.getSource('societies')?.setData({ type: 'FeatureCollection', features: socFeats });
    if (any) map.fitBounds(bounds, { padding: 40, maxZoom: 14, duration: 600 });

    if (plotAll) {
      setNote(`Showing all ${plotted} societies in the data.`);
    } else {
      const missing = society.length - plotted;
      if (society.length && plotted === 0) setNote('None of these societies are in the coordinates file yet.');
      else if (missing > 0) setNote(`${plotted} of ${society.length} societies located (${missing} not in the coordinates file).`);
    }

    // City boundary → shade + outline the scope city (real OSM polygon). Fetched
    // after societies so a slow/missing boundary never blocks the pins.
    const cityNames = [];
    for (const c of cities) {
      cityNames.push(c);
      if (c === 'Noida') cityNames.push('Greater Noida');
    }
    const cityFeats = [];
    for (const name of cityNames) {
      const geom = await cityBoundary(name);
      if (!mapRef.current) return;
      if (geom) cityFeats.push({ type: 'Feature', properties: { name }, geometry: geom });
    }
    map.getSource('cities')?.setData({ type: 'FeatureCollection', features: cityFeats });

    if (cityFeats.length) {
      for (const f of cityFeats) extendBoundsWithGeometry(bounds, f.geometry);
      if (any) map.fitBounds(bounds, { padding: 40, maxZoom: 14, duration: 600 });
    }
  };

  // Init map once per theme (rebuilds on light/dark toggle so the base style +
  // road/society colours all flip together).
  useEffect(() => {
    if (mapRef.current || !elRef.current) return undefined;
    const c = palette(theme === 'dark');
    const map = new maplibregl.Map({ container: elRef.current, style: buildStyle(c), center: NCR_CENTER, zoom: 9, attributionControl: true });
    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    map.on('load', () => {
      map.addSource('cities', { type: 'geojson', data: emptyFC() });
      map.addSource('societies', { type: 'geojson', data: emptyFC() });
      map.addLayer({ id: 'city-fill', type: 'fill', source: 'cities', paint: { 'fill-color': c.cityFill, 'fill-opacity': 0.12 } });
      map.addLayer({ id: 'city-line', type: 'line', source: 'cities', layout: { 'line-cap': 'round' }, paint: { 'line-color': c.cityLine, 'line-width': 2.5, 'line-dasharray': [0, 2.5] } });
      // Society dots — radius grows a little with the submission count so busy
      // societies read as bigger bubbles; the count sits on top in white.
      // Society dots — radius grows a little with the submission count so busy
      // societies read as bigger bubbles; circle-sort-key = count draws the
      // busier ones on top. The exact count shows on hover.
      map.addLayer({
        id: 'soc', type: 'circle', source: 'societies',
        layout: { 'circle-sort-key': ['get', 'count'] },
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['get', 'count'], 1, 6, 30, 14],
          'circle-color': c.society, 'circle-stroke-color': c.stroke, 'circle-stroke-width': 2,
        },
      });
      // Heatmap alternative — weighted by submission count. Hidden until toggled.
      map.addLayer({
        id: 'soc-heat', type: 'heatmap', source: 'societies',
        layout: { visibility: 'none' },
        paint: {
          'heatmap-weight': ['interpolate', ['linear'], ['get', 'count'], 0, 0.4, 20, 1],
          'heatmap-intensity': ['interpolate', ['linear'], ['zoom'], 8, 1, 14, 3],
          'heatmap-radius': ['interpolate', ['linear'], ['zoom'], 8, 20, 14, 45],
          'heatmap-opacity': 0.85,
          'heatmap-color': c.heat,
        },
      });
      map.addSource('city-labels', { type: 'geojson', data: emptyFC() });
      map.addLayer({
        id: 'city-labels', type: 'symbol', source: 'city-labels',
        layout: { 'text-field': ['get', 'name'], 'text-size': 15, 'text-font': ['Noto Sans Bold'], 'text-anchor': 'center' },
        paint: { 'text-color': c.label, 'text-halo-color': c.halo, 'text-halo-width': 2.4 },
      });

      const popup = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 12 });
      // Map-level mousemove: show the society name + submission count on hover,
      // hide when off any dot.
      map.on('mousemove', (e) => {
        const feats = map.queryRenderedFeatures(e.point, { layers: ['soc'] });
        if (!feats.length) { map.getCanvas().style.cursor = ''; popup.remove(); return; }
        const f = feats[0];
        map.getCanvas().style.cursor = 'pointer';
        const pos = f.geometry.type === 'Point' ? f.geometry.coordinates : e.lngLat;
        const cnt = f.properties.count;
        popup.setLngLat(pos).setText(cnt ? `${f.properties.name} · ${cnt} submission${cnt === 1 ? '' : 's'}` : f.properties.name).addTo(map);
      });

      loadedRef.current = true;
      renderRef.current();
      applyMode();
    });
    return () => { map.remove(); mapRef.current = null; loadedRef.current = false; };
  }, [theme]);

  // Re-render layers when the scope changes.
  useEffect(() => { if (loadedRef.current) renderRef.current(); /* eslint-disable-next-line */ }, [JSON.stringify(cities), JSON.stringify(society), JSON.stringify(societyCounts), plotAll]);

  // Flip dots ↔ heatmap when the toggle changes.
  useEffect(() => { applyMode(); /* eslint-disable-next-line */ }, [heatmap]);

  return (
    <div className="scope-map-wrap">
      <div ref={elRef} className="scope-map" />
      <div className="scope-map-legend">
        <span><i className="lg-dot lg-society" /> Society</span>
        <span><i className="lg-area lg-city" /> City</span>
      </div>
      {note && <div className="scope-map-note">{note}</div>}
    </div>
  );
}
