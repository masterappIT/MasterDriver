import { z } from 'zod';
import { CURRENCIES, passengerPhoneSchema } from './schemas';

/**
 * 特價車: a driver offers a trip at a price of their own, whole car, for each party. Like a
 * product, any number of parties book it from the link the driver sends, each its own order,
 * until the driver closes it. The platform never lists, recommends or prices a deal, and takes
 * no money (docs/DECISIONS.md, 2026-10-21 and 2026-10-22 特價車).
 */

/** 時段: the longest stretch a deal may let passengers pick their time in, e.g. 「這個星期」. */
export const DEAL_MAX_WINDOW_HOURS = 7 * 24;

const line = (max: number) => z.string().trim().min(1).max(max);
const optionalLine = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((value) => value || undefined);
const amount = z.number().min(0).max(1_000_000);
const time = z.string().datetime({ offset: true });

/** 時段 ends after it starts and lasts no longer than DEAL_MAX_WINDOW_HOURS. */
const windowValid = (value: { pickupAt?: string; pickupUntil?: string | null }) =>
  !value.pickupAt ||
  !value.pickupUntil ||
  (Date.parse(value.pickupUntil) > Date.parse(value.pickupAt) &&
    Date.parse(value.pickupUntil) - Date.parse(value.pickupAt) <= DEAL_MAX_WINDOW_HOURS * 3_600_000);
/** 原價 is there to show the deal is cheaper, so it must be above the price. */
const originalAbove = (value: { price?: number; originalPrice?: number | null }) =>
  value.price === undefined || value.originalPrice === undefined || value.originalPrice === null || value.originalPrice > value.price;

const dealFields = z.object({
  /** The pickup time, or the start of 時段 when pickupUntil is given. ISO 8601 with offset. */
  pickupAt: time,
  /** 時段: the passenger picks a time from pickupAt to this. */
  pickupUntil: time.optional(),
  origin: line(120),
  destination: line(120),
  /** 包車特價, each party. */
  price: amount,
  currency: z.enum(CURRENCIES),
  /** 原價, shown struck through. */
  originalPrice: amount.optional(),
  maxPassengers: z.number().int().min(1).max(59).optional(),
  maxLuggage: z.number().int().min(0).max(60).optional(),
  notes: optionalLine(500),
  /** 最多接幾組 (庫存); absent: no limit. */
  maxBookings: z.number().int().min(1).max(999).optional(),
  /** 自動接受: each booking is accepted as it comes; otherwise the driver answers each. */
  autoAccept: z.boolean().default(false),
});

export const dealCreateSchema = dealFields
  .refine(windowValid, { message: 'DEAL_WINDOW_INVALID', path: ['pickupUntil'] })
  .refine(originalAbove, { message: 'DEAL_ORIGINAL_NOT_ABOVE', path: ['originalPrice'] });
export type DealCreate = z.infer<typeof dealCreateSchema>;

/**
 * Changes while the deal still takes bookings; null clears an optional field. Bookings already
 * sent keep the time and the price they were sent with.
 */
export const dealUpdateSchema = z
  .object({
    pickupAt: time,
    pickupUntil: time.nullable(),
    origin: line(120),
    destination: line(120),
    price: amount,
    currency: z.enum(CURRENCIES),
    originalPrice: amount.nullable(),
    maxPassengers: z.number().int().min(1).max(59).nullable(),
    maxLuggage: z.number().int().min(0).max(60).nullable(),
    notes: z.string().trim().max(500).nullable(),
    maxBookings: z.number().int().min(1).max(999).nullable(),
    autoAccept: z.boolean(),
  })
  .partial()
  .refine((value) => Object.values(value).some((field) => field !== undefined), { message: 'NOTHING_TO_UPDATE' })
  .refine(windowValid, { message: 'DEAL_WINDOW_INVALID', path: ['pickupUntil'] })
  .refine(originalAbove, { message: 'DEAL_ORIGINAL_NOT_ABOVE', path: ['originalPrice'] });
export type DealUpdate = z.infer<typeof dealUpdateSchema>;

/** What a passenger sends from the deal's link; no account is involved. */
export const dealBookingCreateSchema = z.object({
  /** Within the deal's 時段, or its pickup time when it has none. ISO 8601 with offset. */
  pickupAt: time,
  passengers: z.number().int().min(1).max(59),
  luggage: z.number().int().min(0).max(60).default(0),
  /** Where they get on and off; absent: the deal's origin and destination. */
  origin: optionalLine(120),
  destination: optionalLine(120),
  passengerName: line(40),
  passengerContact: passengerPhoneSchema,
  passengerWechat: optionalLine(60),
  notes: optionalLine(500),
  /** From ?from= on the deal link, e.g. "xhs". */
  source: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9_-]{0,30}$/)
    .optional()
    .transform((value) => value || undefined),
});
export type DealBookingCreate = z.infer<typeof dealBookingCreateSchema>;
