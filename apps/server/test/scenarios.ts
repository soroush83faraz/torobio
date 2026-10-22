/**
 * Request builders for API scenario tests (wire RequirementState as the web app sends it).
 * Chips carry the machine constraint the parser would attach; ids are short and stable.
 */
import type { Api } from '@app/core';

type Chip = Api.RequirementChip;
type Req = Api.Requirement;

export const chip = (key: string, label: string, constraint?: Api.ConstraintDto): Chip =>
  constraint ? { key, label, constraint } : { key, label };

export function item(id: string, text: string, opts: Partial<Req> = {}): Req {
  return { id, text, qty: 1, categoryId: null, categoryLabel: '', chips: [], ...opts };
}

export function state(requirements: Req[], extra: Partial<Api.RequirementState> = {}): Api.RequirementState {
  return {
    requirements,
    answers: {},
    settled: {},
    pins: {},
    shopPins: {},
    excludedShops: {},
    variant: null,
    visit: { day: 'today', window: 'any' },
    ...extra,
  };
}

/** The CCTV job: 4 Dahua 2MP cameras + a 4-channel recorder + a 2TB drive + a 12V adapter. */
export function cctvJob(cat: { camera: number; recorder: number; hdd: number; adapter: number }): Api.RequirementState {
  return state([
    item('cam', '۴ دوربین داهوا ۲ مگاپیکسل', {
      qty: 4,
      qtyStated: true,
      categoryIds: [cat.camera],
      chips: [
        chip('brand', 'داهوا', { attr: 'brand', op: 'eq', value: 'dahua' }),
        chip('mp', '۲ مگاپیکسل', { attr: 'resolution_mp', op: 'eq', value: 2 }),
      ],
    }),
    item('rec', 'ضبط‌کننده ۴ کانال', {
      categoryIds: [cat.recorder],
      chips: [chip('channels', '۴ کانال', { attr: 'channels', op: 'eq', value: 4 })],
    }),
    item('hdd', 'هارد ۲ ترابایت', {
      categoryIds: [cat.hdd],
      chips: [chip('tb', '۲ ترابایت', { attr: 'capacity_tb', op: 'eq', value: 2 })],
    }),
    item('adp', 'آداپتور ۱۲ ولت', {
      categoryIds: [cat.adapter],
      chips: [chip('v', '۱۲ ولت', { attr: 'voltage_v', op: 'eq', value: 12 })],
    }),
  ]);
}
