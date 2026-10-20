import { z } from 'zod';
import { CURRENCIES, contactReveal, passengerPhoneSchema } from './schemas';

/**
 * 拼車: a driver opens a trip and gives passengers its link; each party asks for seats there.
 * The platform keeps the seats and passes requests and answers between them; it never lists,
 * matches or prices a carpool (docs/DECISIONS.md, 2026-10-20 拼車).
 */

/** A seat the driver must confirm holds its seats this long, or until asking closes, whichever is first. */
export const CARPOOL_PENDING_HOURS = 2;
/** Asking for seats closes this long before pickup unless the driver says otherwise. */
export const CARPOOL_DEFAULT_CLOSE_HOURS = 2;
/** 等候時間 before a party may be marked as not there, unless the driver says otherwise. */
export const CARPOOL_DEFAULT_WAIT_MINUTES = 15;
export const CARPOOL_MAX_PICKUP_POINTS = 6;

const line = (max: number) => z.string().trim().min(1).max(max);
const optionalLine = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((value) => value || undefined);
/** Optional on create; on update, null clears it. */
const clearable = <T extends z.ZodTypeAny>(schema: T) => schema.nullable().optional();

const seatPriceSchema = z.object({ amount: z.number().min(0).max(1_000_000), currency: z.enum(CURRENCIES) });
const pickupPointsSchema = z
  .array(line(120))
  .max(CARPOOL_MAX_PICKUP_POINTS)
  .transform((points) => [...new Set(points)]);

export const carpoolCreateSchema = z.object({
  /** ISO 8601 date-time with offset. */
  pickupAt: z.string().datetime({ offset: true }),
  origin: line(120),
  destination: line(120),
  /** 上車點 passengers choose from; empty: each types their own. */
  pickupPoints: pickupPointsSchema.default([]),
  /** Seats for passengers; the API holds it to the car's seats less the driver's. */
  seats: z.number().int().min(1).max(59),
  /** 最少成行人數; absent: any number goes. */
  minPassengers: z.number().int().min(1).max(59).optional(),
  /** 每位價錢; absent: 私訊報價. */
  seatPrice: seatPriceSchema.optional(),
  luggagePerSeat: z.number().int().min(0).max(10).optional(),
  /** The driver's own words on cancelling, shown to passengers and never enforced. */
  cancelPolicy: optionalLine(300),
  notes: optionalLine(500),
  /** 報位截止; absent: CARPOOL_DEFAULT_CLOSE_HOURS before pickup (or now, when sooner). */
  closesAt: z.string().datetime({ offset: true }).optional(),
  autoConfirm: z.boolean().default(false),
  waitMinutes: z.number().int().min(0).max(120).default(CARPOOL_DEFAULT_WAIT_MINUTES),
  showPaymentMethods: z.boolean().default(false),
});
export type CarpoolCreate = z.infer<typeof carpoolCreateSchema>;

/**
 * Changes before the carpool becomes an order. A new time or price asks every party to accept
 * it again; a later closesAt opens a closed carpool again.
 */
export const carpoolUpdateSchema = z
  .object({
    pickupAt: z.string().datetime({ offset: true }),
    origin: line(120),
    destination: line(120),
    pickupPoints: pickupPointsSchema,
    seats: z.number().int().min(1).max(59),
    minPassengers: clearable(z.number().int().min(1).max(59)),
    seatPrice: clearable(seatPriceSchema),
    luggagePerSeat: clearable(z.number().int().min(0).max(10)),
    cancelPolicy: clearable(z.string().trim().max(300)),
    notes: clearable(z.string().trim().max(500)),
    closesAt: z.string().datetime({ offset: true }),
    autoConfirm: z.boolean(),
    waitMinutes: z.number().int().min(0).max(120),
    showPaymentMethods: z.boolean(),
  })
  .partial()
  .refine((value) => Object.values(value).some((field) => field !== undefined), { message: 'NOTHING_TO_UPDATE' });
export type CarpoolUpdate = z.infer<typeof carpoolUpdateSchema>;

/** What a passenger sends from the carpool link; no account is involved. */
export const carpoolSeatCreateSchema = z.object({
  passengers: z.number().int().min(1).max(59),
  luggage: z.number().int().min(0).max(60).default(0),
  /** One of the carpool's 上車點 when it has some; otherwise the passenger's own. */
  pickupPoint: line(120),
  /** Where they get off; absent: the carpool's destination. */
  dropoff: optionalLine(120),
  passengerName: line(40),
  passengerContact: passengerPhoneSchema,
  passengerWechat: optionalLine(60),
  notes: optionalLine(300),
});
export type CarpoolSeatCreate = z.infer<typeof carpoolSeatCreateSchema>;

/** 成單: the driver drives it (SELF), or puts it out for another driver to claim (DISPATCH). */
export const carpoolStartSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('SELF') }),
  z.object({
    mode: z.literal('DISPATCH'),
    /** What the driver who opened it pays the driver who takes it. */
    driverPrice: seatPriceSchema.optional(),
    vehicleType: line(30),
    inPool: z.boolean().optional(),
    contactRevealMinutes: contactReveal.optional(),
  }),
]);
export type CarpoolStart = z.infer<typeof carpoolStartSchema>;

/** 行程進度 of one party, reported by whoever drives the carpool's order. */
export const CARPOOL_SEAT_STEPS = ['ARRIVED', 'PICKED_UP', 'NO_SHOW', 'DROPPED_OFF'] as const;
export const carpoolSeatProgressSchema = z.object({ step: z.enum(CARPOOL_SEAT_STEPS) });
export type CarpoolSeatProgress = z.infer<typeof carpoolSeatProgressSchema>;

/** 已收款 for one party. */
export const carpoolSeatPaymentSchema = z.object({ paid: z.boolean() });
export type CarpoolSeatPayment = z.infer<typeof carpoolSeatPaymentSchema>;
