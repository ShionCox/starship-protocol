import type { AssetDbPort } from './editor-asset-db';

/** 删除一个资源失败时继续清理其余资源，并返回每个未确认删除的具体路径。 */
export async function rollbackCreatedAssets(
  assetDb: Pick<AssetDbPort, 'deleteAsset'>,
  urls: readonly string[],
): Promise<readonly string[]> {
  const errors: string[] = [];
  for (const url of urls) {
    try {
      const deleted = await assetDb.deleteAsset(url);
      if (deleted === null || deleted === undefined) errors.push(`${url}：Asset DB 未确认删除资源`);
    } catch (cause) {
      errors.push(`${url}：${cause instanceof Error ? cause.message : String(cause)}`);
    }
  }
  return errors;
}

export function describeRollback(errors: readonly string[]): string {
  return errors.length === 0
    ? '已回滚新资源'
    : `回滚失败，资源清理未完成，无法确认以下资源已删除：${errors.join('；')}`;
}
