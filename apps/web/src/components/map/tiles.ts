/**
 * Raster basemap choice. Build-time switch `VITE_MAP_TILES`:
 *   - 'osm' (default): openstreetmap.org standard tiles. Street and place names are in Persian. The OSM tile policy
 *     needs a Referer, so these requests send the page ORIGIN only (strict-origin-when-cross-origin), overriding the
 *     server's global `Referrer-Policy: no-referrer` for tiles alone. Fine for a demo / low traffic; a busy
 *     deployment should move to a hosted provider (policy: operations.osmfoundation.org/policies/tiles).
 *   - 'carto': CARTO Positron. As of Oct 2026 basemaps.cartocdn.com answers every request without an API key with a
 *     2 KB «API KEY REQUIRED» watermark tile, so it is opt-in only.
 *   - any other value is used as a Leaflet URL template (e.g. a self-hosted or keyed provider); its attribution then
 *     comes from `VITE_MAP_TILES_ATTRIBUTION`.
 */
export interface TileConfig {
  url: string;
  attribution: string;
  subdomains: string;
  maxNativeZoom: number;
  referrerPolicy: 'strict-origin-when-cross-origin';
}

const OSM_ATTR = '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>';

export function tileConfig(choice: string | undefined, customAttribution?: string): TileConfig {
  const c = (choice ?? '').trim();
  if (c === '' || c === 'osm') {
    return {
      url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
      attribution: OSM_ATTR,
      subdomains: 'abc',
      maxNativeZoom: 19,
      referrerPolicy: 'strict-origin-when-cross-origin',
    };
  }
  if (c === 'carto') {
    return {
      url: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
      attribution: `${OSM_ATTR} &copy; <a href="https://carto.com/attributions" target="_blank" rel="noopener">CARTO</a>`,
      subdomains: 'abcd',
      maxNativeZoom: 20,
      referrerPolicy: 'strict-origin-when-cross-origin',
    };
  }
  return { url: c, attribution: customAttribution || OSM_ATTR, subdomains: 'abc', maxNativeZoom: 19, referrerPolicy: 'strict-origin-when-cross-origin' };
}
