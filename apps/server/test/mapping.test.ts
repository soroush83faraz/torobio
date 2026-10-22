/** Attribute adapter: extractor attrs (ATTRIBUTES.md) -> engine ProductAttrs, one block per domain. */
import { describe, expect, it } from 'vitest';
import { ATTR_MAP, mapAttrs } from '../src/adapter/mapping.js';
import { parseHours, toCandidate, toOffer } from '../src/adapter/rows.js';

const m = (domain: string | null, raw: Record<string, unknown>) => mapAttrs(domain, raw);

describe('attribute mapping per domain', () => {
  it('every domain row targets a key of the closed engine schema', () => {
    expect(Object.keys(ATTR_MAP).sort()).toEqual(
      ['adapter', 'cctv_camera', 'charger', 'headphones', 'hdd', 'lighting', 'phone', 'phone_accessory', 'power_bank', 'recorder', 'switch_socket', 'wire'].sort(),
    );
  });

  it('brand: the stable slug is the constraint value (display name stays in products.brand)', () => {
    expect(m(null, { brand_key: 'dahua' }).attrs).toEqual({ brand: 'dahua' });
    expect(m('lighting', { brand_key: 'fa:پارس', watts: 50 }).attrs).toEqual({ brand: 'fa:پارس', power_w: 50 });
  });

  it('cctv_camera: mp, signal (incl. analog family), form; ptz => form ptz', () => {
    expect(m('cctv_camera', { mp: 2, signal: 'hdcvi', form: 'bullet' }).attrs).toEqual({ resolution_mp: 2, camera_signal: 'hdcvi', camera_form: 'bullet' });
    expect(m('cctv_camera', { signal: 'analog' }).attrs).toEqual({ camera_signal: 'analog' });
    expect(m('cctv_camera', { ptz: true, mp: 4 }).attrs).toEqual({ resolution_mp: 4, camera_form: 'ptz' });
    expect(m('cctv_camera', { signal: 'cvbs', form: 'turret', wifi: true }).attrs).toEqual({});
    // a model-code-derived value is still the listing's own text (kept)
    expect(m('cctv_camera', { mp: 2, _src: { mp: 'model_code' } }).attrs).toEqual({ resolution_mp: 2 });
  });

  it('recorder: kind and channels; spec-only channels never reach evaluation', () => {
    expect(m('recorder', { kind: 'xvr', channels: 8 }).attrs).toEqual({ recorder_kind: 'xvr', channels: 8 });
    const spec = m('recorder', { kind: 'nvr', channels: 16, _src: { channels: 'spec' } });
    expect(spec.attrs).toEqual({ recorder_kind: 'nvr' });
    expect(spec.specAttrs).toEqual({ channels: 16 });
    expect(m('recorder', { kind: 'hvr', channels: 4.5 }).attrs).toEqual({});
  });

  it('hdd: capacity and the surveillance flag (true and false are both listing facts)', () => {
    expect(m('hdd', { tb: 0.5, surveillance: false, line: 'blue' }).attrs).toEqual({ capacity_tb: 0.5, hdd_surveillance: false });
    expect(m('hdd', { tb: 2, surveillance: true }).attrs).toEqual({ capacity_tb: 2, hdd_surveillance: true });
  });

  it('adapter: volts/amps; an adjustable adapter has neither', () => {
    expect(m('adapter', { volts: 12, amps: 2, watts: 24 }).attrs).toEqual({ voltage_v: 12, current_a: 2, power_w: 24 });
    expect(m('adapter', { variable: true, volts: 12, amps: 1 }).attrs).toEqual({});
    expect(m('adapter', { volts: 12, amps: 5, _src: { volts: 'spec', amps: 'spec' } })).toMatchObject({ attrs: {}, specAttrs: { voltage_v: 12, current_a: 5 } });
  });

  it('wire: section, cores, sale unit roll100 -> roll, meter -> meter, other -> unknown', () => {
    expect(m('wire', { section_mm2: 2.5, cores: 3, sale_unit: 'roll100', roll_m: 100 }).attrs).toEqual({
      wire_section_mm2: 2.5,
      wire_cores: 3,
      sale_unit: 'roll',
      length_m: 100,
    });
    expect(m('wire', { section_mm2: 1.5, sale_unit: 'meter' }).attrs).toEqual({ wire_section_mm2: 1.5, sale_unit: 'meter' });
    expect(m('wire', { section_mm2: 1.5, sale_unit: 'other', roll_m: 50 }).attrs).toEqual({ wire_section_mm2: 1.5, length_m: 50 });
    expect(m('wire', { sale_unit: 'meter', _src: { sale_unit: 'spec' } }).attrs).toEqual({});
  });

  it('phone and accessories share ONE lower-case device-model convention', () => {
    expect(m('phone', { model_key: 'galaxy a56 5g', storage_gb: 256, ram_gb: 8, network: '5g' }).attrs).toEqual({
      phone_model: 'galaxy a56 5g',
      storage_gb: 256,
      ram_gb: 8,
    });
    expect(m('phone_accessory', { fits_models: ['Galaxy A56', 'iphone 15 pro'] }).attrs).toEqual({ fits_models: ['galaxy a56', 'iphone 15 pro'] });
    expect(m('phone_accessory', { fits_models: [] }).attrs).toEqual({});
    expect(m('phone_accessory', { fits_models: ['galaxy a56'], _src: { fits_models: 'model_field' } }).attrs).toEqual({ fits_models: ['galaxy a56'] });
  });

  it('non-engine listing facts are kept as display flags', () => {
    expect(m('phone', { model_key: 'galaxy a56', condition: 'used', replica: true }).flags).toEqual({ condition: 'used', replica: true });
  });

  it('stated-spec attributes (audit F3): power, power-bank capacity, wire strand; headphones keep only the brand', () => {
    expect(m('charger', { brand_key: 'anker', watts: 20 }).attrs).toEqual({ brand: 'anker', power_w: 20 });
    expect(m('power_bank', { mah: 20000 }).attrs).toEqual({ capacity_mah: 20000 });
    expect(m('wire', { section_mm2: 4, strand: 'solid' }).attrs).toEqual({ wire_section_mm2: 4, wire_strand: 'solid' });
    expect(m('wire', { strand: 'twisted' }).attrs).toEqual({});
    expect(m('headphones', { brand_key: 'qcy', wireless: true }).attrs).toEqual({ brand: 'qcy' });
  });
});

describe('row adapters', () => {
  it('hours: unknown stays unknown, [] is closed, malformed days are dropped (never closed)', () => {
    expect(parseHours(null)).toBeNull();
    expect(parseHours('not json')).toBeNull();
    expect(parseHours('{"sat":[[540,1140]],"fri":[]}')).toEqual({ sat: [[540, 1140]], fri: [] });
    expect(parseHours('{"sat":[["x",1]],"sun":[[600,1200]]}')).toEqual({ sun: [[600, 1200]] });
    expect(parseHours('{"foo":[[1,2]]}')).toBeNull();
  });

  it('offers: a NULL / non-positive price is «no price», never 0', () => {
    const base = { id: 1, product_id: 2, shop_id: 's', price_flag: null, seller_title: null, warranty_code: null, warranty_months: null, changed_at: null };
    expect(toOffer({ ...base, price: null, price_flag: 'placeholder' })).toMatchObject({ price: null, priceFlag: 'placeholder' });
    expect(toOffer({ ...base, price: 0 }).price).toBeNull();
    expect(toOffer({ ...base, price: 120_000 }).price).toBe(120_000);
  });

  it('candidate: attrs mapped by products.domain, _src stripped, codes parsed', () => {
    const c = toCandidate(
      { id: 7, title: 't', category_id: 3, brand: 'داهوا', image_url: null, attrs: '{"brand_key":"dahua","kind":"xvr","_src":{"kind":"model_code"}}', model_codes: '["XVR1B04I"]', min_price: 1, offer_count: 1, seller_count: 1, domain: 'recorder' },
      [],
    );
    expect(c.attrs).toEqual({ brand: 'dahua', recorder_kind: 'xvr' });
    expect(c.product.modelCodes).toEqual(['XVR1B04I']);
    expect(c.brandDisplay).toBe('داهوا');
    expect('_src' in c.attrs).toBe(false);
  });
});
