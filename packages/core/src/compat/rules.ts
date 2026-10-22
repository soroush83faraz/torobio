/**
 * Declarative compatibility rules. Only two domains have rules: CCTV and phone accessories.
 *
 * Each rule may
 *  - derive constraints for sibling items, from STATED requirements only (source user/answer, stated qty);
 *    never from a picked product;
 *  - report compatibility-critical unknowns (priority-1 questions);
 *  - evaluate the final chosen products into findings with a status that is data, not a verdict:
 *    listing_stated (read from the listing) · assumed (general rule we encode, never verified) ·
 *    unknown (attribute missing) · conflict (the listing contradicts the requirement or the general rule).
 */
import { compatCopy } from '../copy/fa';
import { deviceModelsMatch } from '../requirement/evaluate';
import {
  ANALOG_SIGNALS,
  type CameraSignal,
  type CompatBasis,
  type CompatFinding,
  type CompatRuleId,
  type AttrKey,
  type CompatStatus,
  type Constraint,
  type CriticalUnknown,
  type DerivedConstraint,
  type ItemKind,
  type ProductAttrs,
  type RecorderKind,
  type Requirement,
} from '../types/index';

/** A requirement plus the attributes of the product finally chosen for it (null = nothing chosen). */
export interface ChosenItem {
  item: Requirement;
  productId?: number;
  attrs: ProductAttrs | null;
}

export interface CompatRule {
  id: CompatRuleId;
  domain: 'cctv' | 'phone' | 'wire';
  relationship: string;
  kinds: readonly ItemKind[];
  /** Developer description (English). */
  description: string;
  derive?: (items: readonly Requirement[]) => DerivedConstraint[];
  critical?: (items: readonly Requirement[]) => CriticalUnknown[];
  evaluate: (chosen: readonly ChosenItem[]) => CompatFinding[];
  /**
   * Plan guard (compat/index.ts `compatRepairs`): for a 'conflict' finding on the picked products, constraints for
   * the automatically picked side(s) that make the same conflict impossible on the next pass (the products that
   * would repeat it become 'differs' with the reason). Only items for which `isAuto` is true are constrained: what
   * the user pinned or typed as a model code is never overridden.
   */
  repair?: (finding: CompatFinding, chosen: readonly ChosenItem[], canChange: (itemId: string) => boolean) => DerivedConstraint[];
  /** Index in `finding.itemIds` of the item the rule constrains (the side to change first). Default 0. */
  dependentIndex?: number;
  /**
   * The attribute that links an item of this kind to the rule. An automatic pick whose linking attribute the user
   * stated is not changeable by the guard: it only does what the user asked (a conflict between two statements, or
   * a statement and a pin, stays visible). Kinds without an entry are never changed by this rule.
   */
  linkAttr?: Partial<Record<ItemKind, AttrKey>>;
}

/**
 * Items of a finding the plan guard may change: automatically picked, of a kind the rule links, and whose linking
 * attribute the user did not state.
 */
export function changeableItems(rule: CompatRule, f: CompatFinding, chosen: readonly ChosenItem[], isAuto: (itemId: string) => boolean): string[] {
  return f.itemIds.filter((id) => {
    if (!isAuto(id)) return false;
    const item = chosen.find((c) => c.item.id === id)?.item;
    const attr = item?.kind ? rule.linkAttr?.[item.kind] : undefined;
    return !!item && !!attr && constraintsOn(item, attr, true).length === 0;
  });
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

const ofKind = <T extends { kind?: ItemKind }>(xs: readonly T[], k: ItemKind) => xs.filter((x) => x.kind === k);
const chosenOfKind = (xs: readonly ChosenItem[], k: ItemKind) => xs.filter((x) => x.item.kind === k);
const isStated = (c: Constraint) => c.source === 'user' || c.source === 'answer';

function constraintsOn(item: Requirement, attr: Constraint['attr'], statedOnly: boolean): Constraint[] {
  return item.constraints.filter((c) => c.attr === attr && (!statedOnly || isStated(c)));
}

/** Signals a camera item is stated to have (eq / in on camera_signal), or null when not stated. */
function statedSignals(item: Requirement): CameraSignal[] | null {
  const cs = constraintsOn(item, 'camera_signal', true);
  if (cs.length === 0) return null;
  const out = new Set<CameraSignal>();
  for (const c of cs) {
    if (c.op === 'eq') out.add(String(c.value).toLowerCase() as CameraSignal);
    else if (c.op === 'in') for (const v of c.values) out.add(String(v).toLowerCase() as CameraSignal);
  }
  return out.size ? [...out].sort() : null;
}

const isAnalog = (s: string) => (ANALOG_SIGNALS as readonly string[]).includes(s);

function finding(
  ruleId: CompatRuleId,
  relationship: string,
  itemIds: string[],
  status: CompatStatus,
  basis: CompatBasis,
  sentence: string,
  askSeller?: string,
): CompatFinding {
  const f: CompatFinding = { ruleId, relationship, itemIds, status, basis, sentence };
  if (askSeller !== undefined) f.askSeller = askSeller;
  return f;
}

const ACCESSORY_KINDS: readonly ItemKind[] = ['phone_case', 'screen_protector'];
const isAccessory = (k: ItemKind | undefined) => !!k && ACCESSORY_KINDS.includes(k);

/** Recorder kinds a camera signal connects to under the general rule (camera -> recorder, as `derive` does). */
function kindsForSignal(s: string): RecorderKind[] {
  return isAnalog(s) ? ['xvr', 'dvr'] : ['nvr'];
}

/** Camera signals a recorder kind accepts under the general rule (IP on an XVR is an «assumed» pairing, not a conflict). */
function signalsForKind(k: string): CameraSignal[] {
  if (k === 'nvr') return ['ip'];
  if (k === 'xvr') return [...ANALOG_SIGNALS, 'ip'];
  return [...ANALOG_SIGNALS];
}

/** The signal family of a camera signal: every analog signal, or IP. */
function signalFamily(s: string): CameraSignal[] {
  return isAnalog(s) ? [...ANALOG_SIGNALS] : ['ip'];
}

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

function guard(itemId: string, constraint: DistributiveOmit<Constraint, 'source'>, ruleId: CompatRuleId, fromItemId?: string): DerivedConstraint {
  const c = { ...constraint, source: 'compat', ruleId } as Constraint;
  if (fromItemId) c.fromItemId = fromItemId;
  return { itemId, constraint: c };
}

/** Voltage constraints the user stated (typed or answered) on an adapter item. */
const statedVoltage = (a: Requirement) => constraintsOn(a, 'voltage_v', true);
/** «فرقی نمی‌کند» on the adapter-voltage question lifts the 12 V assumption (a known voltage is still required). */
const voltageRelaxed = (a: Requirement) => (a.skippedQuestions ?? []).includes('voltage_v');

/** Phone-model token stated on a phone item (eq on phone_model). */
function statedPhoneModel(phone: Requirement): string | null {
  const c = constraintsOn(phone, 'phone_model', true).find((x) => x.op === 'eq');
  return c && c.op === 'eq' ? String(c.value) : null;
}

// ---------------------------------------------------------------------------
// the table
// ---------------------------------------------------------------------------

export const COMPAT_RULES: readonly CompatRule[] = [
  {
    id: 'recorder_channels',
    domain: 'cctv',
    relationship: 'recorder.channels>=sum(camera.qty)',
    kinds: ['recorder', 'camera'],
    description:
      'Recorder channels must be >= total camera quantity. Derived only from stated camera quantities; evaluated from the channels read from the recorder listing.',
    derive(items) {
      const cams = ofKind(items, 'camera');
      const q = cams.reduce((s, c) => s + (c.qtyStated ? c.qty : 0), 0);
      if (q < 1) return [];
      const from = cams.filter((c) => c.qtyStated).map((c) => c.id)[0];
      const out: DerivedConstraint[] = [];
      for (const r of ofKind(items, 'recorder')) {
        const stated = constraintsOn(r, 'channels', true);
        const alreadyImplied = stated.some((c) => (c.op === 'eq' || c.op === 'gte') && Number(c.value) >= q);
        if (alreadyImplied) continue;
        const constraint: Constraint = { attr: 'channels', op: 'gte', value: q, source: 'compat', ruleId: 'recorder_channels' };
        if (from) constraint.fromItemId = from;
        out.push({ itemId: r.id, constraint });
      }
      return out;
    },
    evaluate(chosen) {
      const cams = chosenOfKind(chosen, 'camera');
      const q = cams.reduce((s, c) => s + c.item.qty, 0);
      if (q < 1) return [];
      const ids = cams.map((c) => c.item.id);
      return chosenOfKind(chosen, 'recorder')
        .filter((r) => r.attrs)
        .map((r) => {
          const ch = r.attrs?.channels;
          const itemIds = [r.item.id, ...ids];
          if (typeof ch !== 'number')
            return finding('recorder_channels', this.relationship, itemIds, 'unknown', 'missing', compatCopy.channelsUnknown(q), compatCopy.channelsUnknownAsk(q));
          if (ch >= q) return finding('recorder_channels', this.relationship, itemIds, 'listing_stated', 'listing', compatCopy.channelsOk(ch, q));
          return finding('recorder_channels', this.relationship, itemIds, 'conflict', 'listing', compatCopy.channelsTooFew(ch, q), compatCopy.channelsTooFewAsk(q));
        });
    },
    linkAttr: { recorder: 'channels' },
    repair(f, chosen, canChange) {
      const rec = f.itemIds[0]!;
      if (!canChange(rec)) return [];
      const q = chosenOfKind(chosen, 'camera').reduce((s, c) => s + c.item.qty, 0);
      return q >= 1 ? [guard(rec, { attr: 'channels', op: 'gte', value: q }, 'recorder_channels', f.itemIds[1])] : [];
    },
  },
  {
    id: 'camera_recorder_signal',
    domain: 'cctv',
    relationship: 'camera.signal~recorder.kind',
    kinds: ['camera', 'recorder'],
    description:
      'General rule (assumed, never verified): analog cameras (AHD/HDCVI/TVI/CVBS) connect to XVR/DVR, IP cameras to NVR. Derives the recorder kind from a stated camera signal (camera -> recorder only).',
    derive(items) {
      const cams = ofKind(items, 'camera');
      if (cams.length === 0) return [];
      const stated = cams.map((c) => ({ id: c.id, sig: statedSignals(c) })).filter((x) => x.sig !== null);
      const all = stated.flatMap((x) => x.sig ?? []);
      let kinds: RecorderKind[] | null = null;
      if (stated.length && all.every(isAnalog)) kinds = ['xvr', 'dvr'];
      else if (stated.length && all.every((s) => s === 'ip')) kinds = ['nvr'];
      const from = (stated[0] ?? { id: cams[0]!.id }).id;
      const out: DerivedConstraint[] = [];
      for (const r of ofKind(items, 'recorder')) {
        if (constraintsOn(r, 'recorder_kind', true).length) continue;
        // with cameras in the list the rule needs the recorder kind: unreadable kind = never auto-picked
        const constraint: Constraint = kinds
          ? { attr: 'recorder_kind', op: 'in', values: kinds, source: 'compat', ruleId: 'camera_recorder_signal', fromItemId: from }
          : { attr: 'recorder_kind', op: 'known', source: 'compat', ruleId: 'camera_recorder_signal', fromItemId: from };
        out.push({ itemId: r.id, constraint });
      }
      return out;
    },
    critical(items) {
      const cams = ofKind(items, 'camera');
      if (cams.length === 0) return [];
      if (cams.some((c) => statedSignals(c) !== null)) return [];
      return ofKind(items, 'recorder')
        .filter((r) => constraintsOn(r, 'recorder_kind', false).every((c) => c.op === 'known'))
        .map((r) => ({ itemId: r.id, ruleId: 'camera_recorder_signal' as const, attr: 'recorder_kind' as const, relatedItemIds: cams.map((c) => c.id) }));
    },
    evaluate(chosen) {
      const out: CompatFinding[] = [];
      const recs = chosenOfKind(chosen, 'recorder').filter((r) => r.attrs);
      for (const cam of chosenOfKind(chosen, 'camera').filter((c) => c.attrs)) {
        for (const rec of recs) {
          const s = cam.attrs?.camera_signal;
          const k = rec.attrs?.recorder_kind;
          const ids = [cam.item.id, rec.item.id];
          const rel = this.relationship;
          if (!s && !k) out.push(finding(this.id, rel, ids, 'unknown', 'missing', compatCopy.signalBothUnknown(), compatCopy.signalBothUnknownAsk()));
          else if (!s && k) out.push(finding(this.id, rel, ids, 'unknown', 'missing', compatCopy.signalCameraUnknown(k), compatCopy.signalCameraUnknownAsk(k)));
          else if (s && !k) out.push(finding(this.id, rel, ids, 'unknown', 'missing', compatCopy.signalRecorderUnknown(s), compatCopy.signalAsk(s)));
          else if (s && k) {
            const analog = isAnalog(s);
            if ((analog && (k === 'xvr' || k === 'dvr')) || (s === 'ip' && k === 'nvr'))
              out.push(finding(this.id, rel, ids, 'assumed', 'general_rule', compatCopy.signalAssumed(s, k), compatCopy.signalAsk(s)));
            else if (s === 'ip' && k === 'xvr')
              out.push(finding(this.id, rel, ids, 'assumed', 'general_rule', compatCopy.signalIpOnXvr(), compatCopy.signalAsk(s)));
            else out.push(finding(this.id, rel, ids, 'conflict', 'general_rule', compatCopy.signalConflict(s, k), compatCopy.signalAsk(s)));
          }
        }
      }
      return out;
    },
    // itemIds = [camera, recorder]: the recorder follows the cameras (as derive does)
    dependentIndex: 1,
    linkAttr: { camera: 'camera_signal', recorder: 'recorder_kind' },
    repair(f, chosen, canChange) {
      const [camId, recId] = f.itemIds as [string, string];
      const s = chosen.find((c) => c.item.id === camId)?.attrs?.camera_signal;
      const k = chosen.find((c) => c.item.id === recId)?.attrs?.recorder_kind;
      if (!s || !k) return [];
      const autoCams = chosenOfKind(chosen, 'camera').filter((c) => canChange(c.item.id));
      if (canChange(recId)) {
        // the recorder follows the picked camera; auto-picked cameras stay in that camera's signal family
        return [
          guard(recId, { attr: 'recorder_kind', op: 'in', values: kindsForSignal(s) }, this.id, camId),
          ...autoCams.map((c) => guard(c.item.id, { attr: 'camera_signal', op: 'in', values: signalFamily(s) }, this.id, recId)),
        ];
      }
      // the recorder was chosen by the user: the auto-picked cameras follow it
      return autoCams.map((c) => guard(c.item.id, { attr: 'camera_signal', op: 'in', values: signalsForKind(k) }, this.id, recId));
    },
  },
  {
    id: 'recorder_hdd_internal',
    domain: 'cctv',
    relationship: 'recorder.needs(internal_sata_hdd)',
    kinds: ['recorder', 'hdd'],
    description: 'General rule (assumed): a recorder needs an internal SATA drive to store footage.',
    evaluate(chosen) {
      const hasHdd = chosen.some((c) => c.item.kind === 'hdd');
      return chosenOfKind(chosen, 'recorder')
        .filter((r) => r.attrs)
        .map((r) =>
          finding(this.id, this.relationship, [r.item.id, ...chosenOfKind(chosen, 'hdd').map((h) => h.item.id)], 'assumed', 'general_rule', compatCopy.hddInternal(hasHdd), compatCopy.hddInternalAsk()),
        );
    },
  },
  {
    id: 'hdd_surveillance',
    domain: 'cctv',
    relationship: 'hdd.surveillance_grade',
    kinds: ['hdd'],
    description: 'Surveillance flag read from the HDD listing (purple/skyhawk/surveillance) = listing_stated; otherwise unknown. Only in a CCTV list.',
    evaluate(chosen) {
      const cctv = chosen.some((c) => c.item.kind === 'recorder' || c.item.kind === 'camera');
      if (!cctv) return [];
      return chosenOfKind(chosen, 'hdd')
        .filter((h) => h.attrs)
        .map((h) =>
          h.attrs?.hdd_surveillance === true
            ? finding(this.id, this.relationship, [h.item.id], 'listing_stated', 'listing', compatCopy.hddSurveillanceStated())
            : finding(this.id, this.relationship, [h.item.id], 'unknown', 'missing', compatCopy.hddSurveillanceUnknown(), compatCopy.hddSurveillanceAsk()),
        );
    },
  },
  {
    id: 'camera_adapter_12v',
    domain: 'cctv',
    relationship: 'adapter.voltage==12V',
    kinds: ['adapter', 'camera'],
    description:
      'General rule (assumed, never verified): cameras usually run on a 12 V adapter. With cameras in the list, an adapter whose voltage the user did not state gets a derived voltage = 12 (so a listing stating another voltage is «differs» and one without a voltage is «incomplete»: neither is auto-picked), and the voltage is a compat-critical question. «فرقی نمی‌کند» lifts the assumption (derived: voltage known); a voltage the user chose is never a conflict. Evaluation: 12 V listed = assumed; missing = unknown; another voltage the user chose or allowed = unknown; otherwise conflict with the general rule.',
    derive(items) {
      const cams = ofKind(items, 'camera');
      if (cams.length === 0) return [];
      const from = cams[0]!.id;
      return ofKind(items, 'adapter')
        .filter((a) => statedVoltage(a).length === 0)
        .map((a) =>
          guard(a.id, voltageRelaxed(a) ? { attr: 'voltage_v', op: 'known' } : { attr: 'voltage_v', op: 'eq', value: 12 }, 'camera_adapter_12v', from),
        );
    },
    critical(items) {
      const cams = ofKind(items, 'camera');
      if (cams.length === 0) return [];
      return ofKind(items, 'adapter')
        .filter((a) => statedVoltage(a).length === 0)
        .map((a) => ({ itemId: a.id, ruleId: 'camera_adapter_12v' as const, attr: 'voltage_v' as const, relatedItemIds: cams.map((c) => c.id) }));
    },
    evaluate(chosen) {
      const cams = chosenOfKind(chosen, 'camera');
      if (cams.length === 0) return [];
      const camIds = cams.map((c) => c.item.id);
      return chosenOfKind(chosen, 'adapter')
        .filter((a) => a.attrs)
        .map((a) => {
          const v = a.attrs?.voltage_v;
          const ids = [a.item.id, ...camIds];
          if (typeof v !== 'number') return finding(this.id, this.relationship, ids, 'unknown', 'missing', compatCopy.adapterUnknown(), compatCopy.adapterAsk());
          if (Math.abs(v - 12) < 1e-9) return finding(this.id, this.relationship, ids, 'assumed', 'general_rule', compatCopy.adapter12Assumed(), compatCopy.adapterAsk());
          // the user chose (or allowed) another voltage: the 12 V rule is only an assumption, so this is not a conflict;
          // the finding says the assumption was lifted (the plan carries «بدون تأیید سازگاری», never a verified feel)
          const lifted = (sentence: string): CompatFinding => ({
            ...finding(this.id, this.relationship, ids, 'unknown', 'general_rule', sentence, compatCopy.adapterAsk()),
            lifted: true,
          });
          if (statedVoltage(a.item).length > 0) return lifted(compatCopy.adapterUserVoltage(v));
          if (voltageRelaxed(a.item)) return lifted(compatCopy.adapterRelaxed(v));
          return finding(this.id, this.relationship, ids, 'conflict', 'general_rule', compatCopy.adapterConflict(v), compatCopy.adapterAsk());
        });
    },
    linkAttr: { adapter: 'voltage_v' },
    repair(f, _chosen, canChange) {
      const ad = f.itemIds[0]!;
      return canChange(ad) ? [guard(ad, { attr: 'voltage_v', op: 'eq', value: 12 }, 'camera_adapter_12v', f.itemIds[1])] : [];
    },
  },
  {
    id: 'phone_accessory_fit',
    domain: 'phone',
    relationship: 'accessory.fits_models∋phone.model',
    kinds: ['phone_case', 'screen_protector', 'phone'],
    description:
      'An accessory fits when its listing names the phone model token (listing_stated); a different explicit model = conflict (excluded by the derived constraint); no model in the listing = unknown.',
    derive(items) {
      const models = [...new Set(ofKind(items, 'phone').map(statedPhoneModel).filter((m): m is string => !!m))];
      const model = models.length === 1 ? models[0]! : null;
      const phone = model ? ofKind(items, 'phone').find((p) => statedPhoneModel(p) === model) : undefined;
      return items
        .filter((i) => isAccessory(i.kind) && constraintsOn(i, 'fits_models', true).length === 0)
        .map((i) => {
          // a known phone model → the accessory must list it; otherwise the listing must at least name a model
          const constraint: Constraint = model
            ? { attr: 'fits_models', op: 'contains', value: model, source: 'compat', ruleId: 'phone_accessory_fit' }
            : { attr: 'fits_models', op: 'known', source: 'compat', ruleId: 'phone_accessory_fit' };
          if (phone) constraint.fromItemId = phone.id;
          return { itemId: i.id, constraint };
        });
    },
    critical(items) {
      const phones = ofKind(items, 'phone').map((p) => p.id);
      return items
        .filter((i) => isAccessory(i.kind) && constraintsOn(i, 'fits_models', false).every((c) => c.op === 'known'))
        .map((i) => ({ itemId: i.id, ruleId: 'phone_accessory_fit' as const, attr: 'fits_models' as const, relatedItemIds: phones }));
    },
    evaluate(chosen) {
      const phones = chosenOfKind(chosen, 'phone');
      const phoneModels = [...new Set(phones.map((p) => p.attrs?.phone_model).filter((m): m is string => !!m))];
      // one device (network variants of the same model count as one)
      const distinctPhones = phoneModels.filter((m, i) => !phoneModels.slice(0, i).some((o) => deviceModelsMatch(o, m)));
      const out: CompatFinding[] = [];
      for (const acc of chosen.filter((c) => isAccessory(c.item.kind) && c.attrs)) {
        const wanted = acc.item.constraints.find((c) => c.attr === 'fits_models' && c.op === 'contains');
        const target = wanted && wanted.op === 'contains' ? wanted.value : distinctPhones.length === 1 ? distinctPhones[0]! : null;
        const ids = [acc.item.id, ...phones.map((p) => p.item.id)];
        const kind = acc.item.kind;
        const listed = acc.attrs?.fits_models ?? [];
        if (!target) {
          out.push(finding(this.id, this.relationship, ids, 'unknown', 'missing', compatCopy.accessoryPhoneUnknown(kind), compatCopy.accessoryAskGeneric(kind)));
        } else if (listed.length === 0) {
          out.push(finding(this.id, this.relationship, ids, 'unknown', 'missing', compatCopy.accessoryNoModelInListing(kind), compatCopy.accessoryAsk(kind, target)));
        } else if (listed.some((m) => deviceModelsMatch(m, target))) {
          out.push(finding(this.id, this.relationship, ids, 'listing_stated', 'listing', compatCopy.accessoryFits(kind, target)));
        } else {
          out.push(finding(this.id, this.relationship, ids, 'conflict', 'listing', compatCopy.accessoryConflict(kind, listed, target), compatCopy.accessoryAsk(kind, target)));
        }
      }
      return out;
    },
    linkAttr: { phone_case: 'fits_models', screen_protector: 'fits_models', phone: 'phone_model' },
    repair(f, chosen, canChange) {
      const accId = f.itemIds[0]!;
      const acc = chosen.find((c) => c.item.id === accId);
      const phones = chosenOfKind(chosen, 'phone').filter((p) => p.attrs?.phone_model);
      const phone = phones[0];
      if (!acc || !phone?.attrs?.phone_model) return [];
      if (canChange(accId)) return [guard(accId, { attr: 'fits_models', op: 'contains', value: phone.attrs.phone_model }, this.id, phone.item.id)];
      // the accessory was chosen by the user: an auto-picked phone follows the models its listing names
      const listed = acc.attrs?.fits_models ?? [];
      return canChange(phone.item.id) && listed.length ? [guard(phone.item.id, { attr: 'phone_model', op: 'in', values: listed }, this.id, accId)] : [];
    },
  },
  {
    id: 'wire_sale_unit',
    domain: 'wire',
    relationship: 'wire.sale_unit:known',
    kinds: ['wire'],
    description:
      'Unit guard: a roll price and a per-metre price are never compared or totalled together. A wire item needs the sale unit read from the listing (derived known constraint) and a stated unit; the question cannot be skipped.',
    derive(items) {
      return ofKind(items, 'wire')
        .filter((w) => constraintsOn(w, 'sale_unit', true).length === 0)
        .map((w) => ({ itemId: w.id, constraint: { attr: 'sale_unit', op: 'known', source: 'compat', ruleId: 'wire_sale_unit' } as Constraint }));
    },
    critical(items) {
      return ofKind(items, 'wire')
        .filter((w) => !constraintsOn(w, 'sale_unit', true).some((c) => c.op === 'eq' || (c.op === 'in' && c.values.length === 1)))
        .map((w) => ({ itemId: w.id, ruleId: 'wire_sale_unit' as const, attr: 'sale_unit' as const, relatedItemIds: [] }));
    },
    evaluate() {
      return [];
    },
  },
];

/** Compat-critical questions that «فرقی نمی‌کند» / «کافیه، پیشنهاد بده» cannot skip. */
export const MANDATORY_RULES: ReadonlySet<CompatRuleId> = new Set<CompatRuleId>(['wire_sale_unit']);
