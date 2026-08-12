import { _decorator, Component, director, error } from 'cc';

import { configureGameDisplay } from './configureGameDisplay';

const { ccclass, menu, property } = _decorator;

/**
 * BootScene 保持最小职责：完成开发期启动检查后进入 MainScene。
 * 登录、版本验证和网络初始化仍属于后续 R2，不在 R1 提前伪造。
 */
@ccclass('BootSceneBootstrap')
@menu('星舰协议/启动/启动场景装配')
export class BootSceneBootstrap extends Component {
  @property({ displayName: '主场景名称', tooltip: '启动完成后进入的主场景资源名称。', group: '场景切换' })
  public mainSceneName = 'MainScene';

  protected start(): void {
    configureGameDisplay();
    const sceneName = this.mainSceneName.trim();
    if (sceneName === '') {
      error('[BOOT] 主场景名称不能为空');
      return;
    }
    director.loadScene(sceneName, (cause) => {
      if (cause !== null && cause !== undefined) error(`[BOOT] 无法进入主场景 ${sceneName}：${cause.message}`);
    });
  }
}
