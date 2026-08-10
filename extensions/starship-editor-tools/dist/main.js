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
let catalogWarnings = [];
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
};
function load() {
    void refreshRoomCatalogNow().catch((cause) => {
        console.warn(`[ROOM] 房间建筑列表刷新失败：${cause instanceof Error ? cause.message : String(cause)}`);
    });
}
function unload() { }
async function refreshRoomCatalogNow() {
    const result = await (0, discover_room_prefabs_1.discoverRoomPrefabs)(editor_asset_db_1.editorAssetDb);
    (0, room_module_1.setRoomCatalog)(result.entries);
    catalogWarnings = result.warnings;
    for (const warning of result.warnings)
        console.warn(`[ROOM] ${warning}`);
    return result;
}
async function getAuthoringState() {
    const selectedUuid = getSelectedNodeUuid();
    try {
        const tree = await editor_scene_1.editorSceneQuery.queryNodeTree();
        const selectedNode = selectedUuid === undefined ? undefined : flattenTree(tree).find((node) => node.uuid === selectedUuid);
        const target = (0, room_scene_authoring_1.resolveRoomRoot)(tree, { nodeUuid: selectedUuid });
        const roomTarget = target.ok
            ? {
                ok: true,
                uuid: target.node.uuid,
                path: getNodePath(tree, target.node.uuid),
                message: '已解析唯一 RoomRoot，可创建房间建筑',
            }
            : { ok: false, message: target.message };
        return {
            selection: { uuid: selectedUuid, name: selectedNode === null || selectedNode === void 0 ? void 0 : selectedNode.name },
            roomTarget,
            rooms: (0, room_module_1.getRoomCatalog)(),
            warnings: catalogWarnings,
        };
    }
    catch (cause) {
        return {
            selection: { uuid: selectedUuid },
            roomTarget: { ok: false, message: `无法读取当前场景：${cause instanceof Error ? cause.message : String(cause)}` },
            rooms: (0, room_module_1.getRoomCatalog)(),
            warnings: catalogWarnings,
        };
    }
}
function getSelectedNodeUuid() {
    var _a, _b, _c;
    const selection = (_a = globalThis.Editor) === null || _a === void 0 ? void 0 : _a.Selection;
    return (_c = (_b = selection === null || selection === void 0 ? void 0 : selection.getSelected) === null || _b === void 0 ? void 0 : _b.call(selection, 'node')) === null || _c === void 0 ? void 0 : _c[0];
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibWFpbi5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uL3NyYy9tYWluLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7OztBQTRHQSxvQkFJQztBQUNELHdCQUFpQztBQWpIakMsMkNBQTJDO0FBRTNDLHFFQUdxQztBQUNyQyw4REFBeUQ7QUFDekQsd0RBQXlEO0FBQ3pELGlGQUEyRTtBQUMzRSx5RUFBb0U7QUFDcEUscURBSTZCO0FBQzdCLG1FQUFzRTtBQUN0RSwrREFBMEU7QUFDMUUsdUVBQStEO0FBQy9ELHVFQUdzQztBQWV0QyxJQUFJLGVBQWUsR0FBc0IsRUFBRSxDQUFDO0FBRS9CLFFBQUEsT0FBTyxHQUFHO0lBQ3JCLGNBQWMsQ0FBQyxPQUF5QjtRQUN0QyxPQUFPLE1BQU0sQ0FBQyxLQUFLLENBQUMsSUFBSSxDQUFDLHdCQUFZLEVBQUUsT0FBTyxDQUFDLENBQUM7SUFDbEQsQ0FBQztJQUNELGtCQUFrQjtRQUNoQixPQUFPLE1BQU0sQ0FBQyxLQUFLLENBQUMsSUFBSSxDQUFDLEdBQUcsd0JBQVksWUFBWSxDQUFDLENBQUM7SUFDeEQsQ0FBQztJQUNELGlCQUFpQixDQUFDLE9BQTRCO1FBQzVDLE9BQU8sSUFBQSx1Q0FBNEIsRUFBQyxPQUFPLEVBQUUsK0JBQWEsQ0FBQyxDQUFDLElBQUksQ0FBQyxLQUFLLEVBQUUsTUFBTSxFQUFFLEVBQUU7WUFDaEYsSUFBSSxDQUFDLE1BQU0sQ0FBQyxFQUFFO2dCQUFFLE9BQU8sTUFBTSxDQUFDO1lBQzlCLElBQUksY0FBYyxHQUFrQixJQUFJLENBQUM7WUFDekMsSUFBSSxDQUFDO2dCQUNILE1BQU0sVUFBVSxHQUFHLE1BQU0sK0JBQWEsQ0FBQyxTQUFTLENBQUMsTUFBTSxDQUFDLFNBQVMsQ0FBQyxDQUFDO2dCQUNuRSxJQUFJLFVBQVUsS0FBSyxFQUFFLEVBQUUsQ0FBQztvQkFDdEIsY0FBYyxHQUFHLGdCQUFnQixNQUFNLENBQUMsU0FBUyxFQUFFLENBQUM7Z0JBQ3RELENBQUM7cUJBQU0s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RyxJQUFJLEdBQUcsQ0FBQyxLQUFLLENBQUMsTUFBTSxDQUFDLENBQUMsSUFBSSxFQUFFLEVBQUUsQ0FBQyxJQUFJLENBQUMsSUFBSSxLQUFLLFNBQVMsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxDQUFDLElBQUksRUFBRSxFQUFFLENBQUMsQ0FBQyxJQUFJLENBQUMsSUFBYyxFQUFFLElBQUksQ0FBQyxDQUFDLENBQUMsQ0FBQztJQUNuSCxNQUFNLEtBQUssR0FBYSxFQUFFLENBQUM7SUFDM0IsSUFBSSxNQUFNLEdBQUcsTUFBTSxDQUFDLEdBQUcsQ0FBQyxJQUFJLENBQUMsQ0FBQztJQUM5QixPQUFPLE1BQU0sS0FBSyxTQUFTLEVBQUUsQ0FBQztRQUM1QixJQUFJLE1BQU0sQ0FBQyxJQUFJLEtBQUssU0FBUztZQUFFLEtBQUssQ0FBQyxPQUFPLENBQUMsTUFBTSxDQUFDLElBQUksQ0FBQyxDQUFDO1FBQzFELE1BQU0sR0FBRyxNQUFNLENBQUMsTUFBTSxLQUFLLFNBQVMsQ0FBQyxDQUFDLENBQUMsU0FBUyxDQUFDLENBQUMsQ0FBQyxNQUFNLENBQUMsR0FBRyxDQUFDLE1BQU0sQ0FBQyxNQUFNLENBQUMsQ0FBQztJQUMvRSxDQUFDO0lBQ0QsT0FBTyxLQUFLLENBQUMsSUFBSSxDQUFDLEdBQUcsQ0FBQyxDQUFDO0FBQ3pCLENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgeyBQQUNLQUdFX05BTUUgfSBmcm9tICcuL2NvbnN0YW50cyc7XG5pbXBvcnQgdHlwZSB7IEFzc2V0TWVudUNvbnRleHQgfSBmcm9tICcuL2NvbnRyYWN0cyc7XG5pbXBvcnQge1xuICBjcmVhdGVSb29tQ29udGVudCBhcyBjcmVhdGVSb29tQ29udGVudFdpdGhBc3NldERiLFxuICB0eXBlIFJvb21DcmVhdGlvblJlcXVlc3QsXG59IGZyb20gJy4vcm9vbXMvY3JlYXRlLXJvb20tY29udGVudCc7XG5pbXBvcnQgeyBlZGl0b3JBc3NldERiIH0gZnJvbSAnLi9zaGFyZWQvZWRpdG9yLWFzc2V0LWRiJztcbmltcG9ydCB7IGVkaXRvclNjZW5lUXVlcnkgfSBmcm9tICcuL3NoYXJlZC9lZGl0b3Itc2NlbmUnO1xuaW1wb3J0IHsgdmFsaWRhdGVPcGVuUm9vbVByZWZhYiB9IGZyb20gJy4vcm9vbXMvdmFsaWRhdGUtb3Blbi1yb29tLXByZWZhYic7XG5pbXBvcnQgeyBkaXNjb3ZlclJvb21QcmVmYWJzIH0gZnJvbSAnLi9yb29tcy9kaXNjb3Zlci1yb29tLXByZWZhYnMnO1xuaW1wb3J0IHtcbiAgY3JlYXRlUm9vbUZyb21TZWxlY3Rpb24sXG4gIGdldFJvb21DYXRhbG9nLFxuICBzZXRSb29tQ2F0YWxvZyxcbn0gZnJvbSAnLi9yb29tcy9yb29tLW1vZHVsZSc7XG5pbXBvcnQgeyBpbml0aWFsaXplUHJvdG90eXBlU2NlbmUgfSBmcm9tICcuL3NjZW5lL3Byb3RvdHlwZS1za2VsZXRvbic7XG5pbXBvcnQgeyBiaW5kUm9vbURlZmluaXRpb25Ub09wZW5QcmVmYWIgfSBmcm9tICcuL3Jvb21zL2JpbmQtcm9vbS1wcmVmYWInO1xuaW1wb3J0IHsgcmVzb2x2ZVJvb21Sb290IH0gZnJvbSAnLi9yb29tcy9yb29tLXNjZW5lLWF1dGhvcmluZyc7XG5pbXBvcnQge1xuICB1cGRhdGVSb29tRGVmaW5pdGlvbixcbiAgdHlwZSBSb29tRGVmaW5pdGlvbkVkaXRSZXF1ZXN0LFxufSBmcm9tICcuL3Jvb21zL2VkaXQtcm9vbS1kZWZpbml0aW9uJztcbmltcG9ydCB0eXBlIHsgU2NlbmVOb2RlVHJlZSB9IGZyb20gJy4vc2hhcmVkL2VkaXRvci1zY2VuZSc7XG5cbmV4cG9ydCBpbnRlcmZhY2UgQXV0aG9yaW5nU3RhdGUge1xuICByZWFkb25seSBzZWxlY3Rpb246IHsgcmVhZG9ubHkgdXVpZD86IHN0cmluZzsgcmVhZG9ubHkgbmFtZT86IHN0cmluZyB9O1xuICByZWFkb25seSByb29tVGFyZ2V0OiB7XG4gICAgcmVhZG9ubHkgb2s6IGJvb2xlYW47XG4gICAgcmVhZG9ubHkgdXVpZD86IHN0cmluZztcbiAgICByZWFkb25seSBwYXRoPzogc3RyaW5nO1xuICAgIHJlYWRvbmx5IG1lc3NhZ2U6IHN0cmluZztcbiAgfTtcbiAgcmVhZG9ubHkgcm9vbXM6IFJldHVyblR5cGU8dHlwZW9mIGdldFJvb21DYXRhbG9nPjtcbiAgcmVhZG9ubHkgd2FybmluZ3M6IHJlYWRvbmx5IHN0cmluZ1tdO1xufVxuXG5sZXQgY2F0YWxvZ1dhcm5pbmdzOiByZWFkb25seSBzdHJpbmdbXSA9IFtdO1xuXG5leHBvcnQgY29uc3QgbWV0aG9kcyA9IHtcbiAgb3BlblJvb21DcmVhdGUoY29udGV4dDogQXNzZXRNZW51Q29udGV4dCkge1xuICAgIHJldHVybiBFZGl0b3IuUGFuZWwub3BlbihQQUNLQUdFX05BTUUsIGNvbnRleHQpO1xuICB9LFxuICBvcGVuQXV0aG9yaW5nUGFuZWwoKSB7XG4gICAgcmV0dXJuIEVkaXRvci5QYW5lbC5vcGVuKGAke1BBQ0tBR0VfTkFNRX0uYXV0aG9yaW5nYCk7XG4gIH0sXG4gIGNyZWF0ZVJvb21Db250ZW50KHJlcXVlc3Q6IFJvb21DcmVhdGlvblJlcXVlc3QpIHtcbiAgICByZXR1cm4gY3JlYXRlUm9vbUNvbnRlbnRXaXRoQXNzZXREYihyZXF1ZXN0LCBlZGl0b3JBc3NldERiKS50aGVuKGFzeW5jIChyZXN1bHQpID0+IHtcbiAgICAgIGlmICghcmVzdWx0Lm9rKSByZXR1cm4gcmVzdWx0O1xuICAgICAgbGV0IGZhaWx1cmVNZXNzYWdlOiBzdHJpbmcgfCBudWxsID0gbnVsbDtcbiAgICAgIHRyeSB7XG4gICAgICAgIGNvbnN0IGNvbmZpZ1V1aWQgPSBhd2FpdCBlZGl0b3JBc3NldERiLnF1ZXJ5VXVpZChyZXN1bHQuY29uZmlnVXJsKTtcbiAgICAgICAgaWYgKGNvbmZpZ1V1aWQgPT09ICcnKSB7XG4gICAgICAgICAgZmFpbHVyZU1lc3NhZ2UgPSBg5Yib5bu65ZCO5om+5LiN5Yiw5oi/6Ze05a6a5LmJ6LWE5rqQ77yaJHtyZXN1bHQuY29uZmlnVXJsfWA7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgYXdhaXQgRWRpdG9yLk1lc3NhZ2UucmVxdWVzdCgnYXNzZXQtZGInLCAnb3Blbi1hc3NldCcsIHJlc3VsdC5wcmVmYWJVcmwpO1xuICAgICAgICAgIGNvbnN0IGJpbmRpbmcgPSBhd2FpdCBiaW5kUm9vbURlZmluaXRpb25Ub09wZW5QcmVmYWIoZWRpdG9yU2NlbmVRdWVyeSwgY29uZmlnVXVpZCwgcmVxdWVzdC5pZCk7XG4gICAgICAgICAgaWYgKGJpbmRpbmcub2spIHtcbiAgICAgICAgICAgIGNvbnN0IHJlZnJlc2hlZCA9IGF3YWl0IHJlZnJlc2hSb29tQ2F0YWxvZ05vdygpO1xuICAgICAgICAgICAgY29uc3Qgd2FybmluZyA9IHJlZnJlc2hlZC53YXJuaW5ncy5sZW5ndGggPiAwXG4gICAgICAgICAgICAgID8gYO+8iOWIl+ihqOWIt+aWsOaciSAke3JlZnJlc2hlZC53YXJuaW5ncy5sZW5ndGh9IOadoeitpuWRiu+8iWBcbiAgICAgICAgICAgICAgOiAnJztcbiAgICAgICAgICAgIHJldHVybiB7IC4uLnJlc3VsdCwgbWVzc2FnZTogYCR7cmVzdWx0Lm1lc3NhZ2V9JHtiaW5kaW5nLm1lc3NhZ2V9JHt3YXJuaW5nfWAgfTtcbiAgICAgICAgICB9XG4gICAgICAgICAgZmFpbHVyZU1lc3NhZ2UgPSBiaW5kaW5nLm1lc3NhZ2U7XG4gICAgICAgIH1cbiAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIGZhaWx1cmVNZXNzYWdlID0gZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yLm1lc3NhZ2UgOiBTdHJpbmcoZXJyb3IpO1xuICAgICAgfVxuICAgICAgY29uc3Qgcm9sbGJhY2tFcnJvcnM6IHN0cmluZ1tdID0gW107XG4gICAgICBmb3IgKGNvbnN0IHVybCBvZiBbcmVzdWx0LnByZWZhYlVybCwgcmVzdWx0LmNvbmZpZ1VybF0pIHtcbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICBhd2FpdCBlZGl0b3JBc3NldERiLmRlbGV0ZUFzc2V0KHVybCk7XG4gICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgICAgcm9sbGJhY2tFcnJvcnMucHVzaChgJHt1cmx977yaJHtlcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZXJyb3IubWVzc2FnZSA6IFN0cmluZyhlcnJvcil9YCk7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICAgIHJldHVybiB7XG4gICAgICAgIG9rOiBmYWxzZSBhcyBjb25zdCxcbiAgICAgICAgbWVzc2FnZTogYCR7ZmFpbHVyZU1lc3NhZ2UgPz8gJ+aIv+mXtOWumuS5iee7keWumuWksei0pSd977yb5bey5Zue5rua5paw6LWE5rqQJHtyb2xsYmFja0Vycm9ycy5sZW5ndGggPT09IDAgPyAnJyA6IGDvvIzlm57mu5rlpLHotKXvvJoke3JvbGxiYWNrRXJyb3JzLmpvaW4oJ++8mycpfWB9YCxcbiAgICAgIH07XG4gICAgfSk7XG4gIH0sXG4gIG9wZW5DcmVhdGVkUHJlZmFiKHByZWZhYlVybDogc3RyaW5nKSB7XG4gICAgcmV0dXJuIEVkaXRvci5NZXNzYWdlLnJlcXVlc3QoJ2Fzc2V0LWRiJywgJ29wZW4tYXNzZXQnLCBwcmVmYWJVcmwpO1xuICB9LFxuICB2YWxpZGF0ZU9wZW5Sb29tUHJlZmFiKCkge1xuICAgIHJldHVybiB2YWxpZGF0ZU9wZW5Sb29tUHJlZmFiKGVkaXRvclNjZW5lUXVlcnkpO1xuICB9LFxuICBhc3luYyByZWZyZXNoQXV0aG9yaW5nU3RhdGUoKSB7XG4gICAgYXdhaXQgcmVmcmVzaFJvb21DYXRhbG9nTm93KCk7XG4gICAgcmV0dXJuIGF3YWl0IGdldEF1dGhvcmluZ1N0YXRlKCk7XG4gIH0sXG4gIGluaXRpYWxpemVQcm90b3R5cGVTY2VuZSgpIHtcbiAgICByZXR1cm4gaW5pdGlhbGl6ZVByb3RvdHlwZVNjZW5lKGVkaXRvclNjZW5lUXVlcnkpO1xuICB9LFxuICBhc3luYyBnZXRBdXRob3JpbmdTdGF0ZSgpIHtcbiAgICByZXR1cm4gYXdhaXQgZ2V0QXV0aG9yaW5nU3RhdGUoKTtcbiAgfSxcbiAgYXN5bmMgY3JlYXRlUm9vbUluc3RhbmNlKGVudHJ5OiBQYXJhbWV0ZXJzPHR5cGVvZiBjcmVhdGVSb29tRnJvbVNlbGVjdGlvbj5bMF0pIHtcbiAgICByZXR1cm4gYXdhaXQgY3JlYXRlUm9vbUZyb21TZWxlY3Rpb24oZW50cnksIHsgbm9kZVV1aWQ6IGdldFNlbGVjdGVkTm9kZVV1aWQoKSB9KTtcbiAgfSxcbiAgYXN5bmMgdXBkYXRlUm9vbURlZmluaXRpb24ocmVxdWVzdDogUm9vbURlZmluaXRpb25FZGl0UmVxdWVzdCkge1xuICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IHVwZGF0ZVJvb21EZWZpbml0aW9uKHJlcXVlc3QsIGVkaXRvckFzc2V0RGIpO1xuICAgIGlmIChyZXN1bHQub2spIGF3YWl0IHJlZnJlc2hSb29tQ2F0YWxvZ05vdygpO1xuICAgIHJldHVybiByZXN1bHQ7XG4gIH0sXG59O1xuXG5leHBvcnQgZnVuY3Rpb24gbG9hZCgpOiB2b2lkIHtcbiAgdm9pZCByZWZyZXNoUm9vbUNhdGFsb2dOb3coKS5jYXRjaCgoY2F1c2U6IHVua25vd24pID0+IHtcbiAgICBjb25zb2xlLndhcm4oYFtST09NXSDmiL/pl7Tlu7rnrZHliJfooajliLfmlrDlpLHotKXvvJoke2NhdXNlIGluc3RhbmNlb2YgRXJyb3IgPyBjYXVzZS5tZXNzYWdlIDogU3RyaW5nKGNhdXNlKX1gKTtcbiAgfSk7XG59XG5leHBvcnQgZnVuY3Rpb24gdW5sb2FkKCk6IHZvaWQge31cblxuYXN5bmMgZnVuY3Rpb24gcmVmcmVzaFJvb21DYXRhbG9nTm93KCkge1xuICBjb25zdCByZXN1bHQgPSBhd2FpdCBkaXNjb3ZlclJvb21QcmVmYWJzKGVkaXRvckFzc2V0RGIpO1xuICBzZXRSb29tQ2F0YWxvZyhyZXN1bHQuZW50cmllcyk7XG4gIGNhdGFsb2dXYXJuaW5ncyA9IHJlc3VsdC53YXJuaW5ncztcbiAgZm9yIChjb25zdCB3YXJuaW5nIG9mIHJlc3VsdC53YXJuaW5ncykgY29uc29sZS53YXJuKGBbUk9PTV0gJHt3YXJuaW5nfWApO1xuICByZXR1cm4gcmVzdWx0O1xufVxuXG5hc3luYyBmdW5jdGlvbiBnZXRBdXRob3JpbmdTdGF0ZSgpOiBQcm9taXNlPEF1dGhvcmluZ1N0YXRlPiB7XG4gIGNvbnN0IHNlbGVjdGVkVXVpZCA9IGdldFNlbGVjdGVkTm9kZVV1aWQoKTtcbiAgdHJ5IHtcbiAgICBjb25zdCB0cmVlID0gYXdhaXQgZWRpdG9yU2NlbmVRdWVyeS5xdWVyeU5vZGVUcmVlKCk7XG4gICAgY29uc3Qgc2VsZWN0ZWROb2RlID0gc2VsZWN0ZWRVdWlkID09PSB1bmRlZmluZWQgPyB1bmRlZmluZWQgOiBmbGF0dGVuVHJlZSh0cmVlKS5maW5kKChub2RlKSA9PiBub2RlLnV1aWQgPT09IHNlbGVjdGVkVXVpZCk7XG4gICAgY29uc3QgdGFyZ2V0ID0gcmVzb2x2ZVJvb21Sb290KHRyZWUsIHsgbm9kZVV1aWQ6IHNlbGVjdGVkVXVpZCB9KTtcbiAgICBjb25zdCByb29tVGFyZ2V0ID0gdGFyZ2V0Lm9rXG4gICAgICA/IHtcbiAgICAgICAgb2s6IHRydWUsXG4gICAgICAgIHV1aWQ6IHRhcmdldC5ub2RlLnV1aWQsXG4gICAgICAgIHBhdGg6IGdldE5vZGVQYXRoKHRyZWUsIHRhcmdldC5ub2RlLnV1aWQpLFxuICAgICAgICBtZXNzYWdlOiAn5bey6Kej5p6Q5ZSv5LiAIFJvb21Sb29077yM5Y+v5Yib5bu65oi/6Ze05bu6562RJyxcbiAgICAgIH1cbiAgICAgIDogeyBvazogZmFsc2UsIG1lc3NhZ2U6IHRhcmdldC5tZXNzYWdlIH07XG4gICAgcmV0dXJuIHtcbiAgICAgIHNlbGVjdGlvbjogeyB1dWlkOiBzZWxlY3RlZFV1aWQsIG5hbWU6IHNlbGVjdGVkTm9kZT8ubmFtZSB9LFxuICAgICAgcm9vbVRhcmdldCxcbiAgICAgIHJvb21zOiBnZXRSb29tQ2F0YWxvZygpLFxuICAgICAgd2FybmluZ3M6IGNhdGFsb2dXYXJuaW5ncyxcbiAgICB9O1xuICB9IGNhdGNoIChjYXVzZSkge1xuICAgIHJldHVybiB7XG4gICAgICBzZWxlY3Rpb246IHsgdXVpZDogc2VsZWN0ZWRVdWlkIH0sXG4gICAgICByb29tVGFyZ2V0OiB7IG9rOiBmYWxzZSwgbWVzc2FnZTogYOaXoOazleivu+WPluW9k+WJjeWcuuaZr++8miR7Y2F1c2UgaW5zdGFuY2VvZiBFcnJvciA/IGNhdXNlLm1lc3NhZ2UgOiBTdHJpbmcoY2F1c2UpfWAgfSxcbiAgICAgIHJvb21zOiBnZXRSb29tQ2F0YWxvZygpLFxuICAgICAgd2FybmluZ3M6IGNhdGFsb2dXYXJuaW5ncyxcbiAgICB9O1xuICB9XG59XG5cbmZ1bmN0aW9uIGdldFNlbGVjdGVkTm9kZVV1aWQoKTogc3RyaW5nIHwgdW5kZWZpbmVkIHtcbiAgY29uc3Qgc2VsZWN0aW9uID0gKGdsb2JhbFRoaXMgYXMge1xuICAgIEVkaXRvcj86IHsgU2VsZWN0aW9uPzogeyBnZXRTZWxlY3RlZD86ICh0eXBlOiBzdHJpbmcpID0+IHJlYWRvbmx5IHN0cmluZ1tdIH0gfTtcbiAgfSkuRWRpdG9yPy5TZWxlY3Rpb247XG4gIHJldHVybiBzZWxlY3Rpb24/LmdldFNlbGVjdGVkPy4oJ25vZGUnKT8uWzBdO1xufVxuXG5mdW5jdGlvbiBmbGF0dGVuVHJlZSh0cmVlOiBTY2VuZU5vZGVUcmVlKTogU2NlbmVOb2RlVHJlZVtdIHtcbiAgY29uc3QgcmVzdWx0OiBTY2VuZU5vZGVUcmVlW10gPSBbXTtcbiAgY29uc3QgdmlzaXQgPSAobm9kZTogU2NlbmVOb2RlVHJlZSwgcGFyZW50Pzogc3RyaW5nKTogdm9pZCA9PiB7XG4gICAgcmVzdWx0LnB1c2gocGFyZW50ID09PSB1bmRlZmluZWQgfHwgbm9kZS5wYXJlbnQgIT09IHVuZGVmaW5lZCA/IG5vZGUgOiB7IC4uLm5vZGUsIHBhcmVudCB9KTtcbiAgICBmb3IgKGNvbnN0IGNoaWxkIG9mIG5vZGUuY2hpbGRyZW4gPz8gW10pIHZpc2l0KGNoaWxkLCBub2RlLnV1aWQpO1xuICB9O1xuICB2aXNpdCh0cmVlKTtcbiAgcmV0dXJuIHJlc3VsdDtcbn1cblxuZnVuY3Rpb24gZ2V0Tm9kZVBhdGgodHJlZTogU2NlbmVOb2RlVHJlZSwgdXVpZDogc3RyaW5nIHwgdW5kZWZpbmVkKTogc3RyaW5nIHwgdW5kZWZpbmVkIHtcbiAgaWYgKHV1aWQgPT09IHVuZGVmaW5lZCkgcmV0dXJuIHVuZGVmaW5lZDtcbiAgY29uc3Qgbm9kZXMgPSBmbGF0dGVuVHJlZSh0cmVlKTtcbiAgY29uc3QgYnlVdWlkID0gbmV3IE1hcChub2Rlcy5maWx0ZXIoKG5vZGUpID0+IG5vZGUudXVpZCAhPT0gdW5kZWZpbmVkKS5tYXAoKG5vZGUpID0+IFtub2RlLnV1aWQgYXMgc3RyaW5nLCBub2RlXSkpO1xuICBjb25zdCBuYW1lczogc3RyaW5nW10gPSBbXTtcbiAgbGV0IGN1cnNvciA9IGJ5VXVpZC5nZXQodXVpZCk7XG4gIHdoaWxlIChjdXJzb3IgIT09IHVuZGVmaW5lZCkge1xuICAgIGlmIChjdXJzb3IubmFtZSAhPT0gdW5kZWZpbmVkKSBuYW1lcy51bnNoaWZ0KGN1cnNvci5uYW1lKTtcbiAgICBjdXJzb3IgPSBjdXJzb3IucGFyZW50ID09PSB1bmRlZmluZWQgPyB1bmRlZmluZWQgOiBieVV1aWQuZ2V0KGN1cnNvci5wYXJlbnQpO1xuICB9XG4gIHJldHVybiBuYW1lcy5qb2luKCcvJyk7XG59XG4iXX0=