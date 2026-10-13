/** Same as MAX_JOURNEY_LEGS in shared/src/schemas.ts (not imported, to keep zod out of the bundle). */
export const MAX_JOURNEY_LEGS = 4;

export interface LegDriver {
  name: string | null;
  hkPlate: string | null;
  macauPlate: string | null;
  mainlandPlate: string | null;
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
  handoffNote: string | null;
  /** Only for the dispatcher. */
  id?: string;
  /** Only for the dispatcher and this leg's driver. */
  driver?: LegDriver | null;
}

/** 接駁: the trip around an order, as the API returns it. */
export interface Journey {
  legIndex: number;
  legCount: number;
  legs: JourneyLeg[];
}

/** Where legs usually meet: one tap fills the next leg's starting point. */
export const HANDOFF_PLACES = [
  '港珠澳大橋澳門口岸',
  '港珠澳大橋香港口岸',
  '港珠澳大橋珠海口岸',
  '關閘（拱北口岸）',
  '橫琴口岸',
  '深圳灣口岸',
  '落馬洲口岸',
  '皇崗口岸',
  '蓮塘口岸',
  '羅湖口岸',
];

/** How the passenger gets from one leg to the next. */
export const HANDOFF_NOTES = ['乘客自行過關（穿梭巴士）', '乘客自行過關', '同一地點直接換車'];
