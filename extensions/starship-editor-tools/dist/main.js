"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.methods = void 0;
exports.load = load;
exports.unload = unload;
const constants_1 = require("./constants");
const create_room_content_1 = require("./rooms/create-room-content");
const editor_asset_db_1 = require("./shared/editor-asset-db");
const editor_scene_1 = require("./shared/editor-scene");
const validate_open_room_prefab_1 = require("./rooms/validate-open-room-prefab");
const discover_room_prefabs_1 = require("./rooms/discover-room-prefabs");
const room_module_1 = require("./rooms/room-module");
const prototype_skeleton_1 = require("./scene/prototype-skeleton");
const bind_room_prefab_1 = require("./rooms/bind-room-prefab");
const room_scene_authoring_1 = require("./rooms/room-scene-authoring");
const edit_room_definition_1 = require("./rooms/edit-room-definition");
const authoring_selection_1 = require("./authoring-selection");
const scene_core_authoring_1 = require("./scene/scene-core-authoring");
let catalogWarnings = [];
let catalogFingerprint = '';
let catalogRefreshTimer;
let assetChangeListener;
let extensionLoaded = false;
exports.methods = {
    openRoomCreate(context) {
        return Editor.Panel.open(constants_1.PACKAGE_NAME, context);
    },
    openAuthoringPanel() {
        return Editor.Panel.open(`${constants_1.PACKAGE_NAME}.authoring`);
    },
    createRoomContent(request) {
        return (0, create_room_content_1.createRoomContent)(request, editor_asset_db_1.editorAssetDb).then(async (result) => {
            if (!result.ok)
                return result;
            let failureMessage = null;
            try {
                const configUuid = await editor_asset_db_1.editorAssetDb.queryUuid(result.configUrl);
                if (configUuid === '') {
                    failureMessage = `创建后找不到房间定义资源：${result.configUrl}`;
                }
                else {
                    await Editor.Message.request('asset-db', 'open-asset', result.prefabUrl);
                    const binding = await (0, bind_room_prefab_1.bindRoomDefinitionToOpenPrefab)(editor_scene_1.editorSceneQuery, configUuid, request.id);
                    if (binding.ok) {
                        const refreshed = await refreshRoomCatalogNow();
                        const warning = refreshed.warnings.length > 0
                            ? `（列表刷新有 ${refreshed.warnings.length} 条警告）`
                            : '';
                        return Object.assign(Object.assign({}, result), { message: `${result.message}${binding.message}${warning}` });
                    }
                    failureMessage = binding.message;
                }
            }
            catch (error) {
                failureMessage = error instanceof Error ? error.message : String(error);
            }
            const rollbackErrors = [];
            for (const url of [result.prefabUrl, result.configUrl]) {
                try {
                    await editor_asset_db_1.editorAssetDb.deleteAsset(url);
                }
                catch (error) {
                    rollbackErrors.push(`${url}：${error instanceof Error ? error.message : String(error)}`);
                }
            }
            return {
                ok: false,
                message: `${failureMessage !== null && failureMessage !== void 0 ? failureMessage : '房间定义绑定失败'}；已回滚新资源${rollbackErrors.length === 0 ? '' : `，回滚失败：${rollbackErrors.join('；')}`}`,
            };
        });
    },
    openCreatedPrefab(prefabUrl) {
        return Editor.Message.request('asset-db', 'open-asset', prefabUrl);
    },
    validateOpenRoomPrefab() {
        return (0, validate_open_room_prefab_1.validateOpenRoomPrefab)(editor_scene_1.editorSceneQuery);
    },
    async refreshAuthoringState() {
        await refreshRoomCatalogNow();
        return await getAuthoringState();
    },
    initializePrototypeScene() {
        return (0, prototype_skeleton_1.initializePrototypeScene)(editor_scene_1.editorSceneQuery);
    },
    async getAuthoringState() {
        return await getAuthoringState();
    },
    async createRoomInstance(entry) {
        return await (0, room_module_1.createRoomFromSelection)(entry, { nodeUuid: getSelectedNodeUuid() });
    },
    async updateRoomDefinition(request) {
        const result = await (0, edit_room_definition_1.updateRoomDefinition)(request, editor_asset_db_1.editorAssetDb);
        if (result.ok)
            await refreshRoomCatalogNow();
        return result;
    },
    async updateSceneCoreSettings(request) {
        return await (0, scene_core_authoring_1.updateSceneCoreSettings)(editor_scene_1.editorSceneQuery, getSelectedNodeUuid(), request);
    },
};
function load() {
    extensionLoaded = true;
    registerAssetChangeListener();
    void refreshRoomCatalogNow().catch((cause) => {
        console.warn(`[ROOM] 房间建筑列表刷新失败：${cause instanceof Error ? cause.message : String(cause)}`);
    });
}
function unload() {
    var _a;
    extensionLoaded = false;
    const message = getBroadcastMessagePort();
    if (assetChangeListener !== undefined) {
        (_a = message === null || message === void 0 ? void 0 : message.removeBroadcastListener) === null || _a === void 0 ? void 0 : _a.call(message, 'asset-db:asset-change', assetChangeListener);
        assetChangeListener = undefined;
    }
    if (catalogRefreshTimer !== undefined) {
        clearTimeout(catalogRefreshTimer);
        catalogRefreshTimer = undefined;
    }
}
async function refreshRoomCatalogNow() {
    var _a, _b;
    const result = await (0, discover_room_prefabs_1.discoverRoomPrefabs)(editor_asset_db_1.editorAssetDb);
    (0, room_module_1.setRoomCatalog)(result.entries);
    catalogWarnings = result.warnings;
    const nextFingerprint = JSON.stringify({ entries: result.entries, warnings: result.warnings });
    const changed = nextFingerprint !== catalogFingerprint;
    catalogFingerprint = nextFingerprint;
    for (const warning of result.warnings)
        console.warn(`[ROOM] ${warning}`);
    if (changed)
        (_b = (_a = getBroadcastMessagePort()) === null || _a === void 0 ? void 0 : _a.broadcast) === null || _b === void 0 ? void 0 : _b.call(_a, constants_1.ROOM_CATALOG_CHANGE_MESSAGE);
    return result;
}
async function getAuthoringState() {
    const selectedUuid = getSelectedNodeUuid();
    try {
        const tree = await editor_scene_1.editorSceneQuery.queryNodeTree();
        const selectedNode = selectedUuid === undefined ? undefined : flattenTree(tree).find((node) => node.uuid === selectedUuid);
        // Creator 启动或切场景的瞬间，组件注册表可能还未响应；它只用于还原压缩 CID，
        // 不能因为这个辅助查询失败就把已有 Canvas/场景根判定为不可创建。
        const componentClasses = editor_scene_1.editorSceneQuery.queryComponents === undefined
            ? []
            : await editor_scene_1.editorSceneQuery.queryComponents().catch(() => []);
        const target = (0, room_scene_authoring_1.resolveRoomPlacementTarget)(tree, { nodeUuid: selectedUuid }, componentClasses);
        const roomTarget = target.ok
            ? {
                ok: true,
                mode: target.mode,
                uuid: target.node.uuid,
                path: getNodePath(tree, target.node.uuid),
                message: target.message,
            }
            : { ok: false, mode: 'blocked', message: target.message };
        return {
            selection: await (0, authoring_selection_1.recognizeAuthoringSelection)({
                selectedNode,
                tree,
                componentClasses,
                scene: editor_scene_1.editorSceneQuery,
                rooms: (0, room_module_1.getRoomCatalog)(),
            }),
            roomTarget,
            rooms: (0, room_module_1.getRoomCatalog)(),
            warnings: catalogWarnings,
        };
    }
    catch (cause) {
        return {
            selection: { kind: 'none', typeId: 'none', page: 'scene', uuid: selectedUuid },
            roomTarget: { ok: false, mode: 'blocked', message: `无法读取当前场景：${cause instanceof Error ? cause.message : String(cause)}` },
            rooms: (0, room_module_1.getRoomCatalog)(),
            warnings: catalogWarnings,
        };
    }
}
function getSelectedNodeUuid() {
    var _a, _b, _c;
    try {
        const selection = (_a = globalThis.Editor) === null || _a === void 0 ? void 0 : _a.Selection;
        return (_c = (_b = selection === null || selection === void 0 ? void 0 : selection.getSelected) === null || _b === void 0 ? void 0 : _b.call(selection, 'node')) === null || _c === void 0 ? void 0 : _c[0];
    }
    catch (_d) {
        return undefined;
    }
}
function registerAssetChangeListener() {
    if (assetChangeListener !== undefined)
        return;
    const message = getBroadcastMessagePort();
    if ((message === null || message === void 0 ? void 0 : message.addBroadcastListener) === undefined)
        return;
    assetChangeListener = (...args) => {
        void handleAssetChange(args[0]);
    };
    message.addBroadcastListener('asset-db:asset-change', assetChangeListener);
}
async function handleAssetChange(value) {
    const uuid = readAssetChangeUuid(value);
    if (uuid !== undefined && !await isRoomAssetChange(uuid))
        return;
    if (!extensionLoaded)
        return;
    if (catalogRefreshTimer !== undefined)
        clearTimeout(catalogRefreshTimer);
    catalogRefreshTimer = setTimeout(() => {
        catalogRefreshTimer = undefined;
        void refreshRoomCatalogNow().catch((cause) => {
            console.warn(`[ROOM] 房间建筑列表自动刷新失败：${cause instanceof Error ? cause.message : String(cause)}`);
        });
    }, 200);
}
async function isRoomAssetChange(uuid) {
    if ((0, room_module_1.getRoomCatalog)().some((entry) => entry.prefabUuid === uuid || entry.configUuid === uuid))
        return true;
    try {
        const info = await editor_asset_db_1.editorAssetDb.queryInfo(uuid);
        return info === null || isRoomAssetUrl(info.url);
    }
    catch (_a) {
        // 资源删除或导入过程中的临时查询失败不能让房间目录停留在旧状态。
        return true;
    }
}
function isRoomAssetUrl(url) {
    return (url.startsWith(`${constants_1.ROOM_CONFIG_DIRECTORY}/`) && url.endsWith('.json'))
        || (url.startsWith(`${constants_1.DEFAULT_PREFAB_DIRECTORY}/`) && url.endsWith('.prefab'));
}
function readAssetChangeUuid(value) {
    if (typeof value === 'string' && value !== '')
        return value;
    if (typeof value === 'object' && value !== null) {
        const uuid = value.uuid;
        return typeof uuid === 'string' && uuid !== '' ? uuid : undefined;
    }
    return undefined;
}
function getBroadcastMessagePort() {
    var _a;
    const message = (_a = globalThis.Editor) === null || _a === void 0 ? void 0 : _a.Message;
    return typeof message === 'object' && message !== null ? message : undefined;
}
function flattenTree(tree) {
    const result = [];
    const visit = (node, parent) => {
        var _a;
        result.push(parent === undefined || node.parent !== undefined ? node : Object.assign(Object.assign({}, node), { parent }));
        for (const child of (_a = node.children) !== null && _a !== void 0 ? _a : [])
            visit(child, node.uuid);
    };
    visit(tree);
    return result;
}
function getNodePath(tree, uuid) {
    if (uuid === undefined)
        return undefined;
    const nodes = flattenTree(tree);
    const byUuid = new Map(nodes.filter((node) => node.uuid !== undefined).map((node) => [node.uuid, node]));
    const names = [];
    let cursor = byUuid.get(uuid);
    while (cursor !== undefined) {
        if (cursor.name !== undefined)
            names.unshift(cursor.name);
        cursor = cursor.parent === undefined ? undefined : byUuid.get(cursor.parent);
    }
    return names.join('/');
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibWFpbi5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uL3NyYy9tYWluLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7OztBQWlJQSxvQkFNQztBQUNELHdCQVdDO0FBbkpELDJDQUtxQjtBQUVyQixxRUFHcUM7QUFDckMsOERBQXlEO0FBQ3pELHdEQUF5RDtBQUN6RCxpRkFBMkU7QUFDM0UseUVBQW9FO0FBQ3BFLHFEQUk2QjtBQUM3QixtRUFBc0U7QUFDdEUsK0RBQTBFO0FBQzFFLHVFQUEwRTtBQUMxRSx1RUFHc0M7QUFFdEMsK0RBRytCO0FBQy9CLHVFQUdzQztBQWV0QyxJQUFJLGVBQWUsR0FBc0IsRUFBRSxDQUFDO0FBQzVDLElBQUksa0JBQWtCLEdBQUcsRUFBRSxDQUFDO0FBQzVCLElBQUksbUJBQThELENBQUM7QUFDbkUsSUFBSSxtQkFBK0QsQ0FBQztBQUNwRSxJQUFJLGVBQWUsR0FBRyxLQUFLLENBQUM7QUFFZixRQUFBLE9BQU8sR0FBRztJQUNyQixjQUFjLENBQUMsT0FBeUI7UUFDdEMsT0FBTyxNQUFNLENBQUMsS0FBSyxDQUFDLElBQUksQ0FBQyx3QkFBWSxFQUFFLE9BQU8sQ0FBQyxDQUFDO0lBQ2xELENBQUM7SUFDRCxrQkFBa0I7UUFDaEIsT0FBTyxNQUFNLENBQUMsS0FBSyxDQUFDLElBQUksQ0FBQyxHQUFHLHdCQUFZLFlBQVksQ0FBQyxDQUFDO0lBQ3hELENBQUM7SUFDRCxpQkFBaUIsQ0FBQyxPQUE0QjtRQUM1QyxPQUFPLElBQUEsdUNBQTRCLEVBQUMsT0FBTyxFQUFFLCtCQUFhLENBQUMsQ0FBQyxJQUFJLENBQUMsS0FBSyxFQUFFLE1BQU0sRUFBRSxFQUFFO1lBQ2hGLElBQUksQ0FBQyxNQUFNLENBQUMsRUFBRTtnQkFBRSxPQUFPLE1BQU0sQ0FBQztZQUM5QixJQUFJLGNBQWMsR0FBa0IsSUFBSSxDQUFDO1lBQ3pDLElBQUksQ0FBQztnQkFDSCxNQUFNLFVBQVUsR0FBRyxNQUFNLCtCQUFhLENBQUMsU0FBUyxD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O0lBQ25ILE1BQU0sS0FBSyxHQUFhLEVBQUUsQ0FBQztJQUMzQixJQUFJLE1BQU0sR0FBRyxNQUFNLENBQUMsR0FBRyxDQUFDLElBQUksQ0FBQyxDQUFDO0lBQzlCLE9BQU8sTUFBTSxLQUFLLFNBQVMsRUFBRSxDQUFDO1FBQzVCLElBQUksTUFBTSxDQUFDLElBQUksS0FBSyxTQUFTO1lBQUUsS0FBSyxDQUFDLE9BQU8sQ0FBQyxNQUFNLENBQUMsSUFBSSxDQUFDLENBQUM7UUFDMUQsTUFBTSxHQUFHLE1BQU0sQ0FBQyxNQUFNLEtBQUssU0FBUyxDQUFDLENBQUMsQ0FBQyxTQUFTLENBQUMsQ0FBQyxDQUFDLE1BQU0sQ0FBQyxHQUFHLENBQUMsTUFBTSxDQUFDLE1BQU0sQ0FBQyxDQUFDO0lBQy9FLENBQUM7SUFDRCxPQUFPLEtBQUssQ0FBQyxJQUFJLENBQUMsR0FBRyxDQUFDLENBQUM7QUFDekIsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7XG4gIERFRkFVTFRfUFJFRkFCX0RJUkVDVE9SWSxcbiAgUEFDS0FHRV9OQU1FLFxuICBST09NX0NBVEFMT0dfQ0hBTkdFX01FU1NBR0UsXG4gIFJPT01fQ09ORklHX0RJUkVDVE9SWSxcbn0gZnJvbSAnLi9jb25zdGFudHMnO1xuaW1wb3J0IHR5cGUgeyBBc3NldE1lbnVDb250ZXh0IH0gZnJvbSAnLi9jb250cmFjdHMnO1xyXG5pbXBvcnQge1xyXG4gIGNyZWF0ZVJvb21Db250ZW50IGFzIGNyZWF0ZVJvb21Db250ZW50V2l0aEFzc2V0RGIsXHJcbiAgdHlwZSBSb29tQ3JlYXRpb25SZXF1ZXN0LFxyXG59IGZyb20gJy4vcm9vbXMvY3JlYXRlLXJvb20tY29udGVudCc7XHJcbmltcG9ydCB7IGVkaXRvckFzc2V0RGIgfSBmcm9tICcuL3NoYXJlZC9lZGl0b3ItYXNzZXQtZGInO1xyXG5pbXBvcnQgeyBlZGl0b3JTY2VuZVF1ZXJ5IH0gZnJvbSAnLi9zaGFyZWQvZWRpdG9yLXNjZW5lJztcclxuaW1wb3J0IHsgdmFsaWRhdGVPcGVuUm9vbVByZWZhYiB9IGZyb20gJy4vcm9vbXMvdmFsaWRhdGUtb3Blbi1yb29tLXByZWZhYic7XHJcbmltcG9ydCB7IGRpc2NvdmVyUm9vbVByZWZhYnMgfSBmcm9tICcuL3Jvb21zL2Rpc2NvdmVyLXJvb20tcHJlZmFicyc7XHJcbmltcG9ydCB7XHJcbiAgY3JlYXRlUm9vbUZyb21TZWxlY3Rpb24sXHJcbiAgZ2V0Um9vbUNhdGFsb2csXHJcbiAgc2V0Um9vbUNhdGFsb2csXHJcbn0gZnJvbSAnLi9yb29tcy9yb29tLW1vZHVsZSc7XHJcbmltcG9ydCB7IGluaXRpYWxpemVQcm90b3R5cGVTY2VuZSB9IGZyb20gJy4vc2NlbmUvcHJvdG90eXBlLXNrZWxldG9uJztcclxuaW1wb3J0IHsgYmluZFJvb21EZWZpbml0aW9uVG9PcGVuUHJlZmFiIH0gZnJvbSAnLi9yb29tcy9iaW5kLXJvb20tcHJlZmFiJztcclxuaW1wb3J0IHsgcmVzb2x2ZVJvb21QbGFjZW1lbnRUYXJnZXQgfSBmcm9tICcuL3Jvb21zL3Jvb20tc2NlbmUtYXV0aG9yaW5nJztcbmltcG9ydCB7XHJcbiAgdXBkYXRlUm9vbURlZmluaXRpb24sXHJcbiAgdHlwZSBSb29tRGVmaW5pdGlvbkVkaXRSZXF1ZXN0LFxyXG59IGZyb20gJy4vcm9vbXMvZWRpdC1yb29tLWRlZmluaXRpb24nO1xyXG5pbXBvcnQgdHlwZSB7IFNjZW5lTm9kZVRyZWUgfSBmcm9tICcuL3NoYXJlZC9lZGl0b3Itc2NlbmUnO1xuaW1wb3J0IHtcbiAgcmVjb2duaXplQXV0aG9yaW5nU2VsZWN0aW9uLFxuICB0eXBlIEF1dGhvcmluZ1NlbGVjdGlvbixcbn0gZnJvbSAnLi9hdXRob3Jpbmctc2VsZWN0aW9uJztcbmltcG9ydCB7XG4gIHVwZGF0ZVNjZW5lQ29yZVNldHRpbmdzLFxuICB0eXBlIFNjZW5lQ29yZVNldHRpbmdzUmVxdWVzdCxcbn0gZnJvbSAnLi9zY2VuZS9zY2VuZS1jb3JlLWF1dGhvcmluZyc7XG5cbmV4cG9ydCBpbnRlcmZhY2UgQXV0aG9yaW5nU3RhdGUge1xuICByZWFkb25seSBzZWxlY3Rpb246IEF1dGhvcmluZ1NlbGVjdGlvbjtcbiAgcmVhZG9ubHkgcm9vbVRhcmdldDoge1xuICAgIHJlYWRvbmx5IG9rOiBib29sZWFuO1xuICAgIHJlYWRvbmx5IG1vZGU6ICdncmlkJyB8ICdjYW52YXMnIHwgJ3NjZW5lLXJvb3QnIHwgJ2Jsb2NrZWQnO1xuICAgIHJlYWRvbmx5IHV1aWQ/OiBzdHJpbmc7XG4gICAgcmVhZG9ubHkgcGF0aD86IHN0cmluZztcbiAgICByZWFkb25seSBtZXNzYWdlOiBzdHJpbmc7XG4gIH07XHJcbiAgcmVhZG9ubHkgcm9vbXM6IFJldHVyblR5cGU8dHlwZW9mIGdldFJvb21DYXRhbG9nPjtcclxuICByZWFkb25seSB3YXJuaW5nczogcmVhZG9ubHkgc3RyaW5nW107XHJcbn1cclxuXHJcbmxldCBjYXRhbG9nV2FybmluZ3M6IHJlYWRvbmx5IHN0cmluZ1tdID0gW107XG5sZXQgY2F0YWxvZ0ZpbmdlcnByaW50ID0gJyc7XG5sZXQgY2F0YWxvZ1JlZnJlc2hUaW1lcjogUmV0dXJuVHlwZTx0eXBlb2Ygc2V0VGltZW91dD4gfCB1bmRlZmluZWQ7XG5sZXQgYXNzZXRDaGFuZ2VMaXN0ZW5lcjogKCguLi5hcmdzOiB1bmtub3duW10pID0+IHZvaWQpIHwgdW5kZWZpbmVkO1xubGV0IGV4dGVuc2lvbkxvYWRlZCA9IGZhbHNlO1xuXHJcbmV4cG9ydCBjb25zdCBtZXRob2RzID0ge1xyXG4gIG9wZW5Sb29tQ3JlYXRlKGNvbnRleHQ6IEFzc2V0TWVudUNvbnRleHQpIHtcclxuICAgIHJldHVybiBFZGl0b3IuUGFuZWwub3BlbihQQUNLQUdFX05BTUUsIGNvbnRleHQpO1xyXG4gIH0sXHJcbiAgb3BlbkF1dGhvcmluZ1BhbmVsKCkge1xyXG4gICAgcmV0dXJuIEVkaXRvci5QYW5lbC5vcGVuKGAke1BBQ0tBR0VfTkFNRX0uYXV0aG9yaW5nYCk7XHJcbiAgfSxcclxuICBjcmVhdGVSb29tQ29udGVudChyZXF1ZXN0OiBSb29tQ3JlYXRpb25SZXF1ZXN0KSB7XHJcbiAgICByZXR1cm4gY3JlYXRlUm9vbUNvbnRlbnRXaXRoQXNzZXREYihyZXF1ZXN0LCBlZGl0b3JBc3NldERiKS50aGVuKGFzeW5jIChyZXN1bHQpID0+IHtcclxuICAgICAgaWYgKCFyZXN1bHQub2spIHJldHVybiByZXN1bHQ7XHJcbiAgICAgIGxldCBmYWlsdXJlTWVzc2FnZTogc3RyaW5nIHwgbnVsbCA9IG51bGw7XHJcbiAgICAgIHRyeSB7XHJcbiAgICAgICAgY29uc3QgY29uZmlnVXVpZCA9IGF3YWl0IGVkaXRvckFzc2V0RGIucXVlcnlVdWlkKHJlc3VsdC5jb25maWdVcmwpO1xyXG4gICAgICAgIGlmIChjb25maWdVdWlkID09PSAnJykge1xyXG4gICAgICAgICAgZmFpbHVyZU1lc3NhZ2UgPSBg5Yib5bu65ZCO5om+5LiN5Yiw5oi/6Ze05a6a5LmJ6LWE5rqQ77yaJHtyZXN1bHQuY29uZmlnVXJsfWA7XHJcbiAgICAgICAgfSBlbHNlIHtcclxuICAgICAgICAgIGF3YWl0IEVkaXRvci5NZXNzYWdlLnJlcXVlc3QoJ2Fzc2V0LWRiJywgJ29wZW4tYXNzZXQnLCByZXN1bHQucHJlZmFiVXJsKTtcclxuICAgICAgICAgIGNvbnN0IGJpbmRpbmcgPSBhd2FpdCBiaW5kUm9vbURlZmluaXRpb25Ub09wZW5QcmVmYWIoZWRpdG9yU2NlbmVRdWVyeSwgY29uZmlnVXVpZCwgcmVxdWVzdC5pZCk7XHJcbiAgICAgICAgICBpZiAoYmluZGluZy5vaykge1xyXG4gICAgICAgICAgICBjb25zdCByZWZyZXNoZWQgPSBhd2FpdCByZWZyZXNoUm9vbUNhdGFsb2dOb3coKTtcclxuICAgICAgICAgICAgY29uc3Qgd2FybmluZyA9IHJlZnJlc2hlZC53YXJuaW5ncy5sZW5ndGggPiAwXHJcbiAgICAgICAgICAgICAgPyBg77yI5YiX6KGo5Yi35paw5pyJICR7cmVmcmVzaGVkLndhcm5pbmdzLmxlbmd0aH0g5p2h6K2m5ZGK77yJYFxyXG4gICAgICAgICAgICAgIDogJyc7XHJcbiAgICAgICAgICAgIHJldHVybiB7IC4uLnJlc3VsdCwgbWVzc2FnZTogYCR7cmVzdWx0Lm1lc3NhZ2V9JHtiaW5kaW5nLm1lc3NhZ2V9JHt3YXJuaW5nfWAgfTtcclxuICAgICAgICAgIH1cclxuICAgICAgICAgIGZhaWx1cmVNZXNzYWdlID0gYmluZGluZy5tZXNzYWdlO1xyXG4gICAgICAgIH1cclxuICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgICBmYWlsdXJlTWVzc2FnZSA9IGVycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvci5tZXNzYWdlIDogU3RyaW5nKGVycm9yKTtcclxuICAgICAgfVxyXG4gICAgICBjb25zdCByb2xsYmFja0Vycm9yczogc3RyaW5nW10gPSBbXTtcclxuICAgICAgZm9yIChjb25zdCB1cmwgb2YgW3Jlc3VsdC5wcmVmYWJVcmwsIHJlc3VsdC5jb25maWdVcmxdKSB7XHJcbiAgICAgICAgdHJ5IHtcclxuICAgICAgICAgIGF3YWl0IGVkaXRvckFzc2V0RGIuZGVsZXRlQXNzZXQodXJsKTtcclxuICAgICAgICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgICAgICAgcm9sbGJhY2tFcnJvcnMucHVzaChgJHt1cmx977yaJHtlcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZXJyb3IubWVzc2FnZSA6IFN0cmluZyhlcnJvcil9YCk7XHJcbiAgICAgICAgfVxyXG4gICAgICB9XHJcbiAgICAgIHJldHVybiB7XHJcbiAgICAgICAgb2s6IGZhbHNlIGFzIGNvbnN0LFxyXG4gICAgICAgIG1lc3NhZ2U6IGAke2ZhaWx1cmVNZXNzYWdlID8/ICfmiL/pl7TlrprkuYnnu5HlrprlpLHotKUnfe+8m+W3suWbnua7muaWsOi1hOa6kCR7cm9sbGJhY2tFcnJvcnMubGVuZ3RoID09PSAwID8gJycgOiBg77yM5Zue5rua5aSx6LSl77yaJHtyb2xsYmFja0Vycm9ycy5qb2luKCfvvJsnKX1gfWAsXHJcbiAgICAgIH07XHJcbiAgICB9KTtcclxuICB9LFxyXG4gIG9wZW5DcmVhdGVkUHJlZmFiKHByZWZhYlVybDogc3RyaW5nKSB7XHJcbiAgICByZXR1cm4gRWRpdG9yLk1lc3NhZ2UucmVxdWVzdCgnYXNzZXQtZGInLCAnb3Blbi1hc3NldCcsIHByZWZhYlVybCk7XHJcbiAgfSxcclxuICB2YWxpZGF0ZU9wZW5Sb29tUHJlZmFiKCkge1xyXG4gICAgcmV0dXJuIHZhbGlkYXRlT3BlblJvb21QcmVmYWIoZWRpdG9yU2NlbmVRdWVyeSk7XHJcbiAgfSxcclxuICBhc3luYyByZWZyZXNoQXV0aG9yaW5nU3RhdGUoKSB7XHJcbiAgICBhd2FpdCByZWZyZXNoUm9vbUNhdGFsb2dOb3coKTtcclxuICAgIHJldHVybiBhd2FpdCBnZXRBdXRob3JpbmdTdGF0ZSgpO1xyXG4gIH0sXHJcbiAgaW5pdGlhbGl6ZVByb3RvdHlwZVNjZW5lKCkge1xyXG4gICAgcmV0dXJuIGluaXRpYWxpemVQcm90b3R5cGVTY2VuZShlZGl0b3JTY2VuZVF1ZXJ5KTtcclxuICB9LFxyXG4gIGFzeW5jIGdldEF1dGhvcmluZ1N0YXRlKCkge1xyXG4gICAgcmV0dXJuIGF3YWl0IGdldEF1dGhvcmluZ1N0YXRlKCk7XHJcbiAgfSxcclxuICBhc3luYyBjcmVhdGVSb29tSW5zdGFuY2UoZW50cnk6IFBhcmFtZXRlcnM8dHlwZW9mIGNyZWF0ZVJvb21Gcm9tU2VsZWN0aW9uPlswXSkge1xyXG4gICAgcmV0dXJuIGF3YWl0IGNyZWF0ZVJvb21Gcm9tU2VsZWN0aW9uKGVudHJ5LCB7IG5vZGVVdWlkOiBnZXRTZWxlY3RlZE5vZGVVdWlkKCkgfSk7XHJcbiAgfSxcclxuICBhc3luYyB1cGRhdGVSb29tRGVmaW5pdGlvbihyZXF1ZXN0OiBSb29tRGVmaW5pdGlvbkVkaXRSZXF1ZXN0KSB7XG4gICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgdXBkYXRlUm9vbURlZmluaXRpb24ocmVxdWVzdCwgZWRpdG9yQXNzZXREYik7XHJcbiAgICBpZiAocmVzdWx0Lm9rKSBhd2FpdCByZWZyZXNoUm9vbUNhdGFsb2dOb3coKTtcclxuICAgIHJldHVybiByZXN1bHQ7XG4gIH0sXG4gIGFzeW5jIHVwZGF0ZVNjZW5lQ29yZVNldHRpbmdzKHJlcXVlc3Q6IFNjZW5lQ29yZVNldHRpbmdzUmVxdWVzdCkge1xuICAgIHJldHVybiBhd2FpdCB1cGRhdGVTY2VuZUNvcmVTZXR0aW5ncyhlZGl0b3JTY2VuZVF1ZXJ5LCBnZXRTZWxlY3RlZE5vZGVVdWlkKCksIHJlcXVlc3QpO1xuICB9LFxufTtcblxyXG5leHBvcnQgZnVuY3Rpb24gbG9hZCgpOiB2b2lkIHtcbiAgZXh0ZW5zaW9uTG9hZGVkID0gdHJ1ZTtcbiAgcmVnaXN0ZXJBc3NldENoYW5nZUxpc3RlbmVyKCk7XG4gIHZvaWQgcmVmcmVzaFJvb21DYXRhbG9nTm93KCkuY2F0Y2goKGNhdXNlOiB1bmtub3duKSA9PiB7XG4gICAgY29uc29sZS53YXJuKGBbUk9PTV0g5oi/6Ze05bu6562R5YiX6KGo5Yi35paw5aSx6LSl77yaJHtjYXVzZSBpbnN0YW5jZW9mIEVycm9yID8gY2F1c2UubWVzc2FnZSA6IFN0cmluZyhjYXVzZSl9YCk7XG4gIH0pO1xufVxuZXhwb3J0IGZ1bmN0aW9uIHVubG9hZCgpOiB2b2lkIHtcbiAgZXh0ZW5zaW9uTG9hZGVkID0gZmFsc2U7XG4gIGNvbnN0IG1lc3NhZ2UgPSBnZXRCcm9hZGNhc3RNZXNzYWdlUG9ydCgpO1xuICBpZiAoYXNzZXRDaGFuZ2VMaXN0ZW5lciAhPT0gdW5kZWZpbmVkKSB7XG4gICAgbWVzc2FnZT8ucmVtb3ZlQnJvYWRjYXN0TGlzdGVuZXI/LignYXNzZXQtZGI6YXNzZXQtY2hhbmdlJywgYXNzZXRDaGFuZ2VMaXN0ZW5lcik7XG4gICAgYXNzZXRDaGFuZ2VMaXN0ZW5lciA9IHVuZGVmaW5lZDtcbiAgfVxuICBpZiAoY2F0YWxvZ1JlZnJlc2hUaW1lciAhPT0gdW5kZWZpbmVkKSB7XG4gICAgY2xlYXJUaW1lb3V0KGNhdGFsb2dSZWZyZXNoVGltZXIpO1xuICAgIGNhdGFsb2dSZWZyZXNoVGltZXIgPSB1bmRlZmluZWQ7XG4gIH1cbn1cblxuYXN5bmMgZnVuY3Rpb24gcmVmcmVzaFJvb21DYXRhbG9nTm93KCkge1xuICBjb25zdCByZXN1bHQgPSBhd2FpdCBkaXNjb3ZlclJvb21QcmVmYWJzKGVkaXRvckFzc2V0RGIpO1xuICBzZXRSb29tQ2F0YWxvZyhyZXN1bHQuZW50cmllcyk7XG4gIGNhdGFsb2dXYXJuaW5ncyA9IHJlc3VsdC53YXJuaW5ncztcbiAgY29uc3QgbmV4dEZpbmdlcnByaW50ID0gSlNPTi5zdHJpbmdpZnkoeyBlbnRyaWVzOiByZXN1bHQuZW50cmllcywgd2FybmluZ3M6IHJlc3VsdC53YXJuaW5ncyB9KTtcbiAgY29uc3QgY2hhbmdlZCA9IG5leHRGaW5nZXJwcmludCAhPT0gY2F0YWxvZ0ZpbmdlcnByaW50O1xuICBjYXRhbG9nRmluZ2VycHJpbnQgPSBuZXh0RmluZ2VycHJpbnQ7XG4gIGZvciAoY29uc3Qgd2FybmluZyBvZiByZXN1bHQud2FybmluZ3MpIGNvbnNvbGUud2FybihgW1JPT01dICR7d2FybmluZ31gKTtcbiAgaWYgKGNoYW5nZWQpIGdldEJyb2FkY2FzdE1lc3NhZ2VQb3J0KCk/LmJyb2FkY2FzdD8uKFJPT01fQ0FUQUxPR19DSEFOR0VfTUVTU0FHRSk7XG4gIHJldHVybiByZXN1bHQ7XG59XG5cclxuYXN5bmMgZnVuY3Rpb24gZ2V0QXV0aG9yaW5nU3RhdGUoKTogUHJvbWlzZTxBdXRob3JpbmdTdGF0ZT4ge1xuICBjb25zdCBzZWxlY3RlZFV1aWQgPSBnZXRTZWxlY3RlZE5vZGVVdWlkKCk7XG4gIHRyeSB7XG4gICAgY29uc3QgdHJlZSA9IGF3YWl0IGVkaXRvclNjZW5lUXVlcnkucXVlcnlOb2RlVHJlZSgpO1xuICAgIGNvbnN0IHNlbGVjdGVkTm9kZSA9IHNlbGVjdGVkVXVpZCA9PT0gdW5kZWZpbmVkID8gdW5kZWZpbmVkIDogZmxhdHRlblRyZWUodHJlZSkuZmluZCgobm9kZSkgPT4gbm9kZS51dWlkID09PSBzZWxlY3RlZFV1aWQpO1xuICAgIC8vIENyZWF0b3Ig5ZCv5Yqo5oiW5YiH5Zy65pmv55qE556s6Ze077yM57uE5Lu25rOo5YaM6KGo5Y+v6IO96L+Y5pyq5ZON5bqU77yb5a6D5Y+q55So5LqO6L+Y5Y6f5Y6L57ypIENJRO+8jFxuICAgIC8vIOS4jeiDveWboOS4uui/meS4qui+heWKqeafpeivouWksei0peWwseaKiuW3suaciSBDYW52YXMv5Zy65pmv5qC55Yik5a6a5Li65LiN5Y+v5Yib5bu644CCXG4gICAgY29uc3QgY29tcG9uZW50Q2xhc3NlcyA9IGVkaXRvclNjZW5lUXVlcnkucXVlcnlDb21wb25lbnRzID09PSB1bmRlZmluZWRcbiAgICAgID8gW11cbiAgICAgIDogYXdhaXQgZWRpdG9yU2NlbmVRdWVyeS5xdWVyeUNvbXBvbmVudHMoKS5jYXRjaCgoKSA9PiBbXSk7XG4gICAgY29uc3QgdGFyZ2V0ID0gcmVzb2x2ZVJvb21QbGFjZW1lbnRUYXJnZXQodHJlZSwgeyBub2RlVXVpZDogc2VsZWN0ZWRVdWlkIH0sIGNvbXBvbmVudENsYXNzZXMpO1xuICAgIGNvbnN0IHJvb21UYXJnZXQgPSB0YXJnZXQub2tcbiAgICAgID8ge1xuICAgICAgICBvazogdHJ1ZSxcbiAgICAgICAgbW9kZTogdGFyZ2V0Lm1vZGUsXG4gICAgICAgIHV1aWQ6IHRhcmdldC5ub2RlLnV1aWQsXG4gICAgICAgIHBhdGg6IGdldE5vZGVQYXRoKHRyZWUsIHRhcmdldC5ub2RlLnV1aWQpLFxuICAgICAgICBtZXNzYWdlOiB0YXJnZXQubWVzc2FnZSxcbiAgICAgIH1cbiAgICAgIDogeyBvazogZmFsc2UsIG1vZGU6ICdibG9ja2VkJyBhcyBjb25zdCwgbWVzc2FnZTogdGFyZ2V0Lm1lc3NhZ2UgfTtcbiAgICByZXR1cm4ge1xuICAgICAgc2VsZWN0aW9uOiBhd2FpdCByZWNvZ25pemVBdXRob3JpbmdTZWxlY3Rpb24oe1xuICAgICAgICBzZWxlY3RlZE5vZGUsXG4gICAgICAgIHRyZWUsXG4gICAgICAgIGNvbXBvbmVudENsYXNzZXMsXG4gICAgICAgIHNjZW5lOiBlZGl0b3JTY2VuZVF1ZXJ5LFxuICAgICAgICByb29tczogZ2V0Um9vbUNhdGFsb2coKSxcbiAgICAgIH0pLFxuICAgICAgcm9vbVRhcmdldCxcbiAgICAgIHJvb21zOiBnZXRSb29tQ2F0YWxvZygpLFxyXG4gICAgICB3YXJuaW5nczogY2F0YWxvZ1dhcm5pbmdzLFxyXG4gICAgfTtcclxuICB9IGNhdGNoIChjYXVzZSkge1xuICAgIHJldHVybiB7XG4gICAgICBzZWxlY3Rpb246IHsga2luZDogJ25vbmUnLCB0eXBlSWQ6ICdub25lJywgcGFnZTogJ3NjZW5lJywgdXVpZDogc2VsZWN0ZWRVdWlkIH0sXG4gICAgICByb29tVGFyZ2V0OiB7IG9rOiBmYWxzZSwgbW9kZTogJ2Jsb2NrZWQnLCBtZXNzYWdlOiBg5peg5rOV6K+75Y+W5b2T5YmN5Zy65pmv77yaJHtjYXVzZSBpbnN0YW5jZW9mIEVycm9yID8gY2F1c2UubWVzc2FnZSA6IFN0cmluZyhjYXVzZSl9YCB9LFxuICAgICAgcm9vbXM6IGdldFJvb21DYXRhbG9nKCksXHJcbiAgICAgIHdhcm5pbmdzOiBjYXRhbG9nV2FybmluZ3MsXHJcbiAgICB9O1xyXG4gIH1cclxufVxyXG5cclxuZnVuY3Rpb24gZ2V0U2VsZWN0ZWROb2RlVXVpZCgpOiBzdHJpbmcgfCB1bmRlZmluZWQge1xuICB0cnkge1xuICAgIGNvbnN0IHNlbGVjdGlvbiA9IChnbG9iYWxUaGlzIGFzIHtcbiAgICAgIEVkaXRvcj86IHsgU2VsZWN0aW9uPzogeyBnZXRTZWxlY3RlZD86ICh0eXBlOiBzdHJpbmcpID0+IHJlYWRvbmx5IHN0cmluZ1tdIH0gfTtcbiAgICB9KS5FZGl0b3I/LlNlbGVjdGlvbjtcbiAgICByZXR1cm4gc2VsZWN0aW9uPy5nZXRTZWxlY3RlZD8uKCdub2RlJyk/LlswXTtcbiAgfSBjYXRjaCB7XG4gICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgfVxufVxuXG5mdW5jdGlvbiByZWdpc3RlckFzc2V0Q2hhbmdlTGlzdGVuZXIoKTogdm9pZCB7XG4gIGlmIChhc3NldENoYW5nZUxpc3RlbmVyICE9PSB1bmRlZmluZWQpIHJldHVybjtcbiAgY29uc3QgbWVzc2FnZSA9IGdldEJyb2FkY2FzdE1lc3NhZ2VQb3J0KCk7XG4gIGlmIChtZXNzYWdlPy5hZGRCcm9hZGNhc3RMaXN0ZW5lciA9PT0gdW5kZWZpbmVkKSByZXR1cm47XG4gIGFzc2V0Q2hhbmdlTGlzdGVuZXIgPSAoLi4uYXJnczogdW5rbm93bltdKSA9PiB7XG4gICAgdm9pZCBoYW5kbGVBc3NldENoYW5nZShhcmdzWzBdKTtcbiAgfTtcbiAgbWVzc2FnZS5hZGRCcm9hZGNhc3RMaXN0ZW5lcignYXNzZXQtZGI6YXNzZXQtY2hhbmdlJywgYXNzZXRDaGFuZ2VMaXN0ZW5lcik7XG59XG5cbmFzeW5jIGZ1bmN0aW9uIGhhbmRsZUFzc2V0Q2hhbmdlKHZhbHVlOiB1bmtub3duKTogUHJvbWlzZTx2b2lkPiB7XG4gIGNvbnN0IHV1aWQgPSByZWFkQXNzZXRDaGFuZ2VVdWlkKHZhbHVlKTtcbiAgaWYgKHV1aWQgIT09IHVuZGVmaW5lZCAmJiAhYXdhaXQgaXNSb29tQXNzZXRDaGFuZ2UodXVpZCkpIHJldHVybjtcbiAgaWYgKCFleHRlbnNpb25Mb2FkZWQpIHJldHVybjtcbiAgaWYgKGNhdGFsb2dSZWZyZXNoVGltZXIgIT09IHVuZGVmaW5lZCkgY2xlYXJUaW1lb3V0KGNhdGFsb2dSZWZyZXNoVGltZXIpO1xuICBjYXRhbG9nUmVmcmVzaFRpbWVyID0gc2V0VGltZW91dCgoKSA9PiB7XG4gICAgY2F0YWxvZ1JlZnJlc2hUaW1lciA9IHVuZGVmaW5lZDtcbiAgICB2b2lkIHJlZnJlc2hSb29tQ2F0YWxvZ05vdygpLmNhdGNoKChjYXVzZTogdW5rbm93bikgPT4ge1xuICAgICAgY29uc29sZS53YXJuKGBbUk9PTV0g5oi/6Ze05bu6562R5YiX6KGo6Ieq5Yqo5Yi35paw5aSx6LSl77yaJHtjYXVzZSBpbnN0YW5jZW9mIEVycm9yID8gY2F1c2UubWVzc2FnZSA6IFN0cmluZyhjYXVzZSl9YCk7XG4gICAgfSk7XG4gIH0sIDIwMCk7XG59XG5cbmFzeW5jIGZ1bmN0aW9uIGlzUm9vbUFzc2V0Q2hhbmdlKHV1aWQ6IHN0cmluZyk6IFByb21pc2U8Ym9vbGVhbj4ge1xuICBpZiAoZ2V0Um9vbUNhdGFsb2coKS5zb21lKChlbnRyeSkgPT4gZW50cnkucHJlZmFiVXVpZCA9PT0gdXVpZCB8fCBlbnRyeS5jb25maWdVdWlkID09PSB1dWlkKSkgcmV0dXJuIHRydWU7XG4gIHRyeSB7XG4gICAgY29uc3QgaW5mbyA9IGF3YWl0IGVkaXRvckFzc2V0RGIucXVlcnlJbmZvKHV1aWQpO1xuICAgIHJldHVybiBpbmZvID09PSBudWxsIHx8IGlzUm9vbUFzc2V0VXJsKGluZm8udXJsKTtcbiAgfSBjYXRjaCB7XG4gICAgLy8g6LWE5rqQ5Yig6Zmk5oiW5a+85YWl6L+H56iL5Lit55qE5Li05pe25p+l6K+i5aSx6LSl5LiN6IO96K6p5oi/6Ze055uu5b2V5YGc55WZ5Zyo5pen54q25oCB44CCXG4gICAgcmV0dXJuIHRydWU7XG4gIH1cbn1cblxuZnVuY3Rpb24gaXNSb29tQXNzZXRVcmwodXJsOiBzdHJpbmcpOiBib29sZWFuIHtcbiAgcmV0dXJuICh1cmwuc3RhcnRzV2l0aChgJHtST09NX0NPTkZJR19ESVJFQ1RPUll9L2ApICYmIHVybC5lbmRzV2l0aCgnLmpzb24nKSlcbiAgICB8fCAodXJsLnN0YXJ0c1dpdGgoYCR7REVGQVVMVF9QUkVGQUJfRElSRUNUT1JZfS9gKSAmJiB1cmwuZW5kc1dpdGgoJy5wcmVmYWInKSk7XG59XG5cbmZ1bmN0aW9uIHJlYWRBc3NldENoYW5nZVV1aWQodmFsdWU6IHVua25vd24pOiBzdHJpbmcgfCB1bmRlZmluZWQge1xuICBpZiAodHlwZW9mIHZhbHVlID09PSAnc3RyaW5nJyAmJiB2YWx1ZSAhPT0gJycpIHJldHVybiB2YWx1ZTtcbiAgaWYgKHR5cGVvZiB2YWx1ZSA9PT0gJ29iamVjdCcgJiYgdmFsdWUgIT09IG51bGwpIHtcbiAgICBjb25zdCB1dWlkID0gKHZhbHVlIGFzIHsgdXVpZD86IHVua25vd24gfSkudXVpZDtcbiAgICByZXR1cm4gdHlwZW9mIHV1aWQgPT09ICdzdHJpbmcnICYmIHV1aWQgIT09ICcnID8gdXVpZCA6IHVuZGVmaW5lZDtcbiAgfVxuICByZXR1cm4gdW5kZWZpbmVkO1xufVxuXG5pbnRlcmZhY2UgQnJvYWRjYXN0TWVzc2FnZVBvcnQge1xuICBhZGRCcm9hZGNhc3RMaXN0ZW5lcj8obmFtZTogc3RyaW5nLCBjYWxsYmFjazogKC4uLmFyZ3M6IHVua25vd25bXSkgPT4gdm9pZCk6IHZvaWQ7XG4gIHJlbW92ZUJyb2FkY2FzdExpc3RlbmVyPyhuYW1lOiBzdHJpbmcsIGNhbGxiYWNrOiAoLi4uYXJnczogdW5rbm93bltdKSA9PiB2b2lkKTogdm9pZDtcbiAgYnJvYWRjYXN0PyhuYW1lOiBzdHJpbmcsIC4uLmFyZ3M6IHVua25vd25bXSk6IHZvaWQ7XG59XG5cbmZ1bmN0aW9uIGdldEJyb2FkY2FzdE1lc3NhZ2VQb3J0KCk6IEJyb2FkY2FzdE1lc3NhZ2VQb3J0IHwgdW5kZWZpbmVkIHtcbiAgY29uc3QgbWVzc2FnZSA9IChnbG9iYWxUaGlzIGFzIHsgRWRpdG9yPzogeyBNZXNzYWdlPzogdW5rbm93biB9IH0pLkVkaXRvcj8uTWVzc2FnZTtcbiAgcmV0dXJuIHR5cGVvZiBtZXNzYWdlID09PSAnb2JqZWN0JyAmJiBtZXNzYWdlICE9PSBudWxsID8gbWVzc2FnZSBhcyBCcm9hZGNhc3RNZXNzYWdlUG9ydCA6IHVuZGVmaW5lZDtcbn1cblxyXG5mdW5jdGlvbiBmbGF0dGVuVHJlZSh0cmVlOiBTY2VuZU5vZGVUcmVlKTogU2NlbmVOb2RlVHJlZVtdIHtcclxuICBjb25zdCByZXN1bHQ6IFNjZW5lTm9kZVRyZWVbXSA9IFtdO1xyXG4gIGNvbnN0IHZpc2l0ID0gKG5vZGU6IFNjZW5lTm9kZVRyZWUsIHBhcmVudD86IHN0cmluZyk6IHZvaWQgPT4ge1xyXG4gICAgcmVzdWx0LnB1c2gocGFyZW50ID09PSB1bmRlZmluZWQgfHwgbm9kZS5wYXJlbnQgIT09IHVuZGVmaW5lZCA/IG5vZGUgOiB7IC4uLm5vZGUsIHBhcmVudCB9KTtcclxuICAgIGZvciAoY29uc3QgY2hpbGQgb2Ygbm9kZS5jaGlsZHJlbiA/PyBbXSkgdmlzaXQoY2hpbGQsIG5vZGUudXVpZCk7XHJcbiAgfTtcclxuICB2aXNpdCh0cmVlKTtcclxuICByZXR1cm4gcmVzdWx0O1xyXG59XHJcblxyXG5mdW5jdGlvbiBnZXROb2RlUGF0aCh0cmVlOiBTY2VuZU5vZGVUcmVlLCB1dWlkOiBzdHJpbmcgfCB1bmRlZmluZWQpOiBzdHJpbmcgfCB1bmRlZmluZWQge1xyXG4gIGlmICh1dWlkID09PSB1bmRlZmluZWQpIHJldHVybiB1bmRlZmluZWQ7XHJcbiAgY29uc3Qgbm9kZXMgPSBmbGF0dGVuVHJlZSh0cmVlKTtcclxuICBjb25zdCBieVV1aWQgPSBuZXcgTWFwKG5vZGVzLmZpbHRlcigobm9kZSkgPT4gbm9kZS51dWlkICE9PSB1bmRlZmluZWQpLm1hcCgobm9kZSkgPT4gW25vZGUudXVpZCBhcyBzdHJpbmcsIG5vZGVdKSk7XHJcbiAgY29uc3QgbmFtZXM6IHN0cmluZ1tdID0gW107XHJcbiAgbGV0IGN1cnNvciA9IGJ5VXVpZC5nZXQodXVpZCk7XHJcbiAgd2hpbGUgKGN1cnNvciAhPT0gdW5kZWZpbmVkKSB7XHJcbiAgICBpZiAoY3Vyc29yLm5hbWUgIT09IHVuZGVmaW5lZCkgbmFtZXMudW5zaGlmdChjdXJzb3IubmFtZSk7XHJcbiAgICBjdXJzb3IgPSBjdXJzb3IucGFyZW50ID09PSB1bmRlZmluZWQgPyB1bmRlZmluZWQgOiBieVV1aWQuZ2V0KGN1cnNvci5wYXJlbnQpO1xyXG4gIH1cclxuICByZXR1cm4gbmFtZXMuam9pbignLycpO1xyXG59XHJcbiJdfQ==