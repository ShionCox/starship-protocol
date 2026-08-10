export interface AssetMenuContext {
  readonly url?: string;
  readonly isDirectory?: boolean;
  readonly readonly?: boolean;
  readonly type?: string;
}

/** 面板从公开 Selection API 读取的场景选择上下文。 */
export interface SceneSelectionContext {
  readonly nodeUuid?: string;
  readonly selectedNodeUuids?: readonly string[];
}

export interface EditorMenuItem {
  readonly label: string;
  readonly enabled?: boolean;
  readonly submenu?: readonly EditorMenuItem[];
  readonly click?: () => void;
}

/**
 * 编辑器领域模块只贡献真实存在的资源创作入口；运行时完全不加载该模块。
 * 场景对象由唯一创作面板通过公开 Scene 消息创建，不为未来领域预留空菜单。
 */
export interface EditorToolModule {
  readonly id: string;
  getAssetCreateMenu(context: AssetMenuContext): readonly EditorMenuItem[];
}
