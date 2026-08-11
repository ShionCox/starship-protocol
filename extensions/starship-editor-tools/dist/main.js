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
const r1_energy_authoring_1 = require("./scene/r1-energy-authoring");
const discover_crew_prefabs_1 = require("./crew/discover-crew-prefabs");
const create_crew_content_1 = require("./crew/create-crew-content");
const bind_crew_prefab_1 = require("./crew/bind-crew-prefab");
const crew_module_1 = require("./crew/crew-module");
const edit_crew_definition_1 = require("./crew/edit-crew-definition");
const r1_crew_authoring_1 = require("./scene/r1-crew-authoring");
const prefab_template_authoring_1 = require("./scene/prefab-template-authoring");
let catalogWarnings = [];
let crewCatalogWarnings = [];
let catalogFingerprint = '';
let crewCatalogFingerprint = '';
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
    createCrewContent(request) {
        return (0, create_crew_content_1.createCrewContent)(request, editor_asset_db_1.editorAssetDb).then(async (result) => {
            if (!result.ok)
                return result;
            let failureMessage = null;
            try {
                const configUuid = await editor_asset_db_1.editorAssetDb.queryUuid(result.configUrl);
                if (configUuid === '')
                    failureMessage = `创建后找不到船员定义资源：${result.configUrl}`;
                else {
                    await Editor.Message.request('asset-db', 'open-asset', result.prefabUrl);
                    const binding = await (0, bind_crew_prefab_1.bindCrewDefinitionToOpenPrefab)(editor_scene_1.editorSceneQuery, configUuid, request.id, request.role);
                    if (binding.ok) {
                        await refreshCrewCatalogNow();
                        return Object.assign(Object.assign({}, result), { message: `${result.message}${binding.message}` });
                    }
                    failureMessage = binding.message;
                }
            }
            catch (cause) {
                failureMessage = cause instanceof Error ? cause.message : String(cause);
            }
            const rollbackErrors = await (0, create_crew_content_1.rollbackCrewAssets)(editor_asset_db_1.editorAssetDb, [result.prefabUrl, result.configUrl]);
            const rollbackMessage = rollbackErrors.length === 0
                ? '已回滚新资源'
                : `回滚失败，资源清理未完成，无法确认以下资源已删除：${rollbackErrors.join('；')}`;
            return { ok: false, message: `${failureMessage !== null && failureMessage !== void 0 ? failureMessage : '船员定义绑定失败'}；${rollbackMessage}` };
        });
    },
    openCreatedPrefab(prefabUrl) {
        return Editor.Message.request('asset-db', 'open-asset', prefabUrl);
    },
    validateOpenRoomPrefab() {
        return (0, validate_open_room_prefab_1.validateOpenRoomPrefab)(editor_scene_1.editorSceneQuery);
    },
    async refreshAuthoringState() {
        await Promise.all([refreshRoomCatalogNow(), refreshCrewCatalogNow()]);
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
    async createCrewInstance(entry) {
        return await (0, crew_module_1.createCrewFromSelection)(entry, { nodeUuid: getSelectedNodeUuid() });
    },
    async updateRoomDefinition(request) {
        const result = await (0, edit_room_definition_1.updateRoomDefinition)(request, editor_asset_db_1.editorAssetDb);
        if (result.ok)
            await refreshRoomCatalogNow();
        return result;
    },
    async updateCrewDefinition(request) {
        const result = await (0, edit_crew_definition_1.updateCrewDefinition)(request, editor_asset_db_1.editorAssetDb);
        if (result.ok)
            await refreshCrewCatalogNow();
        return result;
    },
    async updateSceneCoreSettings(request) {
        return await (0, scene_core_authoring_1.updateSceneCoreSettings)(editor_scene_1.editorSceneQuery, getSelectedNodeUuid(), request);
    },
    async configureR1EnergyScene() {
        const result = await (0, r1_energy_authoring_1.configureR1EnergyScene)(editor_scene_1.editorSceneQuery);
        if (result.ok)
            await Editor.Message.request('scene', 'save-scene');
        return result;
    },
    async configureR1CrewScene() {
        const result = await (0, r1_crew_authoring_1.configureR1CrewScene)(editor_scene_1.editorSceneQuery);
        if (result.ok)
            await Editor.Message.request('scene', 'save-scene');
        return result;
    },
    async createCrewMemberTemplate() {
        return await (0, prefab_template_authoring_1.createCrewMemberTemplate)(editor_asset_db_1.editorAssetDb, editor_scene_1.editorSceneQuery);
    },
    async createPowerRoomRowTemplate() {
        return await (0, prefab_template_authoring_1.createPowerRoomRowTemplate)(editor_asset_db_1.editorAssetDb, editor_scene_1.editorSceneQuery);
    },
    async replacePowerRowsWithPrefab() {
        return await (0, prefab_template_authoring_1.replacePowerRowsWithPrefab)(editor_asset_db_1.editorAssetDb, editor_scene_1.editorSceneQuery);
    },
};
function load() {
    extensionLoaded = true;
    registerAssetChangeListener();
    void Promise.all([refreshRoomCatalogNow(), refreshCrewCatalogNow()]).catch((cause) => {
        console.warn(`[AUTHORING] 创作资源列表刷新失败：${cause instanceof Error ? cause.message : String(cause)}`);
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
async function refreshCrewCatalogNow() {
    var _a, _b;
    const result = await (0, discover_crew_prefabs_1.discoverCrewPrefabs)(editor_asset_db_1.editorAssetDb);
    (0, crew_module_1.setCrewCatalog)(result.entries);
    crewCatalogWarnings = result.warnings;
    const nextFingerprint = JSON.stringify({ entries: result.entries, warnings: result.warnings });
    const changed = nextFingerprint !== crewCatalogFingerprint;
    crewCatalogFingerprint = nextFingerprint;
    for (const warning of result.warnings)
        console.warn(`[CREW] ${warning}`);
    if (changed)
        (_b = (_a = getBroadcastMessagePort()) === null || _a === void 0 ? void 0 : _a.broadcast) === null || _b === void 0 ? void 0 : _b.call(_a, constants_1.CREW_CATALOG_CHANGE_MESSAGE);
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
                crews: (0, crew_module_1.getCrewCatalog)(),
            }),
            roomTarget,
            rooms: (0, room_module_1.getRoomCatalog)(),
            crews: (0, crew_module_1.getCrewCatalog)(),
            warnings: [...catalogWarnings, ...crewCatalogWarnings],
        };
    }
    catch (cause) {
        return {
            selection: { kind: 'none', typeId: 'none', page: 'scene', uuid: selectedUuid },
            roomTarget: { ok: false, mode: 'blocked', message: `无法读取当前场景：${cause instanceof Error ? cause.message : String(cause)}` },
            rooms: (0, room_module_1.getRoomCatalog)(),
            crews: (0, crew_module_1.getCrewCatalog)(),
            warnings: [...catalogWarnings, ...crewCatalogWarnings],
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
    if (uuid !== undefined && !await isAuthoringAssetChange(uuid))
        return;
    if (!extensionLoaded)
        return;
    if (catalogRefreshTimer !== undefined)
        clearTimeout(catalogRefreshTimer);
    catalogRefreshTimer = setTimeout(() => {
        catalogRefreshTimer = undefined;
        void Promise.all([refreshRoomCatalogNow(), refreshCrewCatalogNow()]).catch((cause) => {
            console.warn(`[AUTHORING] 创作资源列表自动刷新失败：${cause instanceof Error ? cause.message : String(cause)}`);
        });
    }, 200);
}
async function isAuthoringAssetChange(uuid) {
    if ((0, room_module_1.getRoomCatalog)().some((entry) => entry.prefabUuid === uuid || entry.configUuid === uuid))
        return true;
    if ((0, crew_module_1.getCrewCatalog)().some((entry) => entry.prefabUuid === uuid || entry.configUuid === uuid))
        return true;
    try {
        const info = await editor_asset_db_1.editorAssetDb.queryInfo(uuid);
        return info === null || isAuthoringAssetUrl(info.url);
    }
    catch (_a) {
        // 资源删除或导入过程中的临时查询失败不能让房间目录停留在旧状态。
        return true;
    }
}
function isAuthoringAssetUrl(url) {
    return (url.startsWith(`${constants_1.ROOM_CONFIG_DIRECTORY}/`) && url.endsWith('.json'))
        || (url.startsWith(`${constants_1.CREW_CONFIG_DIRECTORY}/`) && url.endsWith('.json'))
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibWFpbi5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uL3NyYy9tYWluLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7OztBQWdOQSxvQkFNQztBQUNELHdCQVdDO0FBbE9ELDJDQU9xQjtBQUVyQixxRUFHcUM7QUFDckMsOERBQXlEO0FBQ3pELHdEQUF5RDtBQUN6RCxpRkFBMkU7QUFDM0UseUVBQW9FO0FBQ3BFLHFEQUk2QjtBQUM3QixtRUFBc0U7QUFDdEUsK0RBQTBFO0FBQzFFLHVFQUEwRTtBQUMxRSx1RUFHc0M7QUFFdEMsK0RBRytCO0FBQy9CLHVFQUdzQztBQUN0QyxxRUFBcUU7QUFDckUsd0VBQW1FO0FBQ25FLG9FQUlvQztBQUNwQyw4REFBeUU7QUFDekUsb0RBQTZGO0FBQzdGLHNFQUFtRztBQUNuRyxpRUFBaUU7QUFDakUsaUZBSTJDO0FBZ0IzQyxJQUFJLGVBQWUsR0FBc0IsRUFBRSxDQUFDO0FBQzVDLElBQUksbUJBQW1CLEdBQXNCLEVBQUUsQ0FBQztBQUNoRCxJQUFJLGtCQUFrQixHQUFHLEVBQUUsQ0FBQztBQUM1QixJQUFJLHNCQUFzQixHQUFHLEVBQUUsQ0FBQztBQUNoQyxJQUFJLG1CQUE4RCxDQUFDO0FBQ25FLElBQUksbUJBQStELENBQUM7QUFDcEUsSUFBSSxlQUFlLEdBQUcsS0FBSyxDQUFDO0FBRWYsUUFBQSxPQUFPLEdBQUc7SUFDckIsY0FBYyxDQUFDLE9BQXlCO1FBQ3RDLE9BQU8sTUFBTSxDQUFDLEtBQUssQ0FBQyxJQUFJLENBQUMsd0JBQVksRUFBRSxPQUFPLENBQUMsQ0FBQztJQUNsRCxDQUFDO0lBQ0Qsa0JBQWtCO1FBQ2hCLE9BQU8sTUFBTSxDQUFDLEtBQUssQ0FBQyxJQUFJLENBQUMsR0FBRyx3QkFBWSxZQUFZLENBQUMsQ0FBQztJQUN4RCxDQUFDO0lBQ0QsaUJBQWlCLENBQUMsT0FBNEI7UUFDNUMsT0FBTyxJQUFBLHVDQUE0QixFQUFDLE9BQU8sRUFBRSwrQkFBYSxDQUFDLENBQUMsSUFBSSxD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QUM7SUFDbkgsTUFBTSxLQUFLLEdBQWEsRUFBRSxDQUFDO0lBQzNCLElBQUksTUFBTSxHQUFHLE1BQU0sQ0FBQyxHQUFHLENBQUMsSUFBSSxDQUFDLENBQUM7SUFDOUIsT0FBTyxNQUFNLEtBQUssU0FBUyxFQUFFLENBQUM7UUFDNUIsSUFBSSxNQUFNLENBQUMsSUFBSSxLQUFLLFNBQVM7WUFBRSxLQUFLLENBQUMsT0FBTyxDQUFDLE1BQU0sQ0FBQyxJQUFJLENBQUMsQ0FBQztRQUMxRCxNQUFNLEdBQUcsTUFBTSxDQUFDLE1BQU0sS0FBSyxTQUFTLENBQUMsQ0FBQyxDQUFDLFNBQVMsQ0FBQyxDQUFDLENBQUMsTUFBTSxDQUFDLEdBQUcsQ0FBQyxNQUFNLENBQUMsTUFBTSxDQUFDLENBQUM7SUFDL0UsQ0FBQztJQUNELE9BQU8sS0FBSyxDQUFDLElBQUksQ0FBQyxHQUFHLENBQUMsQ0FBQztBQUN6QixDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHtcbiAgREVGQVVMVF9QUkVGQUJfRElSRUNUT1JZLFxuICBDUkVXX0NBVEFMT0dfQ0hBTkdFX01FU1NBR0UsXG4gIENSRVdfQ09ORklHX0RJUkVDVE9SWSxcbiAgUEFDS0FHRV9OQU1FLFxuICBST09NX0NBVEFMT0dfQ0hBTkdFX01FU1NBR0UsXG4gIFJPT01fQ09ORklHX0RJUkVDVE9SWSxcbn0gZnJvbSAnLi9jb25zdGFudHMnO1xuaW1wb3J0IHR5cGUgeyBBc3NldE1lbnVDb250ZXh0IH0gZnJvbSAnLi9jb250cmFjdHMnO1xuaW1wb3J0IHtcbiAgY3JlYXRlUm9vbUNvbnRlbnQgYXMgY3JlYXRlUm9vbUNvbnRlbnRXaXRoQXNzZXREYixcbiAgdHlwZSBSb29tQ3JlYXRpb25SZXF1ZXN0LFxufSBmcm9tICcuL3Jvb21zL2NyZWF0ZS1yb29tLWNvbnRlbnQnO1xuaW1wb3J0IHsgZWRpdG9yQXNzZXREYiB9IGZyb20gJy4vc2hhcmVkL2VkaXRvci1hc3NldC1kYic7XG5pbXBvcnQgeyBlZGl0b3JTY2VuZVF1ZXJ5IH0gZnJvbSAnLi9zaGFyZWQvZWRpdG9yLXNjZW5lJztcbmltcG9ydCB7IHZhbGlkYXRlT3BlblJvb21QcmVmYWIgfSBmcm9tICcuL3Jvb21zL3ZhbGlkYXRlLW9wZW4tcm9vbS1wcmVmYWInO1xuaW1wb3J0IHsgZGlzY292ZXJSb29tUHJlZmFicyB9IGZyb20gJy4vcm9vbXMvZGlzY292ZXItcm9vbS1wcmVmYWJzJztcbmltcG9ydCB7XG4gIGNyZWF0ZVJvb21Gcm9tU2VsZWN0aW9uLFxuICBnZXRSb29tQ2F0YWxvZyxcbiAgc2V0Um9vbUNhdGFsb2csXG59IGZyb20gJy4vcm9vbXMvcm9vbS1tb2R1bGUnO1xuaW1wb3J0IHsgaW5pdGlhbGl6ZVByb3RvdHlwZVNjZW5lIH0gZnJvbSAnLi9zY2VuZS9wcm90b3R5cGUtc2tlbGV0b24nO1xuaW1wb3J0IHsgYmluZFJvb21EZWZpbml0aW9uVG9PcGVuUHJlZmFiIH0gZnJvbSAnLi9yb29tcy9iaW5kLXJvb20tcHJlZmFiJztcbmltcG9ydCB7IHJlc29sdmVSb29tUGxhY2VtZW50VGFyZ2V0IH0gZnJvbSAnLi9yb29tcy9yb29tLXNjZW5lLWF1dGhvcmluZyc7XG5pbXBvcnQge1xuICB1cGRhdGVSb29tRGVmaW5pdGlvbixcbiAgdHlwZSBSb29tRGVmaW5pdGlvbkVkaXRSZXF1ZXN0LFxufSBmcm9tICcuL3Jvb21zL2VkaXQtcm9vbS1kZWZpbml0aW9uJztcbmltcG9ydCB0eXBlIHsgU2NlbmVOb2RlVHJlZSB9IGZyb20gJy4vc2hhcmVkL2VkaXRvci1zY2VuZSc7XG5pbXBvcnQge1xuICByZWNvZ25pemVBdXRob3JpbmdTZWxlY3Rpb24sXG4gIHR5cGUgQXV0aG9yaW5nU2VsZWN0aW9uLFxufSBmcm9tICcuL2F1dGhvcmluZy1zZWxlY3Rpb24nO1xuaW1wb3J0IHtcbiAgdXBkYXRlU2NlbmVDb3JlU2V0dGluZ3MsXG4gIHR5cGUgU2NlbmVDb3JlU2V0dGluZ3NSZXF1ZXN0LFxufSBmcm9tICcuL3NjZW5lL3NjZW5lLWNvcmUtYXV0aG9yaW5nJztcbmltcG9ydCB7IGNvbmZpZ3VyZVIxRW5lcmd5U2NlbmUgfSBmcm9tICcuL3NjZW5lL3IxLWVuZXJneS1hdXRob3JpbmcnO1xuaW1wb3J0IHsgZGlzY292ZXJDcmV3UHJlZmFicyB9IGZyb20gJy4vY3Jldy9kaXNjb3Zlci1jcmV3LXByZWZhYnMnO1xuaW1wb3J0IHtcbiAgY3JlYXRlQ3Jld0NvbnRlbnQgYXMgY3JlYXRlQ3Jld0NvbnRlbnRXaXRoQXNzZXREYixcbiAgcm9sbGJhY2tDcmV3QXNzZXRzLFxuICB0eXBlIENyZXdDcmVhdGlvblJlcXVlc3QsXG59IGZyb20gJy4vY3Jldy9jcmVhdGUtY3Jldy1jb250ZW50JztcbmltcG9ydCB7IGJpbmRDcmV3RGVmaW5pdGlvblRvT3BlblByZWZhYiB9IGZyb20gJy4vY3Jldy9iaW5kLWNyZXctcHJlZmFiJztcbmltcG9ydCB7IGNyZWF0ZUNyZXdGcm9tU2VsZWN0aW9uLCBnZXRDcmV3Q2F0YWxvZywgc2V0Q3Jld0NhdGFsb2cgfSBmcm9tICcuL2NyZXcvY3Jldy1tb2R1bGUnO1xuaW1wb3J0IHsgdXBkYXRlQ3Jld0RlZmluaXRpb24sIHR5cGUgQ3Jld0RlZmluaXRpb25FZGl0UmVxdWVzdCB9IGZyb20gJy4vY3Jldy9lZGl0LWNyZXctZGVmaW5pdGlvbic7XG5pbXBvcnQgeyBjb25maWd1cmVSMUNyZXdTY2VuZSB9IGZyb20gJy4vc2NlbmUvcjEtY3Jldy1hdXRob3JpbmcnO1xuaW1wb3J0IHtcbiAgY3JlYXRlQ3Jld01lbWJlclRlbXBsYXRlLFxuICBjcmVhdGVQb3dlclJvb21Sb3dUZW1wbGF0ZSxcbiAgcmVwbGFjZVBvd2VyUm93c1dpdGhQcmVmYWIsXG59IGZyb20gJy4vc2NlbmUvcHJlZmFiLXRlbXBsYXRlLWF1dGhvcmluZyc7XG5cbmV4cG9ydCBpbnRlcmZhY2UgQXV0aG9yaW5nU3RhdGUge1xuICByZWFkb25seSBzZWxlY3Rpb246IEF1dGhvcmluZ1NlbGVjdGlvbjtcbiAgcmVhZG9ubHkgcm9vbVRhcmdldDoge1xuICAgIHJlYWRvbmx5IG9rOiBib29sZWFuO1xuICAgIHJlYWRvbmx5IG1vZGU6ICdncmlkJyB8ICdjYW52YXMnIHwgJ3NjZW5lLXJvb3QnIHwgJ2Jsb2NrZWQnO1xuICAgIHJlYWRvbmx5IHV1aWQ/OiBzdHJpbmc7XG4gICAgcmVhZG9ubHkgcGF0aD86IHN0cmluZztcbiAgICByZWFkb25seSBtZXNzYWdlOiBzdHJpbmc7XG4gIH07XG4gIHJlYWRvbmx5IHJvb21zOiBSZXR1cm5UeXBlPHR5cGVvZiBnZXRSb29tQ2F0YWxvZz47XG4gIHJlYWRvbmx5IGNyZXdzOiBSZXR1cm5UeXBlPHR5cGVvZiBnZXRDcmV3Q2F0YWxvZz47XG4gIHJlYWRvbmx5IHdhcm5pbmdzOiByZWFkb25seSBzdHJpbmdbXTtcbn1cblxubGV0IGNhdGFsb2dXYXJuaW5nczogcmVhZG9ubHkgc3RyaW5nW10gPSBbXTtcbmxldCBjcmV3Q2F0YWxvZ1dhcm5pbmdzOiByZWFkb25seSBzdHJpbmdbXSA9IFtdO1xubGV0IGNhdGFsb2dGaW5nZXJwcmludCA9ICcnO1xubGV0IGNyZXdDYXRhbG9nRmluZ2VycHJpbnQgPSAnJztcbmxldCBjYXRhbG9nUmVmcmVzaFRpbWVyOiBSZXR1cm5UeXBlPHR5cGVvZiBzZXRUaW1lb3V0PiB8IHVuZGVmaW5lZDtcbmxldCBhc3NldENoYW5nZUxpc3RlbmVyOiAoKC4uLmFyZ3M6IHVua25vd25bXSkgPT4gdm9pZCkgfCB1bmRlZmluZWQ7XG5sZXQgZXh0ZW5zaW9uTG9hZGVkID0gZmFsc2U7XG5cbmV4cG9ydCBjb25zdCBtZXRob2RzID0ge1xuICBvcGVuUm9vbUNyZWF0ZShjb250ZXh0OiBBc3NldE1lbnVDb250ZXh0KSB7XG4gICAgcmV0dXJuIEVkaXRvci5QYW5lbC5vcGVuKFBBQ0tBR0VfTkFNRSwgY29udGV4dCk7XG4gIH0sXG4gIG9wZW5BdXRob3JpbmdQYW5lbCgpIHtcbiAgICByZXR1cm4gRWRpdG9yLlBhbmVsLm9wZW4oYCR7UEFDS0FHRV9OQU1FfS5hdXRob3JpbmdgKTtcbiAgfSxcbiAgY3JlYXRlUm9vbUNvbnRlbnQocmVxdWVzdDogUm9vbUNyZWF0aW9uUmVxdWVzdCkge1xuICAgIHJldHVybiBjcmVhdGVSb29tQ29udGVudFdpdGhBc3NldERiKHJlcXVlc3QsIGVkaXRvckFzc2V0RGIpLnRoZW4oYXN5bmMgKHJlc3VsdCkgPT4ge1xuICAgICAgaWYgKCFyZXN1bHQub2spIHJldHVybiByZXN1bHQ7XG4gICAgICBsZXQgZmFpbHVyZU1lc3NhZ2U6IHN0cmluZyB8IG51bGwgPSBudWxsO1xuICAgICAgdHJ5IHtcbiAgICAgICAgY29uc3QgY29uZmlnVXVpZCA9IGF3YWl0IGVkaXRvckFzc2V0RGIucXVlcnlVdWlkKHJlc3VsdC5jb25maWdVcmwpO1xuICAgICAgICBpZiAoY29uZmlnVXVpZCA9PT0gJycpIHtcbiAgICAgICAgICBmYWlsdXJlTWVzc2FnZSA9IGDliJvlu7rlkI7mib7kuI3liLDmiL/pl7TlrprkuYnotYTmupDvvJoke3Jlc3VsdC5jb25maWdVcmx9YDtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICBhd2FpdCBFZGl0b3IuTWVzc2FnZS5yZXF1ZXN0KCdhc3NldC1kYicsICdvcGVuLWFzc2V0JywgcmVzdWx0LnByZWZhYlVybCk7XG4gICAgICAgICAgY29uc3QgYmluZGluZyA9IGF3YWl0IGJpbmRSb29tRGVmaW5pdGlvblRvT3BlblByZWZhYihlZGl0b3JTY2VuZVF1ZXJ5LCBjb25maWdVdWlkLCByZXF1ZXN0LmlkKTtcbiAgICAgICAgICBpZiAoYmluZGluZy5vaykge1xuICAgICAgICAgICAgY29uc3QgcmVmcmVzaGVkID0gYXdhaXQgcmVmcmVzaFJvb21DYXRhbG9nTm93KCk7XG4gICAgICAgICAgICBjb25zdCB3YXJuaW5nID0gcmVmcmVzaGVkLndhcm5pbmdzLmxlbmd0aCA+IDBcbiAgICAgICAgICAgICAgPyBg77yI5YiX6KGo5Yi35paw5pyJICR7cmVmcmVzaGVkLndhcm5pbmdzLmxlbmd0aH0g5p2h6K2m5ZGK77yJYFxuICAgICAgICAgICAgICA6ICcnO1xuICAgICAgICAgICAgcmV0dXJuIHsgLi4ucmVzdWx0LCBtZXNzYWdlOiBgJHtyZXN1bHQubWVzc2FnZX0ke2JpbmRpbmcubWVzc2FnZX0ke3dhcm5pbmd9YCB9O1xuICAgICAgICAgIH1cbiAgICAgICAgICBmYWlsdXJlTWVzc2FnZSA9IGJpbmRpbmcubWVzc2FnZTtcbiAgICAgICAgfVxuICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgZmFpbHVyZU1lc3NhZ2UgPSBlcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZXJyb3IubWVzc2FnZSA6IFN0cmluZyhlcnJvcik7XG4gICAgICB9XG4gICAgICBjb25zdCByb2xsYmFja0Vycm9yczogc3RyaW5nW10gPSBbXTtcbiAgICAgIGZvciAoY29uc3QgdXJsIG9mIFtyZXN1bHQucHJlZmFiVXJsLCByZXN1bHQuY29uZmlnVXJsXSkge1xuICAgICAgICB0cnkge1xuICAgICAgICAgIGF3YWl0IGVkaXRvckFzc2V0RGIuZGVsZXRlQXNzZXQodXJsKTtcbiAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgICByb2xsYmFja0Vycm9ycy5wdXNoKGAke3VybH3vvJoke2Vycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvci5tZXNzYWdlIDogU3RyaW5nKGVycm9yKX1gKTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgICAgcmV0dXJuIHtcbiAgICAgICAgb2s6IGZhbHNlIGFzIGNvbnN0LFxuICAgICAgICBtZXNzYWdlOiBgJHtmYWlsdXJlTWVzc2FnZSA/PyAn5oi/6Ze05a6a5LmJ57uR5a6a5aSx6LSlJ33vvJvlt7Llm57mu5rmlrDotYTmupAke3JvbGxiYWNrRXJyb3JzLmxlbmd0aCA9PT0gMCA/ICcnIDogYO+8jOWbnua7muWksei0pe+8miR7cm9sbGJhY2tFcnJvcnMuam9pbign77ybJyl9YH1gLFxuICAgICAgfTtcbiAgICB9KTtcbiAgfSxcbiAgY3JlYXRlQ3Jld0NvbnRlbnQocmVxdWVzdDogQ3Jld0NyZWF0aW9uUmVxdWVzdCkge1xuICAgIHJldHVybiBjcmVhdGVDcmV3Q29udGVudFdpdGhBc3NldERiKHJlcXVlc3QsIGVkaXRvckFzc2V0RGIpLnRoZW4oYXN5bmMgKHJlc3VsdCkgPT4ge1xuICAgICAgaWYgKCFyZXN1bHQub2spIHJldHVybiByZXN1bHQ7XG4gICAgICBsZXQgZmFpbHVyZU1lc3NhZ2U6IHN0cmluZyB8IG51bGwgPSBudWxsO1xuICAgICAgdHJ5IHtcbiAgICAgICAgY29uc3QgY29uZmlnVXVpZCA9IGF3YWl0IGVkaXRvckFzc2V0RGIucXVlcnlVdWlkKHJlc3VsdC5jb25maWdVcmwpO1xuICAgICAgICBpZiAoY29uZmlnVXVpZCA9PT0gJycpIGZhaWx1cmVNZXNzYWdlID0gYOWIm+W7uuWQjuaJvuS4jeWIsOiIueWRmOWumuS5iei1hOa6kO+8miR7cmVzdWx0LmNvbmZpZ1VybH1gO1xuICAgICAgICBlbHNlIHtcbiAgICAgICAgICBhd2FpdCBFZGl0b3IuTWVzc2FnZS5yZXF1ZXN0KCdhc3NldC1kYicsICdvcGVuLWFzc2V0JywgcmVzdWx0LnByZWZhYlVybCk7XG4gICAgICAgICAgY29uc3QgYmluZGluZyA9IGF3YWl0IGJpbmRDcmV3RGVmaW5pdGlvblRvT3BlblByZWZhYihcbiAgICAgICAgICAgIGVkaXRvclNjZW5lUXVlcnksXG4gICAgICAgICAgICBjb25maWdVdWlkLFxuICAgICAgICAgICAgcmVxdWVzdC5pZCxcbiAgICAgICAgICAgIHJlcXVlc3Qucm9sZSBhcyAnRU5HSU5FRVInIHwgJ0dVTk5FUicsXG4gICAgICAgICAgKTtcbiAgICAgICAgICBpZiAoYmluZGluZy5vaykge1xuICAgICAgICAgICAgYXdhaXQgcmVmcmVzaENyZXdDYXRhbG9nTm93KCk7XG4gICAgICAgICAgICByZXR1cm4geyAuLi5yZXN1bHQsIG1lc3NhZ2U6IGAke3Jlc3VsdC5tZXNzYWdlfSR7YmluZGluZy5tZXNzYWdlfWAgfTtcbiAgICAgICAgICB9XG4gICAgICAgICAgZmFpbHVyZU1lc3NhZ2UgPSBiaW5kaW5nLm1lc3NhZ2U7XG4gICAgICAgIH1cbiAgICAgIH0gY2F0Y2ggKGNhdXNlKSB7XG4gICAgICAgIGZhaWx1cmVNZXNzYWdlID0gY2F1c2UgaW5zdGFuY2VvZiBFcnJvciA/IGNhdXNlLm1lc3NhZ2UgOiBTdHJpbmcoY2F1c2UpO1xuICAgICAgfVxuICAgICAgY29uc3Qgcm9sbGJhY2tFcnJvcnMgPSBhd2FpdCByb2xsYmFja0NyZXdBc3NldHMoZWRpdG9yQXNzZXREYiwgW3Jlc3VsdC5wcmVmYWJVcmwsIHJlc3VsdC5jb25maWdVcmxdKTtcbiAgICAgIGNvbnN0IHJvbGxiYWNrTWVzc2FnZSA9IHJvbGxiYWNrRXJyb3JzLmxlbmd0aCA9PT0gMFxuICAgICAgICA/ICflt7Llm57mu5rmlrDotYTmupAnXG4gICAgICAgIDogYOWbnua7muWksei0pe+8jOi1hOa6kOa4heeQhuacquWujOaIkO+8jOaXoOazleehruiupOS7peS4i+i1hOa6kOW3suWIoOmZpO+8miR7cm9sbGJhY2tFcnJvcnMuam9pbign77ybJyl9YDtcbiAgICAgIHJldHVybiB7IG9rOiBmYWxzZSBhcyBjb25zdCwgbWVzc2FnZTogYCR7ZmFpbHVyZU1lc3NhZ2UgPz8gJ+iIueWRmOWumuS5iee7keWumuWksei0pSd977ybJHtyb2xsYmFja01lc3NhZ2V9YCB9O1xuICAgIH0pO1xuICB9LFxuICBvcGVuQ3JlYXRlZFByZWZhYihwcmVmYWJVcmw6IHN0cmluZykge1xuICAgIHJldHVybiBFZGl0b3IuTWVzc2FnZS5yZXF1ZXN0KCdhc3NldC1kYicsICdvcGVuLWFzc2V0JywgcHJlZmFiVXJsKTtcbiAgfSxcbiAgdmFsaWRhdGVPcGVuUm9vbVByZWZhYigpIHtcbiAgICByZXR1cm4gdmFsaWRhdGVPcGVuUm9vbVByZWZhYihlZGl0b3JTY2VuZVF1ZXJ5KTtcbiAgfSxcbiAgYXN5bmMgcmVmcmVzaEF1dGhvcmluZ1N0YXRlKCkge1xuICAgIGF3YWl0IFByb21pc2UuYWxsKFtyZWZyZXNoUm9vbUNhdGFsb2dOb3coKSwgcmVmcmVzaENyZXdDYXRhbG9nTm93KCldKTtcbiAgICByZXR1cm4gYXdhaXQgZ2V0QXV0aG9yaW5nU3RhdGUoKTtcbiAgfSxcbiAgaW5pdGlhbGl6ZVByb3RvdHlwZVNjZW5lKCkge1xuICAgIHJldHVybiBpbml0aWFsaXplUHJvdG90eXBlU2NlbmUoZWRpdG9yU2NlbmVRdWVyeSk7XG4gIH0sXG4gIGFzeW5jIGdldEF1dGhvcmluZ1N0YXRlKCkge1xuICAgIHJldHVybiBhd2FpdCBnZXRBdXRob3JpbmdTdGF0ZSgpO1xuICB9LFxuICBhc3luYyBjcmVhdGVSb29tSW5zdGFuY2UoZW50cnk6IFBhcmFtZXRlcnM8dHlwZW9mIGNyZWF0ZVJvb21Gcm9tU2VsZWN0aW9uPlswXSkge1xuICAgIHJldHVybiBhd2FpdCBjcmVhdGVSb29tRnJvbVNlbGVjdGlvbihlbnRyeSwgeyBub2RlVXVpZDogZ2V0U2VsZWN0ZWROb2RlVXVpZCgpIH0pO1xuICB9LFxuICBhc3luYyBjcmVhdGVDcmV3SW5zdGFuY2UoZW50cnk6IFBhcmFtZXRlcnM8dHlwZW9mIGNyZWF0ZUNyZXdGcm9tU2VsZWN0aW9uPlswXSkge1xuICAgIHJldHVybiBhd2FpdCBjcmVhdGVDcmV3RnJvbVNlbGVjdGlvbihlbnRyeSwgeyBub2RlVXVpZDogZ2V0U2VsZWN0ZWROb2RlVXVpZCgpIH0pO1xuICB9LFxuICBhc3luYyB1cGRhdGVSb29tRGVmaW5pdGlvbihyZXF1ZXN0OiBSb29tRGVmaW5pdGlvbkVkaXRSZXF1ZXN0KSB7XG4gICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgdXBkYXRlUm9vbURlZmluaXRpb24ocmVxdWVzdCwgZWRpdG9yQXNzZXREYik7XG4gICAgaWYgKHJlc3VsdC5vaykgYXdhaXQgcmVmcmVzaFJvb21DYXRhbG9nTm93KCk7XG4gICAgcmV0dXJuIHJlc3VsdDtcbiAgfSxcbiAgYXN5bmMgdXBkYXRlQ3Jld0RlZmluaXRpb24ocmVxdWVzdDogQ3Jld0RlZmluaXRpb25FZGl0UmVxdWVzdCkge1xuICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IHVwZGF0ZUNyZXdEZWZpbml0aW9uKHJlcXVlc3QsIGVkaXRvckFzc2V0RGIpO1xuICAgIGlmIChyZXN1bHQub2spIGF3YWl0IHJlZnJlc2hDcmV3Q2F0YWxvZ05vdygpO1xuICAgIHJldHVybiByZXN1bHQ7XG4gIH0sXG4gIGFzeW5jIHVwZGF0ZVNjZW5lQ29yZVNldHRpbmdzKHJlcXVlc3Q6IFNjZW5lQ29yZVNldHRpbmdzUmVxdWVzdCkge1xuICAgIHJldHVybiBhd2FpdCB1cGRhdGVTY2VuZUNvcmVTZXR0aW5ncyhlZGl0b3JTY2VuZVF1ZXJ5LCBnZXRTZWxlY3RlZE5vZGVVdWlkKCksIHJlcXVlc3QpO1xuICB9LFxuICBhc3luYyBjb25maWd1cmVSMUVuZXJneVNjZW5lKCkge1xuICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IGNvbmZpZ3VyZVIxRW5lcmd5U2NlbmUoZWRpdG9yU2NlbmVRdWVyeSk7XG4gICAgaWYgKHJlc3VsdC5vaykgYXdhaXQgRWRpdG9yLk1lc3NhZ2UucmVxdWVzdCgnc2NlbmUnLCAnc2F2ZS1zY2VuZScpO1xuICAgIHJldHVybiByZXN1bHQ7XG4gIH0sXG4gIGFzeW5jIGNvbmZpZ3VyZVIxQ3Jld1NjZW5lKCkge1xuICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IGNvbmZpZ3VyZVIxQ3Jld1NjZW5lKGVkaXRvclNjZW5lUXVlcnkpO1xuICAgIGlmIChyZXN1bHQub2spIGF3YWl0IEVkaXRvci5NZXNzYWdlLnJlcXVlc3QoJ3NjZW5lJywgJ3NhdmUtc2NlbmUnKTtcbiAgICByZXR1cm4gcmVzdWx0O1xuICB9LFxuICBhc3luYyBjcmVhdGVDcmV3TWVtYmVyVGVtcGxhdGUoKSB7XG4gICAgcmV0dXJuIGF3YWl0IGNyZWF0ZUNyZXdNZW1iZXJUZW1wbGF0ZShlZGl0b3JBc3NldERiLCBlZGl0b3JTY2VuZVF1ZXJ5KTtcbiAgfSxcbiAgYXN5bmMgY3JlYXRlUG93ZXJSb29tUm93VGVtcGxhdGUoKSB7XG4gICAgcmV0dXJuIGF3YWl0IGNyZWF0ZVBvd2VyUm9vbVJvd1RlbXBsYXRlKGVkaXRvckFzc2V0RGIsIGVkaXRvclNjZW5lUXVlcnkpO1xuICB9LFxuICBhc3luYyByZXBsYWNlUG93ZXJSb3dzV2l0aFByZWZhYigpIHtcbiAgICByZXR1cm4gYXdhaXQgcmVwbGFjZVBvd2VyUm93c1dpdGhQcmVmYWIoZWRpdG9yQXNzZXREYiwgZWRpdG9yU2NlbmVRdWVyeSk7XG4gIH0sXG59O1xuXG5leHBvcnQgZnVuY3Rpb24gbG9hZCgpOiB2b2lkIHtcbiAgZXh0ZW5zaW9uTG9hZGVkID0gdHJ1ZTtcbiAgcmVnaXN0ZXJBc3NldENoYW5nZUxpc3RlbmVyKCk7XG4gIHZvaWQgUHJvbWlzZS5hbGwoW3JlZnJlc2hSb29tQ2F0YWxvZ05vdygpLCByZWZyZXNoQ3Jld0NhdGFsb2dOb3coKV0pLmNhdGNoKChjYXVzZTogdW5rbm93bikgPT4ge1xuICAgIGNvbnNvbGUud2FybihgW0FVVEhPUklOR10g5Yib5L2c6LWE5rqQ5YiX6KGo5Yi35paw5aSx6LSl77yaJHtjYXVzZSBpbnN0YW5jZW9mIEVycm9yID8gY2F1c2UubWVzc2FnZSA6IFN0cmluZyhjYXVzZSl9YCk7XG4gIH0pO1xufVxuZXhwb3J0IGZ1bmN0aW9uIHVubG9hZCgpOiB2b2lkIHtcbiAgZXh0ZW5zaW9uTG9hZGVkID0gZmFsc2U7XG4gIGNvbnN0IG1lc3NhZ2UgPSBnZXRCcm9hZGNhc3RNZXNzYWdlUG9ydCgpO1xuICBpZiAoYXNzZXRDaGFuZ2VMaXN0ZW5lciAhPT0gdW5kZWZpbmVkKSB7XG4gICAgbWVzc2FnZT8ucmVtb3ZlQnJvYWRjYXN0TGlzdGVuZXI/LignYXNzZXQtZGI6YXNzZXQtY2hhbmdlJywgYXNzZXRDaGFuZ2VMaXN0ZW5lcik7XG4gICAgYXNzZXRDaGFuZ2VMaXN0ZW5lciA9IHVuZGVmaW5lZDtcbiAgfVxuICBpZiAoY2F0YWxvZ1JlZnJlc2hUaW1lciAhPT0gdW5kZWZpbmVkKSB7XG4gICAgY2xlYXJUaW1lb3V0KGNhdGFsb2dSZWZyZXNoVGltZXIpO1xuICAgIGNhdGFsb2dSZWZyZXNoVGltZXIgPSB1bmRlZmluZWQ7XG4gIH1cbn1cblxuYXN5bmMgZnVuY3Rpb24gcmVmcmVzaFJvb21DYXRhbG9nTm93KCkge1xuICBjb25zdCByZXN1bHQgPSBhd2FpdCBkaXNjb3ZlclJvb21QcmVmYWJzKGVkaXRvckFzc2V0RGIpO1xuICBzZXRSb29tQ2F0YWxvZyhyZXN1bHQuZW50cmllcyk7XG4gIGNhdGFsb2dXYXJuaW5ncyA9IHJlc3VsdC53YXJuaW5ncztcbiAgY29uc3QgbmV4dEZpbmdlcnByaW50ID0gSlNPTi5zdHJpbmdpZnkoeyBlbnRyaWVzOiByZXN1bHQuZW50cmllcywgd2FybmluZ3M6IHJlc3VsdC53YXJuaW5ncyB9KTtcbiAgY29uc3QgY2hhbmdlZCA9IG5leHRGaW5nZXJwcmludCAhPT0gY2F0YWxvZ0ZpbmdlcnByaW50O1xuICBjYXRhbG9nRmluZ2VycHJpbnQgPSBuZXh0RmluZ2VycHJpbnQ7XG4gIGZvciAoY29uc3Qgd2FybmluZyBvZiByZXN1bHQud2FybmluZ3MpIGNvbnNvbGUud2FybihgW1JPT01dICR7d2FybmluZ31gKTtcbiAgaWYgKGNoYW5nZWQpIGdldEJyb2FkY2FzdE1lc3NhZ2VQb3J0KCk/LmJyb2FkY2FzdD8uKFJPT01fQ0FUQUxPR19DSEFOR0VfTUVTU0FHRSk7XG4gIHJldHVybiByZXN1bHQ7XG59XG5cbmFzeW5jIGZ1bmN0aW9uIHJlZnJlc2hDcmV3Q2F0YWxvZ05vdygpIHtcbiAgY29uc3QgcmVzdWx0ID0gYXdhaXQgZGlzY292ZXJDcmV3UHJlZmFicyhlZGl0b3JBc3NldERiKTtcbiAgc2V0Q3Jld0NhdGFsb2cocmVzdWx0LmVudHJpZXMpO1xuICBjcmV3Q2F0YWxvZ1dhcm5pbmdzID0gcmVzdWx0Lndhcm5pbmdzO1xuICBjb25zdCBuZXh0RmluZ2VycHJpbnQgPSBKU09OLnN0cmluZ2lmeSh7IGVudHJpZXM6IHJlc3VsdC5lbnRyaWVzLCB3YXJuaW5nczogcmVzdWx0Lndhcm5pbmdzIH0pO1xuICBjb25zdCBjaGFuZ2VkID0gbmV4dEZpbmdlcnByaW50ICE9PSBjcmV3Q2F0YWxvZ0ZpbmdlcnByaW50O1xuICBjcmV3Q2F0YWxvZ0ZpbmdlcnByaW50ID0gbmV4dEZpbmdlcnByaW50O1xuICBmb3IgKGNvbnN0IHdhcm5pbmcgb2YgcmVzdWx0Lndhcm5pbmdzKSBjb25zb2xlLndhcm4oYFtDUkVXXSAke3dhcm5pbmd9YCk7XG4gIGlmIChjaGFuZ2VkKSBnZXRCcm9hZGNhc3RNZXNzYWdlUG9ydCgpPy5icm9hZGNhc3Q/LihDUkVXX0NBVEFMT0dfQ0hBTkdFX01FU1NBR0UpO1xuICByZXR1cm4gcmVzdWx0O1xufVxuXG5hc3luYyBmdW5jdGlvbiBnZXRBdXRob3JpbmdTdGF0ZSgpOiBQcm9taXNlPEF1dGhvcmluZ1N0YXRlPiB7XG4gIGNvbnN0IHNlbGVjdGVkVXVpZCA9IGdldFNlbGVjdGVkTm9kZVV1aWQoKTtcbiAgdHJ5IHtcbiAgICBjb25zdCB0cmVlID0gYXdhaXQgZWRpdG9yU2NlbmVRdWVyeS5xdWVyeU5vZGVUcmVlKCk7XG4gICAgY29uc3Qgc2VsZWN0ZWROb2RlID0gc2VsZWN0ZWRVdWlkID09PSB1bmRlZmluZWQgPyB1bmRlZmluZWQgOiBmbGF0dGVuVHJlZSh0cmVlKS5maW5kKChub2RlKSA9PiBub2RlLnV1aWQgPT09IHNlbGVjdGVkVXVpZCk7XG4gICAgLy8gQ3JlYXRvciDlkK/liqjmiJbliIflnLrmma/nmoTnnqzpl7TvvIznu4Tku7bms6jlhozooajlj6/og73ov5jmnKrlk43lupTvvJvlroPlj6rnlKjkuo7ov5jljp/ljovnvKkgQ0lE77yMXG4gICAgLy8g5LiN6IO95Zug5Li66L+Z5Liq6L6F5Yqp5p+l6K+i5aSx6LSl5bCx5oqK5bey5pyJIENhbnZhcy/lnLrmma/moLnliKTlrprkuLrkuI3lj6/liJvlu7rjgIJcbiAgICBjb25zdCBjb21wb25lbnRDbGFzc2VzID0gZWRpdG9yU2NlbmVRdWVyeS5xdWVyeUNvbXBvbmVudHMgPT09IHVuZGVmaW5lZFxuICAgICAgPyBbXVxuICAgICAgOiBhd2FpdCBlZGl0b3JTY2VuZVF1ZXJ5LnF1ZXJ5Q29tcG9uZW50cygpLmNhdGNoKCgpID0+IFtdKTtcbiAgICBjb25zdCB0YXJnZXQgPSByZXNvbHZlUm9vbVBsYWNlbWVudFRhcmdldCh0cmVlLCB7IG5vZGVVdWlkOiBzZWxlY3RlZFV1aWQgfSwgY29tcG9uZW50Q2xhc3Nlcyk7XG4gICAgY29uc3Qgcm9vbVRhcmdldCA9IHRhcmdldC5va1xuICAgICAgPyB7XG4gICAgICAgIG9rOiB0cnVlLFxuICAgICAgICBtb2RlOiB0YXJnZXQubW9kZSxcbiAgICAgICAgdXVpZDogdGFyZ2V0Lm5vZGUudXVpZCxcbiAgICAgICAgcGF0aDogZ2V0Tm9kZVBhdGgodHJlZSwgdGFyZ2V0Lm5vZGUudXVpZCksXG4gICAgICAgIG1lc3NhZ2U6IHRhcmdldC5tZXNzYWdlLFxuICAgICAgfVxuICAgICAgOiB7IG9rOiBmYWxzZSwgbW9kZTogJ2Jsb2NrZWQnIGFzIGNvbnN0LCBtZXNzYWdlOiB0YXJnZXQubWVzc2FnZSB9O1xuICAgIHJldHVybiB7XG4gICAgICBzZWxlY3Rpb246IGF3YWl0IHJlY29nbml6ZUF1dGhvcmluZ1NlbGVjdGlvbih7XG4gICAgICAgIHNlbGVjdGVkTm9kZSxcbiAgICAgICAgdHJlZSxcbiAgICAgICAgY29tcG9uZW50Q2xhc3NlcyxcbiAgICAgICAgc2NlbmU6IGVkaXRvclNjZW5lUXVlcnksXG4gICAgICAgIHJvb21zOiBnZXRSb29tQ2F0YWxvZygpLFxuICAgICAgICBjcmV3czogZ2V0Q3Jld0NhdGFsb2coKSxcbiAgICAgIH0pLFxuICAgICAgcm9vbVRhcmdldCxcbiAgICAgIHJvb21zOiBnZXRSb29tQ2F0YWxvZygpLFxuICAgICAgY3Jld3M6IGdldENyZXdDYXRhbG9nKCksXG4gICAgICB3YXJuaW5nczogWy4uLmNhdGFsb2dXYXJuaW5ncywgLi4uY3Jld0NhdGFsb2dXYXJuaW5nc10sXG4gICAgfTtcbiAgfSBjYXRjaCAoY2F1c2UpIHtcbiAgICByZXR1cm4ge1xuICAgICAgc2VsZWN0aW9uOiB7IGtpbmQ6ICdub25lJywgdHlwZUlkOiAnbm9uZScsIHBhZ2U6ICdzY2VuZScsIHV1aWQ6IHNlbGVjdGVkVXVpZCB9LFxuICAgICAgcm9vbVRhcmdldDogeyBvazogZmFsc2UsIG1vZGU6ICdibG9ja2VkJywgbWVzc2FnZTogYOaXoOazleivu+WPluW9k+WJjeWcuuaZr++8miR7Y2F1c2UgaW5zdGFuY2VvZiBFcnJvciA/IGNhdXNlLm1lc3NhZ2UgOiBTdHJpbmcoY2F1c2UpfWAgfSxcbiAgICAgIHJvb21zOiBnZXRSb29tQ2F0YWxvZygpLFxuICAgICAgY3Jld3M6IGdldENyZXdDYXRhbG9nKCksXG4gICAgICB3YXJuaW5nczogWy4uLmNhdGFsb2dXYXJuaW5ncywgLi4uY3Jld0NhdGFsb2dXYXJuaW5nc10sXG4gICAgfTtcbiAgfVxufVxuXG5mdW5jdGlvbiBnZXRTZWxlY3RlZE5vZGVVdWlkKCk6IHN0cmluZyB8IHVuZGVmaW5lZCB7XG4gIHRyeSB7XG4gICAgY29uc3Qgc2VsZWN0aW9uID0gKGdsb2JhbFRoaXMgYXMge1xuICAgICAgRWRpdG9yPzogeyBTZWxlY3Rpb24/OiB7IGdldFNlbGVjdGVkPzogKHR5cGU6IHN0cmluZykgPT4gcmVhZG9ubHkgc3RyaW5nW10gfSB9O1xuICAgIH0pLkVkaXRvcj8uU2VsZWN0aW9uO1xuICAgIHJldHVybiBzZWxlY3Rpb24/LmdldFNlbGVjdGVkPy4oJ25vZGUnKT8uWzBdO1xuICB9IGNhdGNoIHtcbiAgICByZXR1cm4gdW5kZWZpbmVkO1xuICB9XG59XG5cbmZ1bmN0aW9uIHJlZ2lzdGVyQXNzZXRDaGFuZ2VMaXN0ZW5lcigpOiB2b2lkIHtcbiAgaWYgKGFzc2V0Q2hhbmdlTGlzdGVuZXIgIT09IHVuZGVmaW5lZCkgcmV0dXJuO1xuICBjb25zdCBtZXNzYWdlID0gZ2V0QnJvYWRjYXN0TWVzc2FnZVBvcnQoKTtcbiAgaWYgKG1lc3NhZ2U/LmFkZEJyb2FkY2FzdExpc3RlbmVyID09PSB1bmRlZmluZWQpIHJldHVybjtcbiAgYXNzZXRDaGFuZ2VMaXN0ZW5lciA9ICguLi5hcmdzOiB1bmtub3duW10pID0+IHtcbiAgICB2b2lkIGhhbmRsZUFzc2V0Q2hhbmdlKGFyZ3NbMF0pO1xuICB9O1xuICBtZXNzYWdlLmFkZEJyb2FkY2FzdExpc3RlbmVyKCdhc3NldC1kYjphc3NldC1jaGFuZ2UnLCBhc3NldENoYW5nZUxpc3RlbmVyKTtcbn1cblxuYXN5bmMgZnVuY3Rpb24gaGFuZGxlQXNzZXRDaGFuZ2UodmFsdWU6IHVua25vd24pOiBQcm9taXNlPHZvaWQ+IHtcbiAgY29uc3QgdXVpZCA9IHJlYWRBc3NldENoYW5nZVV1aWQodmFsdWUpO1xuICBpZiAodXVpZCAhPT0gdW5kZWZpbmVkICYmICFhd2FpdCBpc0F1dGhvcmluZ0Fzc2V0Q2hhbmdlKHV1aWQpKSByZXR1cm47XG4gIGlmICghZXh0ZW5zaW9uTG9hZGVkKSByZXR1cm47XG4gIGlmIChjYXRhbG9nUmVmcmVzaFRpbWVyICE9PSB1bmRlZmluZWQpIGNsZWFyVGltZW91dChjYXRhbG9nUmVmcmVzaFRpbWVyKTtcbiAgY2F0YWxvZ1JlZnJlc2hUaW1lciA9IHNldFRpbWVvdXQoKCkgPT4ge1xuICAgIGNhdGFsb2dSZWZyZXNoVGltZXIgPSB1bmRlZmluZWQ7XG4gICAgdm9pZCBQcm9taXNlLmFsbChbcmVmcmVzaFJvb21DYXRhbG9nTm93KCksIHJlZnJlc2hDcmV3Q2F0YWxvZ05vdygpXSkuY2F0Y2goKGNhdXNlOiB1bmtub3duKSA9PiB7XG4gICAgICBjb25zb2xlLndhcm4oYFtBVVRIT1JJTkddIOWIm+S9nOi1hOa6kOWIl+ihqOiHquWKqOWIt+aWsOWksei0pe+8miR7Y2F1c2UgaW5zdGFuY2VvZiBFcnJvciA/IGNhdXNlLm1lc3NhZ2UgOiBTdHJpbmcoY2F1c2UpfWApO1xuICAgIH0pO1xuICB9LCAyMDApO1xufVxuXG5hc3luYyBmdW5jdGlvbiBpc0F1dGhvcmluZ0Fzc2V0Q2hhbmdlKHV1aWQ6IHN0cmluZyk6IFByb21pc2U8Ym9vbGVhbj4ge1xuICBpZiAoZ2V0Um9vbUNhdGFsb2coKS5zb21lKChlbnRyeSkgPT4gZW50cnkucHJlZmFiVXVpZCA9PT0gdXVpZCB8fCBlbnRyeS5jb25maWdVdWlkID09PSB1dWlkKSkgcmV0dXJuIHRydWU7XG4gIGlmIChnZXRDcmV3Q2F0YWxvZygpLnNvbWUoKGVudHJ5KSA9PiBlbnRyeS5wcmVmYWJVdWlkID09PSB1dWlkIHx8IGVudHJ5LmNvbmZpZ1V1aWQgPT09IHV1aWQpKSByZXR1cm4gdHJ1ZTtcbiAgdHJ5IHtcbiAgICBjb25zdCBpbmZvID0gYXdhaXQgZWRpdG9yQXNzZXREYi5xdWVyeUluZm8odXVpZCk7XG4gICAgcmV0dXJuIGluZm8gPT09IG51bGwgfHwgaXNBdXRob3JpbmdBc3NldFVybChpbmZvLnVybCk7XG4gIH0gY2F0Y2gge1xuICAgIC8vIOi1hOa6kOWIoOmZpOaIluWvvOWFpei/h+eoi+S4reeahOS4tOaXtuafpeivouWksei0peS4jeiDveiuqeaIv+mXtOebruW9leWBnOeVmeWcqOaXp+eKtuaAgeOAglxuICAgIHJldHVybiB0cnVlO1xuICB9XG59XG5cbmZ1bmN0aW9uIGlzQXV0aG9yaW5nQXNzZXRVcmwodXJsOiBzdHJpbmcpOiBib29sZWFuIHtcbiAgcmV0dXJuICh1cmwuc3RhcnRzV2l0aChgJHtST09NX0NPTkZJR19ESVJFQ1RPUll9L2ApICYmIHVybC5lbmRzV2l0aCgnLmpzb24nKSlcbiAgICB8fCAodXJsLnN0YXJ0c1dpdGgoYCR7Q1JFV19DT05GSUdfRElSRUNUT1JZfS9gKSAmJiB1cmwuZW5kc1dpdGgoJy5qc29uJykpXG4gICAgfHwgKHVybC5zdGFydHNXaXRoKGAke0RFRkFVTFRfUFJFRkFCX0RJUkVDVE9SWX0vYCkgJiYgdXJsLmVuZHNXaXRoKCcucHJlZmFiJykpO1xufVxuXG5mdW5jdGlvbiByZWFkQXNzZXRDaGFuZ2VVdWlkKHZhbHVlOiB1bmtub3duKTogc3RyaW5nIHwgdW5kZWZpbmVkIHtcbiAgaWYgKHR5cGVvZiB2YWx1ZSA9PT0gJ3N0cmluZycgJiYgdmFsdWUgIT09ICcnKSByZXR1cm4gdmFsdWU7XG4gIGlmICh0eXBlb2YgdmFsdWUgPT09ICdvYmplY3QnICYmIHZhbHVlICE9PSBudWxsKSB7XG4gICAgY29uc3QgdXVpZCA9ICh2YWx1ZSBhcyB7IHV1aWQ/OiB1bmtub3duIH0pLnV1aWQ7XG4gICAgcmV0dXJuIHR5cGVvZiB1dWlkID09PSAnc3RyaW5nJyAmJiB1dWlkICE9PSAnJyA/IHV1aWQgOiB1bmRlZmluZWQ7XG4gIH1cbiAgcmV0dXJuIHVuZGVmaW5lZDtcbn1cblxuaW50ZXJmYWNlIEJyb2FkY2FzdE1lc3NhZ2VQb3J0IHtcbiAgYWRkQnJvYWRjYXN0TGlzdGVuZXI/KG5hbWU6IHN0cmluZywgY2FsbGJhY2s6ICguLi5hcmdzOiB1bmtub3duW10pID0+IHZvaWQpOiB2b2lkO1xuICByZW1vdmVCcm9hZGNhc3RMaXN0ZW5lcj8obmFtZTogc3RyaW5nLCBjYWxsYmFjazogKC4uLmFyZ3M6IHVua25vd25bXSkgPT4gdm9pZCk6IHZvaWQ7XG4gIGJyb2FkY2FzdD8obmFtZTogc3RyaW5nLCAuLi5hcmdzOiB1bmtub3duW10pOiB2b2lkO1xufVxuXG5mdW5jdGlvbiBnZXRCcm9hZGNhc3RNZXNzYWdlUG9ydCgpOiBCcm9hZGNhc3RNZXNzYWdlUG9ydCB8IHVuZGVmaW5lZCB7XG4gIGNvbnN0IG1lc3NhZ2UgPSAoZ2xvYmFsVGhpcyBhcyB7IEVkaXRvcj86IHsgTWVzc2FnZT86IHVua25vd24gfSB9KS5FZGl0b3I/Lk1lc3NhZ2U7XG4gIHJldHVybiB0eXBlb2YgbWVzc2FnZSA9PT0gJ29iamVjdCcgJiYgbWVzc2FnZSAhPT0gbnVsbCA/IG1lc3NhZ2UgYXMgQnJvYWRjYXN0TWVzc2FnZVBvcnQgOiB1bmRlZmluZWQ7XG59XG5cbmZ1bmN0aW9uIGZsYXR0ZW5UcmVlKHRyZWU6IFNjZW5lTm9kZVRyZWUpOiBTY2VuZU5vZGVUcmVlW10ge1xuICBjb25zdCByZXN1bHQ6IFNjZW5lTm9kZVRyZWVbXSA9IFtdO1xuICBjb25zdCB2aXNpdCA9IChub2RlOiBTY2VuZU5vZGVUcmVlLCBwYXJlbnQ/OiBzdHJpbmcpOiB2b2lkID0+IHtcbiAgICByZXN1bHQucHVzaChwYXJlbnQgPT09IHVuZGVmaW5lZCB8fCBub2RlLnBhcmVudCAhPT0gdW5kZWZpbmVkID8gbm9kZSA6IHsgLi4ubm9kZSwgcGFyZW50IH0pO1xuICAgIGZvciAoY29uc3QgY2hpbGQgb2Ygbm9kZS5jaGlsZHJlbiA/PyBbXSkgdmlzaXQoY2hpbGQsIG5vZGUudXVpZCk7XG4gIH07XG4gIHZpc2l0KHRyZWUpO1xuICByZXR1cm4gcmVzdWx0O1xufVxuXG5mdW5jdGlvbiBnZXROb2RlUGF0aCh0cmVlOiBTY2VuZU5vZGVUcmVlLCB1dWlkOiBzdHJpbmcgfCB1bmRlZmluZWQpOiBzdHJpbmcgfCB1bmRlZmluZWQge1xuICBpZiAodXVpZCA9PT0gdW5kZWZpbmVkKSByZXR1cm4gdW5kZWZpbmVkO1xuICBjb25zdCBub2RlcyA9IGZsYXR0ZW5UcmVlKHRyZWUpO1xuICBjb25zdCBieVV1aWQgPSBuZXcgTWFwKG5vZGVzLmZpbHRlcigobm9kZSkgPT4gbm9kZS51dWlkICE9PSB1bmRlZmluZWQpLm1hcCgobm9kZSkgPT4gW25vZGUudXVpZCBhcyBzdHJpbmcsIG5vZGVdKSk7XG4gIGNvbnN0IG5hbWVzOiBzdHJpbmdbXSA9IFtdO1xuICBsZXQgY3Vyc29yID0gYnlVdWlkLmdldCh1dWlkKTtcbiAgd2hpbGUgKGN1cnNvciAhPT0gdW5kZWZpbmVkKSB7XG4gICAgaWYgKGN1cnNvci5uYW1lICE9PSB1bmRlZmluZWQpIG5hbWVzLnVuc2hpZnQoY3Vyc29yLm5hbWUpO1xuICAgIGN1cnNvciA9IGN1cnNvci5wYXJlbnQgPT09IHVuZGVmaW5lZCA/IHVuZGVmaW5lZCA6IGJ5VXVpZC5nZXQoY3Vyc29yLnBhcmVudCk7XG4gIH1cbiAgcmV0dXJuIG5hbWVzLmpvaW4oJy8nKTtcbn1cbiJdfQ==