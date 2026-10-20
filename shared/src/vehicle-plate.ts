/**
 * How a driver's car and its plates are described: where the car is registered,
 * how many plates it carries, and the format of each plate. The rules follow
 * Master Travel's driver app (see docs/REUSE.md). No zod here, so the web app
 * can import this file on its own.
 */

/** 車輛歸屬地: where the car is registered. */
export const VEHICLE_OWNERSHIPS = ['HK', 'MACAU', 'MAINLAND'] as const;
export type VehicleOwnership = (typeof VEHICLE_OWNERSHIPS)[number];
export const OWNERSHIP_NAMES: Record<VehicleOwnership, string> = { HK: '香港', MACAU: '澳門', MAINLAND: '中國內地' };

/** 車牌類型: one plate, two (兩地牌) or three (三地牌). */
export const PLATE_TYPES = ['SINGLE', 'DUAL', 'TRIPLE'] as const;
export type PlateType = (typeof PLATE_TYPES)[number];
export const PLATE_TYPE_NAMES: Record<PlateType, string> = { SINGLE: '單牌', DUAL: '兩地牌', TRIPLE: '三地牌' };

export type PlateField = 'hkPlate' | 'macauPlate' | 'mainlandPlate';
export const PLATE_FIELD_NAMES: Record<PlateField, string> = { hkPlate: '香港車牌', macauPlate: '澳門車牌', mainlandPlate: '內地車牌' };

export interface VehiclePlates {
  vehicleOwnership: VehicleOwnership;
  plateType: PlateType;
  hkPlate?: string | null;
  macauPlate?: string | null;
  mainlandPlate?: string | null;
}

/** A mainland-registered car that crosses the border always carries two plates. */
export function plateTypesFor(ownership: VehicleOwnership): readonly PlateType[] {
  return ownership === 'MAINLAND' ? ['DUAL'] : PLATE_TYPES;
}

/** The plates to ask for, in the order shown. Only a Hong Kong car's Macau plate is optional. */
export function plateFieldsFor(ownership: VehicleOwnership, plateType: PlateType): { field: PlateField; required: boolean }[] {
  const ask = (field: PlateField, required = true) => ({ field, required });
  if (ownership === 'MAINLAND') return [ask('mainlandPlate'), ask('hkPlate')];
  if (plateType === 'TRIPLE') return [ask('hkPlate'), ask('macauPlate', ownership !== 'HK'), ask('mainlandPlate')];
  const local = ask(ownership === 'HK' ? 'hkPlate' : 'macauPlate');
  return plateType === 'DUAL' ? [local, ask('mainlandPlate')] : [local];
}

/** Letters, digits and spaces; at most 8 characters besides the spaces. */
export function formatHongKongPlateInput(value: string): string {
  let count = 0;
  return [...value.toUpperCase()]
    .filter((character) => {
      if (character === ' ') return true;
      if (!/[A-Z0-9]/.test(character) || count === 8) return false;
      count += 1;
      return true;
    })
    .join('');
}

/** Two letters and four digits, shown as AA-00-00. */
export function formatMacauPlateInput(value: string): string {
  let kept = '';
  for (const character of value.toUpperCase().replace(/[^A-Z0-9]/g, '')) {
    if ((kept.length < 2 ? /[A-Z]/ : /[0-9]/).test(character)) kept += character;
    if (kept.length === 6) break;
  }
  return [kept.slice(0, 2), kept.slice(2, 4), kept.slice(4, 6)].filter(Boolean).join('-');
}

const normalizeMainland = (value: string) =>
  value
    .trim()
    .replace(/\s/g, '')
    .replace(/粤/g, '粵')
    .replace(/[•・.]/g, '·')
    .toUpperCase();

/** What the driver types between the fixed parts: "粵Z·AB123港" is entered as "AB123". */
export function mainlandPlateInput(value: string, ownership: VehicleOwnership): string {
  const plate = normalizeMainland(value);
  if (ownership === 'MAINLAND') return plate.replace(/^粵/, '');
  const suffix = ownership === 'HK' ? '港' : '澳';
  return plate.replace(/^粵Z·?/, '').replace(new RegExp(`${suffix}$`), '');
}

/** The whole plate from what the driver typed: 粵Z·…港, 粵Z·…澳, or 粵A·… for a mainland car. */
export function composeMainlandPlate(value: string, ownership: VehicleOwnership): string {
  const input = mainlandPlateInput(value, ownership);
  if (!input) return '';
  if (ownership === 'HK') return `粵Z·${input}港`;
  if (ownership === 'MACAU') return `粵Z·${input}澳`;
  // 粵B12345 and 粵B·12345 are the same plate; keep the one form.
  return `粵${input.replace(/^([A-Z])·?/, '$1·')}`;
}

/** The plates as stored: upper case, fixed formats, and no plate the car's type does not carry. */
export function normalizeVehiclePlates(input: VehiclePlates): Record<PlateField, string> {
  const asked = new Set(plateFieldsFor(input.vehicleOwnership, input.plateType).map((entry) => entry.field));
  return {
    hkPlate: asked.has('hkPlate') ? (input.hkPlate ?? '').trim().toUpperCase() : '',
    macauPlate: asked.has('macauPlate') ? formatMacauPlateInput(input.macauPlate ?? '') : '',
    mainlandPlate: asked.has('mainlandPlate') ? composeMainlandPlate(input.mainlandPlate ?? '', input.vehicleOwnership) : '',
  };
}

export type VehiclePlateError =
  | 'PLATE_TYPE_NOT_ALLOWED'
  | 'PLATE_REQUIRED'
  | 'HK_PLATE_INVALID'
  | 'MACAU_PLATE_INVALID'
  | 'MAINLAND_PLATE_INVALID';

/** Checks plates already passed through normalizeVehiclePlates; null when they are fine. */
export function vehiclePlateError(input: VehiclePlates): VehiclePlateError | null {
  if (!plateTypesFor(input.vehicleOwnership).includes(input.plateType)) return 'PLATE_TYPE_NOT_ALLOWED';
  const hk = input.hkPlate ?? '';
  const macau = input.macauPlate ?? '';
  const mainland = input.mainlandPlate ?? '';
  if (hk && (!/^[A-Z0-9 ]+$/.test(hk) || hk.replace(/ /g, '').length > 8)) return 'HK_PLATE_INVALID';
  if (macau && !/^[A-Z]{2}-[0-9]{2}-[0-9]{2}$/.test(macau)) return 'MACAU_PLATE_INVALID';
  const pattern = { HK: /^粵Z·\S+港$/, MACAU: /^粵Z·\S+澳$/, MAINLAND: /^粵[A-Z]·\S+$/ }[input.vehicleOwnership];
  if (mainland && !pattern.test(mainland)) return 'MAINLAND_PLATE_INVALID';
  const values = { hkPlate: hk, macauPlate: macau, mainlandPlate: mainland };
  const missing = plateFieldsFor(input.vehicleOwnership, input.plateType).some((entry) => entry.required && !values[entry.field]);
  return missing ? 'PLATE_REQUIRED' : null;
}

/**
 * For a profile saved before these choices existed: the ownership and plate
 * type that fit the plates it has, so the form opens on something sensible.
 */
export function inferVehiclePlates(plates: { hkPlate?: string | null; macauPlate?: string | null; mainlandPlate?: string | null }): {
  vehicleOwnership: VehicleOwnership;
  plateType: PlateType;
} {
  const mainland = normalizeMainland(plates.mainlandPlate ?? '');
  const vehicleOwnership: VehicleOwnership =
    mainland.endsWith('澳') || (plates.macauPlate && !plates.hkPlate)
      ? 'MACAU'
      : mainland && !/^粵Z/.test(mainland) && !mainland.endsWith('港')
        ? 'MAINLAND'
        : 'HK';
  if (vehicleOwnership === 'MAINLAND') return { vehicleOwnership, plateType: 'DUAL' };
  const count = [plates.hkPlate, plates.macauPlate, plates.mainlandPlate].filter(Boolean).length;
  const plateType: PlateType = plates.hkPlate && plates.macauPlate ? 'TRIPLE' : mainland || count === 0 ? 'DUAL' : 'SINGLE';
  return { vehicleOwnership, plateType };
}

/**
 * The places a car's plates are from, never the numbers: 「香港」, 「澳門」, and the mainland plate's
 * prefix (「粵Z」 for a cross-border car, 「粵A」 for a mainland one). For the brand band on a 名片頁
 * preview and 名片圖, drawn like the plates themselves (docs/DESIGN.md, 車牌顯示).
 */
export function plateRegions(plates: { hkPlate?: string | null; macauPlate?: string | null; mainlandPlate?: string | null }): string[] {
  const regions: string[] = [];
  if (plates.hkPlate) regions.push('香港');
  if (plates.macauPlate) regions.push('澳門');
  const prefix = plates.mainlandPlate?.split('·')[0];
  if (prefix && /^粵[A-Z]$/.test(prefix)) regions.push(prefix);
  return regions;
}
