/** Same as MAX_JOURNEY_LEGS in shared/src/schemas.ts (not imported, to keep zod out of the bundle). */
export const MAX_JOURNEY_LEGS = 2;

export interface LegDriver {
  name: string | null;
  hkPlate: string | null;
  macauPlate: string | null;
  mainlandPlate: string | null;
  plateType?: 'SINGLE' | 'DUAL' | 'TRIPLE' | null;
  vehicleType: string | null;
  color: string | null;
  /** Null until this order's contact reveal time (other legs' drivers). */
  phone: string | null;
}

export interface JourneyLeg {
  legIndex: number;
  status: string;
  pickupAt: string;
  origin: string;
  destination: string;
  /** The leg's own claim code: the one link in the group offers both legs. */
  code: string;
  requiredPlates: PlateRegion[];
  driverPrice: { amount: number; currency: string } | null;
  /** The signed-in user holds this leg. */
  mine: boolean;
  /** The dispatcher drives this leg themselves (這段我自己做). */
  selfDrive: boolean;
  /** Only for the dispatcher. */
  id?: string;
  /** Only for the dispatcher and this leg's driver. */
  driver?: LegDriver | null;
}

/** 接駁: the order around a leg, as the API returns it: one order from origin to destination in two legs. */
export interface Journey {
  legIndex: number;
  legCount: number;
  /** The whole order's status: open while either leg still waits for a driver. */
  status: string;
  origin: string;
  destination: string;
  /** 接駁位置: where this order's car meets the car of the leg before or after it. */
  transferPlaces: string[];
  legs: JourneyLeg[];
}

/** "第 2／2 段", or "第 1 段" while the trip's other legs are still to be added. */
export const legLabel = (journey: { legIndex: number; legCount: number }) =>
  journey.legCount > 1 ? `第 ${journey.legIndex}／${journey.legCount} 段` : `第 ${journey.legIndex} 段`;

/** Same as PLATE_REGIONS in shared/src/schemas.ts. */
export type PlateRegion = 'HK' | 'MACAU' | 'MAINLAND';
export const PLATE_NAMES: Record<PlateRegion, string> = { HK: '香港', MACAU: '澳門', MAINLAND: '內地' };

/** "需澳門車" or "需香港＋澳門車牌", as in the group text; empty when the order asks for no plate. */
export function plateRequirement(plates: PlateRegion[] | undefined): string {
  if (!plates || plates.length === 0) return '';
  const names = plates.map((plate) => PLATE_NAMES[plate]);
  return names.length === 1 ? `需${names[0]}車` : `需${names.join('＋')}車牌`;
}
