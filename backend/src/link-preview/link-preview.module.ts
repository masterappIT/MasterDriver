import { Module } from '@nestjs/common';
import { LinkPreviewController } from './link-preview.controller';
import { LinkPreviewService } from './link-preview.service';
import { SearchPageController } from './search-page.controller';
import { SearchPageService } from './search-page.service';

@Module({
  controllers: [LinkPreviewController, SearchPageController],
  providers: [LinkPreviewService, SearchPageService],
})
export class LinkPreviewModule {}
