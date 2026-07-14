import coordsJson from '../data/societyCoords.json';

// Society coordinate lookups from the bundled migrations JSON
// (society_name / latitude / longitude — ported from Direct_Inventory's
// backend/migrations/socities_coords.json). Built once, cached in-module:
//   byName: "name" -> [lat, lng]   (last one wins on same-named dupes)
//   items:  [{ name, lat, lng }]   (used by plotAll)
let _data = null;
const norm = (s) => (s || '').trim().toLowerCase();

export async function societyCoords() {
  if (_data) return _data;
  const items = [];
  const byName = {};
  for (const it of coordsJson) {
    const name = it.society_name;
    const lat = it.latitude;
    const lng = it.longitude;
    if (!name || typeof lat !== 'number' || typeof lng !== 'number') continue;
    items.push({ name, lat, lng });
    byName[norm(name)] = [lat, lng];
  }
  // byNameCity kept empty (the JSON has no city) — lookupCoord falls back to byName.
  _data = { byNameCity: {}, byName, items };
  return _data;
}

// Resolve a society's coords by name (city-disambiguation is a no-op here since
// the coords file has no city column). Signature kept identical to Direct's.
export function lookupCoord(data, name /* , cities = [] */) {
  if (!data || !name) return null;
  return data.byName[norm(name)] || null;
}
