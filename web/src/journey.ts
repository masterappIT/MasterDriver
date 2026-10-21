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
  /** 即時單: pickupAt is when it was put out to leave now (only ever the first leg). */
  immediate?: boolean;
  origin: string;
  destination: string;
  /** 往返: this leg's own flight (the way there lands, the way back takes off). */
  flightNo?: string | null;
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
  /** 行程進度 of this leg's driver (dispatcher only). */
  progress?: TripProgress;
  /** 修改行程 this leg's driver has not confirmed yet (dispatcher only). */
  changePending?: boolean;
  /** 司機已刪除 (dispatcher only): this leg's driver was deleted by the platform since. */
  driverDeleted?: boolean;
  /** Only for the dispatcher and this leg's driver. */
  driver?: LegDriver | null;
}

/** 行程進度 as the driver who took the order reported it. */
export interface TripProgress {
  departedAt: string | null;
  arrivedAt: string | null;
  pickedUpAt: string | null;
}

/** The steps a driver reports, in order, with how they read. */
export const PROGRESS_STEPS = [
  { step: 'DEPARTED', field: 'departedAt', label: '已出發' },
  { step: 'ARRIVED', field: 'arrivedAt', label: '已到上車點' },
  { step: 'PICKED_UP', field: 'pickedUpAt', label: '乘客已上車' },
] as const;

/** "13:50 已出發・14:20 已到上車點": the steps reported so far, each with its time; empty before the first. */
export function progressLine(progress: TripProgress | null | undefined, time: (iso: string) => string): string {
  if (!progress) return '';
  return PROGRESS_STEPS.filter((one) => progress[one.field])
    .map((one) => `${time(progress[one.field] as string)} ${one.label}`)
    .join('・');
}

/**
 * The order around a leg, as the API returns it: one order in two legs. 接駁 runs from origin to
 * destination changing cars on the way; 往返 goes from origin to destination and comes back.
 */
export interface Journey {
  /** TRANSFER (接駁) or ROUND_TRIP (往返). */
  kind: 'TRANSFER' | 'ROUND_TRIP';
  /** 往返: one driver takes both legs with one claim (同一位司機來回). */
  sameDriver: boolean;
  legIndex: number;
  legCount: number;
  /** The whole order's status: open while either leg still waits for a driver. */
  status: string;
  origin: string;
  /** 往返: where the trip turns back. */
  destination: string;
  /** 接駁位置: where this order's car meets the car of the leg before or after it; none for 往返. */
  transferPlaces: string[];
  legs: JourneyLeg[];
}

/** "第 2／2 段", or "第 1 段" while the trip's other legs are still to be added; 往返 says 去程 or 回程. */
export const legLabel = (journey: { legIndex: number; legCount: number; kind?: Journey['kind'] }) =>
  journey.kind === 'ROUND_TRIP'
    ? roundTripLegName(journey.legIndex)
    : journey.legCount > 1
      ? `第 ${journey.legIndex}／${journey.legCount} 段` : `第 ${journey.legIndex} 段`;

/** 往返: the way there is 去程, the way back 回程. */
export const roundTripLegName = (legIndex: number) => (legIndex === 1 ? '去程' : '回程');

/** A leg's short name: 去程／回程 for 往返, 第 N 段 for 接駁. */
export const legName = (kind: Journey['kind'] | undefined, legIndex: number) =>
  kind === 'ROUND_TRIP' ? roundTripLegName(legIndex) : `第 ${legIndex} 段`;

/** What the trip is, as its tag reads: 往返, or 接駁（中途換車）. */
export const journeyTag = (journey: Pick<Journey, 'kind'>) => (journey.kind === 'ROUND_TRIP' ? '往返' : '接駁（中途換車）');

/** The whole trip's route: "香港 往返 深圳" or "香港 至 澳門". */
export const journeyRoute = (journey: Pick<Journey, 'kind' | 'origin' | 'destination'>) =>
  journey.kind === 'ROUND_TRIP' ? `${journey.origin} 往返 ${journey.destination}` : `${journey.origin} 至 ${journey.destination}`;

/**
 * 往返 同一位司機來回: what the one driver is paid for both legs, when every leg has a driver price
 * in the same currency and none is the dispatcher's own; null otherwise (as the group text says it).
 */
export function roundTripTotal(legs: Pick<JourneyLeg, 'driverPrice' | 'selfDrive'>[]): { amount: number; currency: string } | null {
  if (legs.length < 2 || legs.some((leg) => leg.selfDrive || !leg.driverPrice)) return null;
  const currency = legs[0].driverPrice!.currency;
  if (legs.some((leg) => leg.driverPrice!.currency !== currency)) return null;
  return { amount: Math.round(legs.reduce((sum, leg) => sum + leg.driverPrice!.amount * 100, 0)) / 100, currency };
}

/** Same as PLATE_REGIONS in shared/src/schemas.ts. */
export type PlateRegion = 'HK' | 'MACAU' | 'MAINLAND';
export const PLATE_NAMES: Record<PlateRegion, string> = { HK: '香港', MACAU: '澳門', MAINLAND: '內地' };

/** "需澳門車" or "需香港＋澳門車牌", as in the group text; empty when the order asks for no plate. */
export function plateRequirement(plates: PlateRegion[] | undefined): string {
  if (!plates || plates.length === 0) return '';
  const names = plates.map((plate) => PLATE_NAMES[plate]);
  return names.length === 1 ? `需${names[0]}車` : `需${names.join('＋')}車牌`;
}
