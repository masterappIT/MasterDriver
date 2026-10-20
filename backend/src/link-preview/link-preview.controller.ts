import { Controller, Get, Inject, Param, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { LinkPreviewService } from './link-preview.service';
import { previewHtml, previewTags } from './preview-card';

/**
 * What chat apps read when a link is pasted. nginx sends only link-preview robots to the page
 * (deploy/frontend/web.conf); people opening a link get the app as usual, with this link's tags
 * put in by nginx from `tags`.
 */
@Controller('public/link-preview')
export class LinkPreviewController {
  constructor(@Inject(LinkPreviewService) private readonly previews: LinkPreviewService) {}

  @Get()
  async page(@Query('path') path: string | undefined, @Res() response: Response) {
    const meta = await this.previews.page(typeof path === 'string' ? path : '/');
    response
      .set({
        'content-type': 'text/html; charset=utf-8',
        // Chat apps keep their own copy; ours is short so a changed card shows up soon on a new paste.
        'cache-control': 'public, max-age=600',
        'x-robots-tag': 'noindex, nofollow',
      })
      .send(previewHtml(meta));
  }

  /**
   * The tags for one link, for nginx to put into the app's page in place of the home tags. Empty
   * when the link has none of its own, which leaves the home tags (and when the API is slow or down).
   */
  @Get('tags')
  async tags(@Query('path') path: string | undefined, @Res() response: Response) {
    const meta = typeof path === 'string' ? await this.previews.tags(path) : null;
    response
      .set({ 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
      .send(meta ? previewTags(meta).join('\n') : '');
  }

  @Get('square/:kind/:file')
  async square(@Param('kind') kind: string, @Param('file') file: string, @Res() response: Response) {
    const jpeg = await this.previews.square(kind, file.replace(/\.jpg$/, ''));
    if (!jpeg) return response.redirect(302, '/share-square.jpg');
    this.sendJpeg(response, jpeg);
  }

  @Get('card/:kind/:file')
  async card(@Param('kind') kind: string, @Param('file') file: string, @Res() response: Response) {
    const jpeg = await this.previews.card(kind, file.replace(/\.jpg$/, ''));
    // No card of its own (unknown, unpublished, taken down, cancelled): the generic picture.
    if (!jpeg) return response.redirect(302, '/share-card.jpg');
    this.sendJpeg(response, jpeg);
  }

  private sendJpeg(response: Response, jpeg: Buffer) {
    response
      .set({
        'content-type': 'image/jpeg',
        // The address carries a version of what is drawn, so the image under it never changes.
        'cache-control': 'public, max-age=86400',
        'x-content-type-options': 'nosniff',
      })
      .send(jpeg);
  }
}
