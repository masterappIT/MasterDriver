import { Controller, Get, HttpStatus, Inject, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { apiError } from '../common/errors';
import { SearchPageService } from './search-page.service';

/**
 * What search engines read. nginx sends only search-engine robots to the page (deploy/frontend/web.conf);
 * link-preview robots go to LinkPreviewController as before, and people get the app.
 */
@Controller('public')
export class SearchPageController {
  constructor(@Inject(SearchPageService) private readonly pages: SearchPageService) {}

  @Get('search-page')
  async page(@Query('path') path: string | undefined, @Res() response: Response) {
    const page = await this.pages.page(typeof path === 'string' ? path : '/');
    response
      .set({
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'public, max-age=600',
        'x-robots-tag': page.indexable ? 'index, follow' : 'noindex, nofollow',
      })
      .send(page.html);
  }

  @Get('sitemap.xml')
  async sitemap(@Res() response: Response) {
    const xml = await this.pages.sitemap();
    if (!xml) throw apiError(HttpStatus.NOT_FOUND, 'SITEMAP_OFF', 'The sitemap is switched off');
    response.set({ 'content-type': 'application/xml; charset=utf-8', 'cache-control': 'public, max-age=3600' }).send(xml);
  }
}
