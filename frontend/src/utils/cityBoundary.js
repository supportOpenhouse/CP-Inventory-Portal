// City boundary polygon from OpenStreetMap Nominatim (the same source Direct's
// backend geo endpoint used — called directly from the browser here since we
// have no backend proxy). Returns a GeoJSON Polygon/MultiPolygon or null.
// Cached in-module; transient failures are not cached so they retry.
const CITY_OSM_RELATION = { ghaziabad: 9999582 };
const cache = {};

async function fetchPolygon(endpoint, params) {
  const url = `https://nominatim.openstreetmap.org/${endpoint}?${new URLSearchParams(params).toString()}`;
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) return null;
  const data = await res.json();
  for (const d of (data || [])) {
    const g = d.geojson;
    if (g && (g.type === 'Polygon' || g.type === 'MultiPolygon')) return g;
  }
  return null;
}

export async function cityBoundary(city) {
  if (!city) return null;
  const key = city.toLowerCase();
  if (key in cache) return cache[key];
  let geom = null;
  try {
    const rel = CITY_OSM_RELATION[key];
    if (rel) {
      // Pinned relation id (e.g. Ghaziabad R9999582) — look it up directly.
      geom = await fetchPolygon('lookup', { osm_ids: `R${rel}`, format: 'jsonv2', polygon_geojson: 1 });
    } else {
      // Structured city= first; fall back to free-text q=.
      geom = await fetchPolygon('search', { city, country: 'India', format: 'jsonv2', polygon_geojson: 1, limit: 10 });
      if (!geom) geom = await fetchPolygon('search', { q: `${city}, India`, format: 'jsonv2', polygon_geojson: 1, limit: 10 });
    }
  } catch {
    return null; // transient — don't cache the failure, let it retry
  }
  cache[key] = geom;
  return geom;
}
