import { z } from 'zod';
import { passengerPhoneSchema } from './schemas';

/** 名片頁 and booking requests. */
/** One vehicle photo per driver: the car the passenger looks for. */
export const PROFILE_PHOTO_MAX = 1;
export const PROFILE_PHOTO_MAX_BYTES = 5 * 1024 * 1024;

const line = (max: number) => z.string().trim().min(1).max(max);
const list = (items: number, max: number) =>
  z
    .array(line(max))
    .max(items)
    .transform((values) => [...new Set(values)]);

export const profilePageUpdateSchema = z
  .object({
    published: z.boolean(),
    intro: z.string().trim().max(500),
    /** e.g. 「香港 ⇄ 深圳灣」; shown as written. */
    routes: list(8, 60),
    languages: list(6, 20),
    regions: list(8, 30),
    wechatId: z.string().trim().max(60),
    whatsapp: z.string().trim().max(30),
  })
  .partial()
  .refine((value) => Object.values(value).some((field) => field !== undefined), { message: 'NOTHING_TO_UPDATE' });
export type ProfilePageUpdate = z.infer<typeof profilePageUpdateSchema>;

/** What a passenger sends from a 名片頁; no account is involved. */
export const bookingCreateSchema = z.object({
  /** ISO 8601 date-time with offset. */
  pickupAt: z.string().datetime({ offset: true }),
  origin: line(120),
  destination: line(120),
  passengers: z.number().int().min(1).max(60),
  luggage: z.number().int().min(0).max(60).default(0),
  /** 接駁 (中途換車) rather than 直達; the passenger never names the 接駁位置, the driver does. */
  transfer: z.boolean().default(false),
  /** How to address the passenger; asked for since 2026-10-14, so older requests may have none. */
  passengerName: line(40),
  /** A phone with its country code, as on an order (2026-10-14; older requests may hold any text). */
  passengerContact: passengerPhoneSchema,
  /** Optional, only the driver sees it. */
  passengerWechat: z
    .string()
    .trim()
    .max(60)
    .optional()
    .transform((value) => value || undefined),
  notes: z
    .string()
    .trim()
    .max(500)
    .optional()
    .transform((value) => value || undefined),
  /** From ?from= on the page link, e.g. "xhs". */
  source: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9_-]{0,30}$/)
    .optional()
    .transform((value) => value || undefined),
});
export type BookingCreate = z.infer<typeof bookingCreateSchema>;

/** The driver's answer: a price, with an optional note about what it covers. */
export const bookingQuoteSchema = z.object({
  amount: z.number().min(0).max(1_000_000),
  currency: z.enum(['HKD', 'CNY', 'MOP']),
  note: z
    .string()
    .trim()
    .max(300)
    .optional()
    .transform((value) => value || undefined),
});
export type BookingQuote = z.infer<typeof bookingQuoteSchema>;
