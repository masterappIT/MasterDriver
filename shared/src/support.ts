import { z } from 'zod';

/** 客服 message limits, shared by the API and both apps. */
export const SUPPORT_TEXT_MAX = 2000;
export const SUPPORT_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
/** Below Cloud Run's 32 MiB request limit. */
export const SUPPORT_VIDEO_MAX_BYTES = 25 * 1024 * 1024;
/** How many messages one request returns. */
export const SUPPORT_PAGE_SIZE = 50;

const clientMessageId = z.string().regex(/^[A-Za-z0-9_-]{8,64}$/);

export const supportTextSchema = z.object({
  text: z.string().trim().min(1).max(SUPPORT_TEXT_MAX),
  /** Chosen by the sender; sending the same id again returns the first message. */
  clientMessageId,
});
export type SupportText = z.infer<typeof supportTextSchema>;

/** Query of a media upload; the picture or video itself is the request body. */
export const supportMediaQuerySchema = z.object({ clientMessageId });
export type SupportMediaQuery = z.infer<typeof supportMediaQuerySchema>;

const seq = z.coerce.number().int().min(0).max(2_000_000_000);

/** `after`: only newer messages (polling). `before`: the page of older ones. */
export const supportThreadQuerySchema = z.object({ after: seq.optional(), before: seq.optional() });
export type SupportThreadQuery = z.infer<typeof supportThreadQuerySchema>;
