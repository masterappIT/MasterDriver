import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { MAX_PAYMENT_METHODS, type PaymentMethodCreate, type PaymentMethodUpdate } from '@masterdriver/shared';
import type { PaymentMethod } from '../../generated/prisma';
import { apiError } from '../common/errors';
import { decodeQrImage } from '../groups/qr-image';
import { PrismaService } from '../prisma.service';

/** The dispatcher's own view, with a link to their QR image. */
function ownView(method: PaymentMethod) {
  return {
    id: method.id,
    kind: method.kind,
    label: method.label,
    account: method.account,
    qrUrl: method.qrImage ? `/api/me/payment-methods/${method.id}/qr?v=${method.updatedAt.getTime()}` : null,
  };
}

/**
 * 收款方式: how a dispatcher can be paid for the orders they put out. The passenger sees them on
 * the confirmation page of an order that shows them, and pays the dispatcher directly; the
 * platform never takes, holds or checks the money. QR images are only served to the owner and
 * through such a confirmation link, never by their id alone.
 */
@Injectable()
export class PaymentMethodsService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  private qr(dataUrl: string) {
    const image = decodeQrImage(dataUrl);
    if (!image) throw apiError(HttpStatus.BAD_REQUEST, 'QR_IMAGE_INVALID', 'Upload a PNG, JPEG or WebP image up to 400 KB');
    return image;
  }

  private notFound() {
    return apiError(HttpStatus.NOT_FOUND, 'PAYMENT_METHOD_NOT_FOUND', 'Payment method not found');
  }

  async list(ownerId: string) {
    const methods = await this.prisma.paymentMethod.findMany({ where: { ownerId }, orderBy: { createdAt: 'asc' } });
    return methods.map(ownView);
  }

  async create(ownerId: string, input: PaymentMethodCreate) {
    if ((await this.prisma.paymentMethod.count({ where: { ownerId } })) >= MAX_PAYMENT_METHODS) {
      throw apiError(HttpStatus.CONFLICT, 'PAYMENT_METHOD_LIMIT', `At most ${MAX_PAYMENT_METHODS} payment methods`);
    }
    const image = input.qrImage ? this.qr(input.qrImage) : null;
    await this.prisma.paymentMethod.create({
      data: { ownerId, kind: input.kind, label: input.label, account: input.account ?? null, qrImage: image?.bytes, qrMime: image?.mime },
    });
    return this.list(ownerId);
  }

  async update(ownerId: string, id: string, input: PaymentMethodUpdate) {
    const method = await this.prisma.paymentMethod.findFirst({ where: { id, ownerId } });
    if (!method) throw this.notFound();
    const image = input.qrImage ? this.qr(input.qrImage) : null;
    const account = input.account === undefined ? method.account : input.account || null;
    const keepsQr = input.qrImage === undefined ? Boolean(method.qrImage) : Boolean(image);
    if (!account && !keepsQr) throw apiError(HttpStatus.BAD_REQUEST, 'PAYMENT_METHOD_EMPTY', 'Keep account details or a QR image');
    await this.prisma.paymentMethod.update({
      where: { id },
      data: {
        ...(input.label === undefined ? {} : { label: input.label }),
        account,
        ...(input.qrImage === undefined ? {} : { qrImage: image?.bytes ?? null, qrMime: image?.mime ?? null }),
      },
    });
    return this.list(ownerId);
  }

  async remove(ownerId: string, id: string) {
    const deleted = await this.prisma.paymentMethod.deleteMany({ where: { id, ownerId } });
    if (deleted.count === 0) throw this.notFound();
    return this.list(ownerId);
  }

  async ownQr(ownerId: string, id: string) {
    const method = await this.prisma.paymentMethod.findFirst({ where: { id, ownerId }, select: { qrImage: true, qrMime: true } });
    return method?.qrImage && method.qrMime ? { mime: method.qrMime, bytes: Buffer.from(method.qrImage) } : null;
  }

  /**
   * What the passenger's confirmation page lists: the dispatcher's methods, but only for an
   * order that shows them and is not cancelled. QR links go through the confirmation code, or
   * for a 拼車 party through their own link (`link` 's').
   */
  async forPassenger(ownerId: string, confirmCode: string, link: 'c' | 's' = 'c') {
    const methods = await this.prisma.paymentMethod.findMany({ where: { ownerId }, orderBy: { createdAt: 'asc' } });
    return methods.map((method) => ({
      id: method.id,
      kind: method.kind,
      label: method.label,
      account: method.account,
      qrUrl: method.qrImage ? `/api/${link}/${confirmCode}/payment-methods/${method.id}/qr?v=${method.updatedAt.getTime()}` : null,
    }));
  }

  /** A QR image for the passenger link: the order must show payment methods, and the method be its dispatcher's. */
  async passengerQr(confirmCode: string, id: string) {
    const order = await this.prisma.order.findUnique({
      where: { confirmCode },
      select: { dispatcherId: true, showPaymentMethods: true, status: true },
    });
    if (!order || !order.showPaymentMethods || order.status === 'CANCELLED') return null;
    return this.ownQr(order.dispatcherId, id);
  }
}
