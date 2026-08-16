import { _decorator, Component } from 'cc';

const { ccclass, menu } = _decorator;

/**
 * 持久设置弹窗的静态内容。
 *
 * 设置按钮本身由 MainPageRouter 负责开关；面板、遮罩和文字均由 Prefab 持久保存。
 */
@ccclass('SettingsPopup')
@menu('星舰协议/界面/设置弹窗')
export class SettingsPopup extends Component {
}
