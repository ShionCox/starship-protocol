import { ResolutionPolicy, view } from 'cc';

export const GAME_DESIGN_WIDTH = 1280;
export const GAME_DESIGN_HEIGHT = 720;

let isConfigured = false;

/**
 * 所有正式场景共用同一套 16:9 显示规则。浏览器容器负责留出黑色背景，Cocos 负责按实际
 * Canvas 尺寸重建渲染缓冲，避免只用 CSS 放大 1280×720 画布造成模糊。
 */
export function configureGameDisplay(): void {
  if (isConfigured) {
    return;
  }
  isConfigured = true;
  view.resizeWithBrowserSize(true);
  view.setDesignResolutionSize(GAME_DESIGN_WIDTH, GAME_DESIGN_HEIGHT, ResolutionPolicy.SHOW_ALL);
}
