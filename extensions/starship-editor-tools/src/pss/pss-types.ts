/** PSS 参考素材的来源类别；它们只用于编辑器索引，不是运行时规则。 */
export type PssAssetKind = 'ship' | 'room' | 'crew' | 'item' | 'missile';
export type PssLanguage = 'CN' | 'EN' | 'NEUTRAL';

export interface PssSpriteRef {
  readonly sourceId: string;
  readonly path?: string;
  readonly x?: number;
  readonly y?: number;
  readonly width?: number;
  readonly height?: number;
}

/**
 * 索引条目只保留搜索和导入所需的白名单字段，避免把外部 JSON 原样透传到面板。
 * sourcePath 始终是相对于 sourceRoot 的路径，因而切换机器时不会泄漏绝对路径。
 */
export interface PssIndexEntry {
  readonly assetId: string;
  readonly sourceId: string;
  readonly kind: PssAssetKind;
  readonly language: PssLanguage;
  readonly displayName: string;
  /** _sprite_mapping 中的别名只用于搜索和展示，不替代稳定实体 ID。 */
  readonly aliases: readonly string[];
  readonly description?: string;
  readonly sourcePath: string;
  readonly sourceSprite?: PssSpriteRef;
  readonly spriteRefs: readonly PssSpriteRef[];
}

export interface PssLibraryIndex {
  readonly schemaVersion: 1;
  readonly sourceRoot: string;
  readonly entries: readonly PssIndexEntry[];
  readonly warnings: readonly string[];
}

export interface PssSearchQuery {
  readonly query?: string;
  readonly kind?: PssAssetKind;
  readonly language?: PssLanguage;
  readonly page?: number;
  readonly pageSize?: number;
}

export interface PssSearchPage {
  readonly entries: readonly PssIndexEntry[];
  readonly page: number;
  readonly pageSize: number;
  readonly total: number;
  readonly totalPages: number;
  readonly hasPrevious: boolean;
  readonly hasNext: boolean;
  readonly warnings: readonly string[];
}

export interface PssRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface PssImageSize {
  readonly width: number;
  readonly height: number;
}

export interface PssCrewCompositionOffset {
  readonly x: number;
  readonly y: number;
  readonly [key: string]: number;
}

/** 由素材准备流水线生成的首批导入清单条目。 */
export interface PssManifestEntry {
  readonly assetId: string;
  readonly visualId: string;
  readonly kind: 'ship' | 'room' | 'crew' | 'crew-part';
  /** 原始清单可用 source；规范化后与 sourcePath 等价。 */
  readonly source?: string;
  readonly referencePaths?: readonly string[];
  readonly sourcePath: string;
  readonly sourceRelativePath?: string;
  readonly sourceSprite?: string;
  readonly targetPath: string;
  readonly outputAssetUrls?: readonly string[];
  readonly sourceSha256: string;
  readonly targetSha256?: string;
  readonly byteLength?: number;
  readonly size?: PssImageSize;
  readonly frameRects?: readonly PssRect[];
  readonly filter?: string;
  readonly licenseNote: string;
  readonly rightsStatus: string;
  readonly rect?: PssRect;
  readonly mode?: string;
  readonly fps?: number;
  readonly crewCompositionOffsets?: readonly PssCrewCompositionOffset[];
}

export interface PssManifest {
  readonly schemaVersion: number;
  readonly sourceRoot: string;
  readonly rightsNote?: string;
  readonly entries: readonly PssManifestEntry[];
}
