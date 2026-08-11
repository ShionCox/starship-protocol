"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveRoomRoot = resolveRoomRoot;
exports.resolveRoomPlacementTarget = resolveRoomPlacementTarget;
exports.nextRoomInstanceId = nextRoomInstanceId;
exports.createRoomInstance = createRoomInstance;
const editor_scene_1 = require("../shared/editor-scene");
const prototype_scene_names_1 = require("../scene/prototype-scene-names");
/**
 * 根据面板当前选择解析语义 RoomRoot。
 * 层级管理器只提供选择上下文，真正的创建始终由公开 Scene 消息完成。
 */
function resolveRoomRoot(tree, context) {
    var _a;
    const nodes = flattenTree(tree);
    const byUuid = new Map(nodes.filter((node) => typeof node.uuid === 'string').map((node) => [node.uuid, node]));
    const selected = context.nodeUuid === undefined ? undefined : byUuid.get(context.nodeUuid);
    if (selected !== undefined && (0, prototype_scene_names_1.isPrototypeSceneNodeName)(selected.name, 'roomRoot')) {
        return { ok: true, node: selected };
    }
    let cursor = selected;
    while ((cursor === null || cursor === void 0 ? void 0 : cursor.parent) !== undefined) {
        cursor = byUuid.get(cursor.parent);
        if (cursor !== undefined && (0, prototype_scene_names_1.isPrototypeSceneNodeName)(cursor.name, 'roomRoot')) {
            return { ok: true, node: cursor };
        }
    }
    if (selected !== undefined && (0, prototype_scene_names_1.isPrototypeSceneNodeName)(selected.name, 'shipRoot')) {
        const children = ((_a = selected.children) !== null && _a !== void 0 ? _a : []).filter((node) => (0, prototype_scene_names_1.isPrototypeSceneNodeName)(node.name, 'roomRoot'));
        if (children.length === 1)
            return { ok: true, node: children[0] };
        return { ok: false, message: 'ShipRoot 下缺少唯一 RoomRoot，请先初始化 Prototype 场景骨架' };
    }
    const roomRoots = nodes.filter((node) => (0, prototype_scene_names_1.isPrototypeSceneNodeName)(node.name, 'roomRoot'));
    if (roomRoots.length === 1)
        return { ok: true, node: roomRoots[0] };
    if (roomRoots.length === 0)
        return { ok: false, message: '场景中没有 RoomRoot，请先初始化 Prototype 场景骨架' };
    return { ok: false, message: '场景中存在多个 RoomRoot，无法安全决定房间父节点' };
}
/**
 * 解析房间实例的当前场景放置目标。
 * 房间目录是项目级资源；只有存在完整网格入口时才把创建动作绑定到 RoomRoot。
 * 没有标准骨架时优先挂到 Canvas，避免把资源库错误地限制为某个场景。
 */
function resolveRoomPlacementTarget(tree, context, componentClasses = []) {
    const roomRootResult = resolveRoomRoot(tree, context);
    const appRoot = flattenTree(tree).find((node) => (0, prototype_scene_names_1.isPrototypeSceneNodeName)(node.name, 'appRoot'));
    const settings = appRoot === undefined ? null : findComponentInNode(appRoot, 'PrototypeSceneSettings', componentClasses);
    const camera = appRoot === undefined ? null : findComponentInNode(appRoot, 'CameraController', componentClasses);
    const settingsTarget = (0, editor_scene_1.getSceneComponentTarget)(settings);
    if (roomRootResult.ok && roomRootResult.node.uuid !== undefined && settingsTarget !== undefined && camera !== null) {
        return {
            ok: true,
            mode: 'grid',
            node: roomRootResult.node,
            settings: settingsTarget,
            message: '已解析标准 RoomRoot，可按逻辑网格创建房间建筑',
        };
    }
    // 多个 RoomRoot 表示场景结构冲突；已有选择无法安全消除歧义时不静默改挂到别处。
    if (!roomRootResult.ok && roomRootResult.message.includes('多个 RoomRoot')) {
        return { ok: false, mode: 'blocked', message: roomRootResult.message };
    }
    const canvas = resolveCanvasNode(tree, context, componentClasses);
    if ((canvas === null || canvas === void 0 ? void 0 : canvas.uuid) !== undefined) {
        return {
            ok: true,
            mode: 'canvas',
            node: canvas,
            message: '未发现完整标准骨架，将创建到 Canvas 顶层',
        };
    }
    if (tree.uuid !== undefined) {
        return {
            ok: true,
            mode: 'scene-root',
            node: tree,
            message: '未发现完整骨架和 Canvas，将创建到场景顶层；请在编辑器中确认 2D 可见性',
        };
    }
    return { ok: false, mode: 'blocked', message: '当前场景缺少可用根节点，无法创建房间建筑' };
}
function nextRoomInstanceId(tree, definitionId, existingIds = []) {
    var _a, _b;
    const used = new Set(existingIds.filter((id) => id.length > 0));
    for (const node of flattenTree(tree)) {
        for (const component of (_a = node.components) !== null && _a !== void 0 ? _a : []) {
            if (component.type === 'RoomView')
                used.add((_b = node.name) !== null && _b !== void 0 ? _b : '');
        }
    }
    let index = 1;
    while (used.has(`${definitionId}-${index}`) || used.has(`Room-${definitionId}-${index}`))
        index += 1;
    return `${definitionId}-${index}`;
}
/** 面板创建房间实例的原子操作：失败不留下节点，成功只生成一条 Undo 记录。 */
async function createRoomInstance(scene, context, entry) {
    const tree = await scene.queryNodeTree();
    // 组件注册表只是 CID 兼容层；查询失败时仍可按节点名选择 Canvas/场景根。
    const componentClasses = scene.queryComponents === undefined
        ? []
        : await scene.queryComponents().catch(() => []);
    const placementTarget = resolveRoomPlacementTarget(tree, context, componentClasses);
    if (!placementTarget.ok)
        return { ok: false, message: placementTarget.message };
    if (placementTarget.node.uuid === undefined)
        return { ok: false, message: '放置目标缺少 UUID，无法创建房间' };
    let position;
    if (placementTarget.mode === 'grid') {
        const candidate = await scene.executeComponentMethod(placementTarget.settings.uuid, 'findFirstAvailableRoomPlacement', [entry.width, entry.height]);
        if (candidate === null || !Number.isInteger(candidate === null || candidate === void 0 ? void 0 : candidate.x) || !Number.isInteger(candidate === null || candidate === void 0 ? void 0 : candidate.y)) {
            return { ok: false, message: `没有可放置 ${entry.displayName} 的合法空位` };
        }
        position = { x: candidate.x, y: candidate.y };
    }
    const existingIds = await collectRoomInstanceIds(scene, tree, componentClasses);
    let createdUuid;
    let undoId;
    try {
        undoId = await scene.beginRecording(placementTarget.node.uuid);
        const created = await scene.createNode({
            parent: placementTarget.node.uuid,
            name: `房间-${entry.displayName}`,
            assetUuid: entry.prefabUuid,
            type: 'cc.Prefab',
            position: { x: 0, y: 0, z: 0 },
            unlinkPrefab: false,
        });
        createdUuid = created === null || created === void 0 ? void 0 : created.uuid;
        if (createdUuid === undefined)
            throw new Error(`创建房间 Prefab 失败：${entry.prefabUrl}`);
        const linkedNodes = await scene.queryNodesByAssetUuid(entry.prefabUuid);
        if (!linkedNodes.includes(createdUuid)) {
            throw new Error(`创建结果未保留 Prefab 关联：${entry.prefabUrl}`);
        }
        const createdTree = await scene.queryNodeTree();
        const createdNode = findNode(createdTree, createdUuid);
        const roomViewComponent = createdNode === null ? null : findComponentInNode(createdNode, 'RoomView', componentClasses);
        const roomViewUuid = (0, editor_scene_1.getSceneComponentUuid)(roomViewComponent);
        if (roomViewUuid === undefined)
            throw new Error('生成的 Prefab 缺少 RoomView 组件');
        const instanceId = nextRoomInstanceId(createdTree, entry.id, existingIds);
        const roomViewTarget = (0, editor_scene_1.getSceneComponentTarget)(roomViewComponent);
        if (roomViewTarget === undefined)
            throw new Error('生成的 Prefab 缺少可编辑的 RoomView 组件定位');
        if (!(await scene.setProperty(roomViewTarget, 'roomInstanceId', instanceId, { record: false }))) {
            throw new Error('无法写入房间实例 ID');
        }
        if (placementTarget.mode === 'grid') {
            const applied = await scene.executeComponentMethod(roomViewUuid, 'applyEditorPlacement', [{ x: position === null || position === void 0 ? void 0 : position.x, y: position === null || position === void 0 ? void 0 : position.y }]);
            if (applied !== true)
                throw new Error('无法把房间吸附到合法逻辑格');
        }
        await scene.endRecording(undoId);
        undoId = undefined;
        selectNode(createdUuid);
        // 聚焦只是编辑器体验增强；Undo 已提交后，聚焦失败不能反向删除已成功创建的房间。
        await focusNode(createdUuid).catch(() => undefined);
        const placementMessage = placementTarget.mode === 'grid'
            ? '已按逻辑网格放置'
            : placementTarget.mode === 'canvas' ? '已放到 Canvas 顶层' : '已放到场景顶层';
        return { ok: true, message: `已创建 ${entry.displayName}，${placementMessage}，实例 ID：${instanceId}`, nodeUuid: createdUuid };
    }
    catch (error) {
        if (createdUuid !== undefined)
            await scene.removeNode(createdUuid).catch(() => undefined);
        if (undoId !== undefined)
            await scene.cancelRecording(undoId).catch(() => undefined);
        await scene.snapshotAbort().catch(() => undefined);
        return { ok: false, message: `${toMessage(error)}；已回滚临时房间节点` };
    }
}
function resolveCanvasNode(tree, context, componentClasses) {
    const nodes = flattenTree(tree);
    const byUuid = new Map(nodes.filter((node) => typeof node.uuid === 'string').map((node) => [node.uuid, node]));
    let cursor = context.nodeUuid === undefined ? undefined : byUuid.get(context.nodeUuid);
    while (cursor !== undefined) {
        if (isCanvasNode(cursor, componentClasses))
            return cursor;
        cursor = cursor.parent === undefined ? undefined : byUuid.get(cursor.parent);
    }
    return nodes.find((node) => isCanvasNode(node, componentClasses));
}
function isCanvasNode(node, componentClasses) {
    var _a;
    return (0, prototype_scene_names_1.isPrototypeSceneNodeName)(node.name, 'canvas')
        || ((_a = node.components) !== null && _a !== void 0 ? _a : []).some((component) => (0, editor_scene_1.componentTypeMatches)(component, 'Canvas', componentClasses));
}
function flattenTree(tree) {
    const result = [];
    const visit = (node, parentUuid) => {
        var _a;
        result.push(parentUuid === undefined || node.parent !== undefined ? node : Object.assign(Object.assign({}, node), { parent: parentUuid }));
        for (const child of (_a = node.children) !== null && _a !== void 0 ? _a : [])
            visit(child, node.uuid);
    };
    visit(tree);
    return result;
}
function findNode(tree, uuid) {
    var _a;
    return (_a = flattenTree(tree).find((node) => node.uuid === uuid)) !== null && _a !== void 0 ? _a : null;
}
function findComponentInNode(node, type, componentClasses) {
    var _a, _b, _c;
    for (const [index, component] of ((_a = node.components) !== null && _a !== void 0 ? _a : []).entries()) {
        const candidate = Object.assign(Object.assign({}, component), { nodeUuid: (_b = component.nodeUuid) !== null && _b !== void 0 ? _b : node.uuid, index: (_c = component.index) !== null && _c !== void 0 ? _c : index });
        if ((0, editor_scene_1.componentTypeMatches)(candidate, type, componentClasses))
            return candidate;
    }
    return null;
}
async function collectRoomInstanceIds(scene, tree, componentClasses) {
    var _a, _b;
    const result = [];
    for (const node of flattenTree(tree)) {
        for (const component of (_a = node.components) !== null && _a !== void 0 ? _a : []) {
            if (!(0, editor_scene_1.componentTypeMatches)(component, 'RoomView', componentClasses))
                continue;
            const componentUuid = (0, editor_scene_1.getSceneComponentUuid)(component);
            if (componentUuid === undefined)
                continue;
            try {
                const queried = await scene.queryComponent(componentUuid);
                const id = readStringProperty((_b = queried === null || queried === void 0 ? void 0 : queried.value) === null || _b === void 0 ? void 0 : _b.roomInstanceId);
                if (id !== undefined)
                    result.push(id);
            }
            catch (_c) {
                // 旧 Prefab 的单组件查询失败不应阻断创建，最终唯一性仍由运行时校验。
            }
        }
    }
    return result;
}
function readStringProperty(value) {
    if (typeof value === 'string' && value.length > 0)
        return value;
    if (typeof value !== 'object' || value === null)
        return undefined;
    const nested = value.value;
    return typeof nested === 'string' && nested.length > 0 ? nested : undefined;
}
function selectNode(uuid) {
    var _a, _b;
    const selection = (_a = globalThis.Editor) === null || _a === void 0 ? void 0 : _a.Selection;
    (_b = selection === null || selection === void 0 ? void 0 : selection.select) === null || _b === void 0 ? void 0 : _b.call(selection, 'node', uuid);
}
async function focusNode(uuid) {
    var _a, _b, _c;
    await ((_c = (_b = (_a = globalThis.Editor) === null || _a === void 0 ? void 0 : _a.Message) === null || _b === void 0 ? void 0 : _b.request) === null || _c === void 0 ? void 0 : _c.call(_b, 'scene', 'focus-camera', [uuid]));
}
function toMessage(value) {
    return value instanceof Error ? value.message : String(value);
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicm9vbS1zY2VuZS1hdXRob3JpbmcuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi9zcmMvcm9vbXMvcm9vbS1zY2VuZS1hdXRob3JpbmcudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7QUEwQ0EsMENBNkJDO0FBT0QsZ0VBMkNDO0FBRUQsZ0RBY0M7QUFHRCxnREFtRkM7QUF2TkQseURBQThHO0FBRTlHLDBFQUEwRTtBQTRCMUU7OztHQUdHO0FBQ0gsU0FBZ0IsZUFBZSxDQUM3QixJQUFtQixFQUNuQixPQUE4Qjs7SUFFOUIsTUFBTSxLQUFLLEdBQUcsV0FBVyxDQUFDLElBQUksQ0FBQyxDQUFDO0lBQ2hDLE1BQU0sTUFBTSxHQUFHLElBQUksR0FBRyxDQUFDLEtBQUssQ0FBQyxNQUFNLENBQUMsQ0FBQyxJQUFJLEVBQUUsRUFBRSxDQUFDLE9BQU8sSUFBSSxDQUFDLElBQUksS0FBSyxRQUFRLENBQUMsQ0FBQyxHQUFHLENBQUMsQ0FBQyxJQUFJLEVBQUUsRUFBRSxDQUFDLENBQUMsSUFBSSxDQUFDLElBQWMsRUFBRSxJQUFJLENBQUMsQ0FBQyxDQUFDLENBQUM7SUFDekgsTUFBTSxRQUFRLEdBQUcsT0FBTyxDQUFDLFFBQVEsS0FBSyxTQUFTLENBQUMsQ0FBQyxDQUFDLFNBQVMsQ0FBQyxDQUFDLENBQUMsTUFBTSxDQUFDLEdBQUcsQ0FBQyxPQUFPLENBQUMsUUFBUSxDQUFDLENBQUM7SUFDM0YsSUFBSSxRQUFRLEtBQUssU0FBUyxJQUFJLElBQUEsZ0RBQXdCLEVBQUMsUUFBUSxDQUFDLElBQUksRUFBRSxVQUFVLENBQUMsRUFBRSxDQUFDO1FBQ2xGLE9BQU8sRUFBRSxFQUFFLEVBQUUsSUFBSSxFQUFFLElBQUksRUFBRSxRQUFRLEVBQUUsQ0FBQztJQUN0QyxDQUFDO0lBRUQsSUFBSSxNQUFNLEdBQUcsUUFBUSxDQUFDO0lBQ3RCLE9BQU8sQ0FBQSxNQUFNLGFBQU4sTUFBTSx1QkFBTixNQUFNLENBQUUsTUFBTSxNQUFLLFNBQVMs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QUMsQ0FBQztBQUNoRSxDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHR5cGUgeyBTY2VuZVNlbGVjdGlvbkNvbnRleHQgfSBmcm9tICcuLi9jb250cmFjdHMnO1xuaW1wb3J0IHR5cGUge1xuICBTY2VuZUNvbXBvbmVudENsYXNzSW5mbyxcbiAgU2NlbmVDb21wb25lbnRJbmZvLFxuICBTY2VuZUNvbXBvbmVudFRhcmdldCxcbiAgU2NlbmVOb2RlVHJlZSxcbiAgU2NlbmVRdWVyeVBvcnQsXG59IGZyb20gJy4uL3NoYXJlZC9lZGl0b3Itc2NlbmUnO1xuaW1wb3J0IHsgY29tcG9uZW50VHlwZU1hdGNoZXMsIGdldFNjZW5lQ29tcG9uZW50VGFyZ2V0LCBnZXRTY2VuZUNvbXBvbmVudFV1aWQgfSBmcm9tICcuLi9zaGFyZWQvZWRpdG9yLXNjZW5lJztcbmltcG9ydCB0eXBlIHsgUm9vbVByZWZhYkNhdGFsb2dFbnRyeSB9IGZyb20gJy4vZGlzY292ZXItcm9vbS1wcmVmYWJzJztcbmltcG9ydCB7IGlzUHJvdG90eXBlU2NlbmVOb2RlTmFtZSB9IGZyb20gJy4uL3NjZW5lL3Byb3RvdHlwZS1zY2VuZS1uYW1lcyc7XG5cbmV4cG9ydCBpbnRlcmZhY2UgUm9vbVNjZW5lQXV0aG9yaW5nUmVzdWx0IHtcbiAgcmVhZG9ubHkgb2s6IGJvb2xlYW47XG4gIHJlYWRvbmx5IG1lc3NhZ2U6IHN0cmluZztcbiAgcmVhZG9ubHkgbm9kZVV1aWQ/OiBzdHJpbmc7XG59XG5cbmV4cG9ydCB0eXBlIFJvb21QbGFjZW1lbnRUYXJnZXQgPVxuICB8IHtcbiAgICByZWFkb25seSBvazogdHJ1ZTtcbiAgICByZWFkb25seSBtb2RlOiAnZ3JpZCc7XG4gICAgcmVhZG9ubHkgbm9kZTogU2NlbmVOb2RlVHJlZTtcbiAgICByZWFkb25seSBzZXR0aW5nczogU2NlbmVDb21wb25lbnRUYXJnZXQ7XG4gICAgcmVhZG9ubHkgbWVzc2FnZTogc3RyaW5nO1xuICB9XG4gIHwge1xuICAgIHJlYWRvbmx5IG9rOiB0cnVlO1xuICAgIHJlYWRvbmx5IG1vZGU6ICdjYW52YXMnIHwgJ3NjZW5lLXJvb3QnO1xuICAgIHJlYWRvbmx5IG5vZGU6IFNjZW5lTm9kZVRyZWU7XG4gICAgcmVhZG9ubHkgbWVzc2FnZTogc3RyaW5nO1xuICB9XG4gIHwge1xuICAgIHJlYWRvbmx5IG9rOiBmYWxzZTtcbiAgICByZWFkb25seSBtb2RlOiAnYmxvY2tlZCc7XG4gICAgcmVhZG9ubHkgbWVzc2FnZTogc3RyaW5nO1xuICB9O1xuXG4vKipcbiAqIOagueaNrumdouadv+W9k+WJjemAieaLqeino+aekOivreS5iSBSb29tUm9vdOOAglxuICog5bGC57qn566h55CG5Zmo5Y+q5o+Q5L6b6YCJ5oup5LiK5LiL5paH77yM55yf5q2j55qE5Yib5bu65aeL57uI55Sx5YWs5byAIFNjZW5lIOa2iOaBr+WujOaIkOOAglxuICovXG5leHBvcnQgZnVuY3Rpb24gcmVzb2x2ZVJvb21Sb290KFxuICB0cmVlOiBTY2VuZU5vZGVUcmVlLFxuICBjb250ZXh0OiBTY2VuZVNlbGVjdGlvbkNvbnRleHQsXG4pOiB7IHJlYWRvbmx5IG9rOiB0cnVlOyByZWFkb25seSBub2RlOiBTY2VuZU5vZGVUcmVlIH0gfCB7IHJlYWRvbmx5IG9rOiBmYWxzZTsgcmVhZG9ubHkgbWVzc2FnZTogc3RyaW5nIH0ge1xuICBjb25zdCBub2RlcyA9IGZsYXR0ZW5UcmVlKHRyZWUpO1xuICBjb25zdCBieVV1aWQgPSBuZXcgTWFwKG5vZGVzLmZpbHRlcigobm9kZSkgPT4gdHlwZW9mIG5vZGUudXVpZCA9PT0gJ3N0cmluZycpLm1hcCgobm9kZSkgPT4gW25vZGUudXVpZCBhcyBzdHJpbmcsIG5vZGVdKSk7XG4gIGNvbnN0IHNlbGVjdGVkID0gY29udGV4dC5ub2RlVXVpZCA9PT0gdW5kZWZpbmVkID8gdW5kZWZpbmVkIDogYnlVdWlkLmdldChjb250ZXh0Lm5vZGVVdWlkKTtcbiAgaWYgKHNlbGVjdGVkICE9PSB1bmRlZmluZWQgJiYgaXNQcm90b3R5cGVTY2VuZU5vZGVOYW1lKHNlbGVjdGVkLm5hbWUsICdyb29tUm9vdCcpKSB7XG4gICAgcmV0dXJuIHsgb2s6IHRydWUsIG5vZGU6IHNlbGVjdGVkIH07XG4gIH1cblxuICBsZXQgY3Vyc29yID0gc2VsZWN0ZWQ7XG4gIHdoaWxlIChjdXJzb3I/LnBhcmVudCAhPT0gdW5kZWZpbmVkKSB7XG4gICAgY3Vyc29yID0gYnlVdWlkLmdldChjdXJzb3IucGFyZW50KTtcbiAgICBpZiAoY3Vyc29yICE9PSB1bmRlZmluZWQgJiYgaXNQcm90b3R5cGVTY2VuZU5vZGVOYW1lKGN1cnNvci5uYW1lLCAncm9vbVJvb3QnKSkge1xuICAgICAgcmV0dXJuIHsgb2s6IHRydWUsIG5vZGU6IGN1cnNvciB9O1xuICAgIH1cbiAgfVxuXG4gIGlmIChzZWxlY3RlZCAhPT0gdW5kZWZpbmVkICYmIGlzUHJvdG90eXBlU2NlbmVOb2RlTmFtZShzZWxlY3RlZC5uYW1lLCAnc2hpcFJvb3QnKSkge1xuICAgIGNvbnN0IGNoaWxkcmVuID0gKHNlbGVjdGVkLmNoaWxkcmVuID8/IFtdKS5maWx0ZXIoKG5vZGUpID0+IGlzUHJvdG90eXBlU2NlbmVOb2RlTmFtZShub2RlLm5hbWUsICdyb29tUm9vdCcpKTtcbiAgICBpZiAoY2hpbGRyZW4ubGVuZ3RoID09PSAxKSByZXR1cm4geyBvazogdHJ1ZSwgbm9kZTogY2hpbGRyZW5bMF0gfTtcbiAgICByZXR1cm4geyBvazogZmFsc2UsIG1lc3NhZ2U6ICdTaGlwUm9vdCDkuIvnvLrlsJHllK/kuIAgUm9vbVJvb3TvvIzor7flhYjliJ3lp4vljJYgUHJvdG90eXBlIOWcuuaZr+mqqOaeticgfTtcbiAgfVxuXG4gIGNvbnN0IHJvb21Sb290cyA9IG5vZGVzLmZpbHRlcigobm9kZSkgPT4gaXNQcm90b3R5cGVTY2VuZU5vZGVOYW1lKG5vZGUubmFtZSwgJ3Jvb21Sb290JykpO1xuICBpZiAocm9vbVJvb3RzLmxlbmd0aCA9PT0gMSkgcmV0dXJuIHsgb2s6IHRydWUsIG5vZGU6IHJvb21Sb290c1swXSB9O1xuICBpZiAocm9vbVJvb3RzLmxlbmd0aCA9PT0gMCkgcmV0dXJuIHsgb2s6IGZhbHNlLCBtZXNzYWdlOiAn5Zy65pmv5Lit5rKh5pyJIFJvb21Sb29077yM6K+35YWI5Yid5aeL5YyWIFByb3RvdHlwZSDlnLrmma/pqqjmnrYnIH07XG4gIHJldHVybiB7IG9rOiBmYWxzZSwgbWVzc2FnZTogJ+WcuuaZr+S4reWtmOWcqOWkmuS4qiBSb29tUm9vdO+8jOaXoOazleWuieWFqOWGs+WumuaIv+mXtOeItuiKgueCuScgfTtcbn1cblxuLyoqXG4gKiDop6PmnpDmiL/pl7Tlrp7kvovnmoTlvZPliY3lnLrmma/mlL7nva7nm67moIfjgIJcbiAqIOaIv+mXtOebruW9leaYr+mhueebrue6p+i1hOa6kO+8m+WPquacieWtmOWcqOWujOaVtOe9keagvOWFpeWPo+aXtuaJjeaKiuWIm+W7uuWKqOS9nOe7keWumuWIsCBSb29tUm9vdOOAglxuICog5rKh5pyJ5qCH5YeG6aqo5p625pe25LyY5YWI5oyC5YiwIENhbnZhc++8jOmBv+WFjeaKiui1hOa6kOW6k+mUmeivr+WcsOmZkOWItuS4uuafkOS4quWcuuaZr+OAglxuICovXG5leHBvcnQgZnVuY3Rpb24gcmVzb2x2ZVJvb21QbGFjZW1lbnRUYXJnZXQoXG4gIHRyZWU6IFNjZW5lTm9kZVRyZWUsXG4gIGNvbnRleHQ6IFNjZW5lU2VsZWN0aW9uQ29udGV4dCxcbiAgY29tcG9uZW50Q2xhc3NlczogcmVhZG9ubHkgU2NlbmVDb21wb25lbnRDbGFzc0luZm9bXSA9IFtdLFxuKTogUm9vbVBsYWNlbWVudFRhcmdldCB7XG4gIGNvbnN0IHJvb21Sb290UmVzdWx0ID0gcmVzb2x2ZVJvb21Sb290KHRyZWUsIGNvbnRleHQpO1xuICBjb25zdCBhcHBSb290ID0gZmxhdHRlblRyZWUodHJlZSkuZmluZCgobm9kZSkgPT4gaXNQcm90b3R5cGVTY2VuZU5vZGVOYW1lKG5vZGUubmFtZSwgJ2FwcFJvb3QnKSk7XG4gIGNvbnN0IHNldHRpbmdzID0gYXBwUm9vdCA9PT0gdW5kZWZpbmVkID8gbnVsbCA6IGZpbmRDb21wb25lbnRJbk5vZGUoYXBwUm9vdCwgJ1Byb3RvdHlwZVNjZW5lU2V0dGluZ3MnLCBjb21wb25lbnRDbGFzc2VzKTtcbiAgY29uc3QgY2FtZXJhID0gYXBwUm9vdCA9PT0gdW5kZWZpbmVkID8gbnVsbCA6IGZpbmRDb21wb25lbnRJbk5vZGUoYXBwUm9vdCwgJ0NhbWVyYUNvbnRyb2xsZXInLCBjb21wb25lbnRDbGFzc2VzKTtcbiAgY29uc3Qgc2V0dGluZ3NUYXJnZXQgPSBnZXRTY2VuZUNvbXBvbmVudFRhcmdldChzZXR0aW5ncyk7XG4gIGlmIChyb29tUm9vdFJlc3VsdC5vayAmJiByb29tUm9vdFJlc3VsdC5ub2RlLnV1aWQgIT09IHVuZGVmaW5lZCAmJiBzZXR0aW5nc1RhcmdldCAhPT0gdW5kZWZpbmVkICYmIGNhbWVyYSAhPT0gbnVsbCkge1xuICAgIHJldHVybiB7XG4gICAgICBvazogdHJ1ZSxcbiAgICAgIG1vZGU6ICdncmlkJyxcbiAgICAgIG5vZGU6IHJvb21Sb290UmVzdWx0Lm5vZGUsXG4gICAgICBzZXR0aW5nczogc2V0dGluZ3NUYXJnZXQsXG4gICAgICBtZXNzYWdlOiAn5bey6Kej5p6Q5qCH5YeGIFJvb21Sb29077yM5Y+v5oyJ6YC76L6R572R5qC85Yib5bu65oi/6Ze05bu6562RJyxcbiAgICB9O1xuICB9XG5cbiAgLy8g5aSa5LiqIFJvb21Sb290IOihqOekuuWcuuaZr+e7k+aehOWGsueqge+8m+W3suaciemAieaLqeaXoOazleWuieWFqOa2iOmZpOatp+S5ieaXtuS4jemdmem7mOaUueaMguWIsOWIq+WkhOOAglxuICBpZiAoIXJvb21Sb290UmVzdWx0Lm9rICYmIHJvb21Sb290UmVzdWx0Lm1lc3NhZ2UuaW5jbHVkZXMoJ+WkmuS4qiBSb29tUm9vdCcpKSB7XG4gICAgcmV0dXJuIHsgb2s6IGZhbHNlLCBtb2RlOiAnYmxvY2tlZCcsIG1lc3NhZ2U6IHJvb21Sb290UmVzdWx0Lm1lc3NhZ2UgfTtcbiAgfVxuXG4gIGNvbnN0IGNhbnZhcyA9IHJlc29sdmVDYW52YXNOb2RlKHRyZWUsIGNvbnRleHQsIGNvbXBvbmVudENsYXNzZXMpO1xuICBpZiAoY2FudmFzPy51dWlkICE9PSB1bmRlZmluZWQpIHtcbiAgICByZXR1cm4ge1xuICAgICAgb2s6IHRydWUsXG4gICAgICBtb2RlOiAnY2FudmFzJyxcbiAgICAgIG5vZGU6IGNhbnZhcyxcbiAgICAgIG1lc3NhZ2U6ICfmnKrlj5HnjrDlrozmlbTmoIflh4bpqqjmnrbvvIzlsIbliJvlu7rliLAgQ2FudmFzIOmhtuWxgicsXG4gICAgfTtcbiAgfVxuICBpZiAodHJlZS51dWlkICE9PSB1bmRlZmluZWQpIHtcbiAgICByZXR1cm4ge1xuICAgICAgb2s6IHRydWUsXG4gICAgICBtb2RlOiAnc2NlbmUtcm9vdCcsXG4gICAgICBub2RlOiB0cmVlLFxuICAgICAgbWVzc2FnZTogJ+acquWPkeeOsOWujOaVtOmqqOaetuWSjCBDYW52YXPvvIzlsIbliJvlu7rliLDlnLrmma/pobblsYLvvJvor7flnKjnvJbovpHlmajkuK3noa7orqQgMkQg5Y+v6KeB5oCnJyxcbiAgICB9O1xuICB9XG4gIHJldHVybiB7IG9rOiBmYWxzZSwgbW9kZTogJ2Jsb2NrZWQnLCBtZXNzYWdlOiAn5b2T5YmN5Zy65pmv57y65bCR5Y+v55So5qC56IqC54K577yM5peg5rOV5Yib5bu65oi/6Ze05bu6562RJyB9O1xufVxuXG5leHBvcnQgZnVuY3Rpb24gbmV4dFJvb21JbnN0YW5jZUlkKFxuICB0cmVlOiBTY2VuZU5vZGVUcmVlLFxuICBkZWZpbml0aW9uSWQ6IHN0cmluZyxcbiAgZXhpc3RpbmdJZHM6IHJlYWRvbmx5IHN0cmluZ1tdID0gW10sXG4pOiBzdHJpbmcge1xuICBjb25zdCB1c2VkID0gbmV3IFNldChleGlzdGluZ0lkcy5maWx0ZXIoKGlkKSA9PiBpZC5sZW5ndGggPiAwKSk7XG4gIGZvciAoY29uc3Qgbm9kZSBvZiBmbGF0dGVuVHJlZSh0cmVlKSkge1xuICAgIGZvciAoY29uc3QgY29tcG9uZW50IG9mIG5vZGUuY29tcG9uZW50cyA/PyBbXSkge1xuICAgICAgaWYgKGNvbXBvbmVudC50eXBlID09PSAnUm9vbVZpZXcnKSB1c2VkLmFkZChub2RlLm5hbWUgPz8gJycpO1xuICAgIH1cbiAgfVxuICBsZXQgaW5kZXggPSAxO1xuICB3aGlsZSAodXNlZC5oYXMoYCR7ZGVmaW5pdGlvbklkfS0ke2luZGV4fWApIHx8IHVzZWQuaGFzKGBSb29tLSR7ZGVmaW5pdGlvbklkfS0ke2luZGV4fWApKSBpbmRleCArPSAxO1xuICByZXR1cm4gYCR7ZGVmaW5pdGlvbklkfS0ke2luZGV4fWA7XG59XG5cbi8qKiDpnaLmnb/liJvlu7rmiL/pl7Tlrp7kvovnmoTljp/lrZDmk43kvZzvvJrlpLHotKXkuI3nlZnkuIvoioLngrnvvIzmiJDlip/lj6rnlJ/miJDkuIDmnaEgVW5kbyDorrDlvZXjgIIgKi9cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBjcmVhdGVSb29tSW5zdGFuY2UoXG4gIHNjZW5lOiBTY2VuZVF1ZXJ5UG9ydCxcbiAgY29udGV4dDogU2NlbmVTZWxlY3Rpb25Db250ZXh0LFxuICBlbnRyeTogUm9vbVByZWZhYkNhdGFsb2dFbnRyeSxcbik6IFByb21pc2U8Um9vbVNjZW5lQXV0aG9yaW5nUmVzdWx0PiB7XG4gIGNvbnN0IHRyZWUgPSBhd2FpdCBzY2VuZS5xdWVyeU5vZGVUcmVlKCk7XG4gIC8vIOe7hOS7tuazqOWGjOihqOWPquaYryBDSUQg5YW85a655bGC77yb5p+l6K+i5aSx6LSl5pe25LuN5Y+v5oyJ6IqC54K55ZCN6YCJ5oupIENhbnZhcy/lnLrmma/moLnjgIJcbiAgY29uc3QgY29tcG9uZW50Q2xhc3NlcyA9IHNjZW5lLnF1ZXJ5Q29tcG9uZW50cyA9PT0gdW5kZWZpbmVkXG4gICAgPyBbXVxuICAgIDogYXdhaXQgc2NlbmUucXVlcnlDb21wb25lbnRzKCkuY2F0Y2goKCkgPT4gW10pO1xuICBjb25zdCBwbGFjZW1lbnRUYXJnZXQgPSByZXNvbHZlUm9vbVBsYWNlbWVudFRhcmdldCh0cmVlLCBjb250ZXh0LCBjb21wb25lbnRDbGFzc2VzKTtcbiAgaWYgKCFwbGFjZW1lbnRUYXJnZXQub2spIHJldHVybiB7IG9rOiBmYWxzZSwgbWVzc2FnZTogcGxhY2VtZW50VGFyZ2V0Lm1lc3NhZ2UgfTtcbiAgaWYgKHBsYWNlbWVudFRhcmdldC5ub2RlLnV1aWQgPT09IHVuZGVmaW5lZCkgcmV0dXJuIHsgb2s6IGZhbHNlLCBtZXNzYWdlOiAn5pS+572u55uu5qCH57y65bCRIFVVSUTvvIzml6Dms5XliJvlu7rmiL/pl7QnIH07XG5cbiAgbGV0IHBvc2l0aW9uOiB7IHJlYWRvbmx5IHg6IG51bWJlcjsgcmVhZG9ubHkgeTogbnVtYmVyIH0gfCB1bmRlZmluZWQ7XG4gIGlmIChwbGFjZW1lbnRUYXJnZXQubW9kZSA9PT0gJ2dyaWQnKSB7XG4gICAgY29uc3QgY2FuZGlkYXRlID0gYXdhaXQgc2NlbmUuZXhlY3V0ZUNvbXBvbmVudE1ldGhvZChcbiAgICAgIHBsYWNlbWVudFRhcmdldC5zZXR0aW5ncy51dWlkLFxuICAgICAgJ2ZpbmRGaXJzdEF2YWlsYWJsZVJvb21QbGFjZW1lbnQnLFxuICAgICAgW2VudHJ5LndpZHRoLCBlbnRyeS5oZWlnaHRdLFxuICAgICkgYXMgeyByZWFkb25seSB4PzogbnVtYmVyOyByZWFkb25seSB5PzogbnVtYmVyIH0gfCBudWxsO1xuICAgIGlmIChjYW5kaWRhdGUgPT09IG51bGwgfHwgIU51bWJlci5pc0ludGVnZXIoY2FuZGlkYXRlPy54KSB8fCAhTnVtYmVyLmlzSW50ZWdlcihjYW5kaWRhdGU/LnkpKSB7XG4gICAgICByZXR1cm4geyBvazogZmFsc2UsIG1lc3NhZ2U6IGDmsqHmnInlj6/mlL7nva4gJHtlbnRyeS5kaXNwbGF5TmFtZX0g55qE5ZCI5rOV56m65L2NYCB9O1xuICAgIH1cbiAgICBwb3NpdGlvbiA9IHsgeDogY2FuZGlkYXRlLnggYXMgbnVtYmVyLCB5OiBjYW5kaWRhdGUueSBhcyBudW1iZXIgfTtcbiAgfVxuICBjb25zdCBleGlzdGluZ0lkcyA9IGF3YWl0IGNvbGxlY3RSb29tSW5zdGFuY2VJZHMoc2NlbmUsIHRyZWUsIGNvbXBvbmVudENsYXNzZXMpO1xuICBsZXQgY3JlYXRlZFV1aWQ6IHN0cmluZyB8IHVuZGVmaW5lZDtcbiAgbGV0IHVuZG9JZDogc3RyaW5nIHwgdW5kZWZpbmVkO1xuICB0cnkge1xuICAgIHVuZG9JZCA9IGF3YWl0IHNjZW5lLmJlZ2luUmVjb3JkaW5nKHBsYWNlbWVudFRhcmdldC5ub2RlLnV1aWQpO1xuICAgIGNvbnN0IGNyZWF0ZWQgPSBhd2FpdCBzY2VuZS5jcmVhdGVOb2RlKHtcbiAgICAgIHBhcmVudDogcGxhY2VtZW50VGFyZ2V0Lm5vZGUudXVpZCxcbiAgICAgIG5hbWU6IGDmiL/pl7QtJHtlbnRyeS5kaXNwbGF5TmFtZX1gLFxuICAgICAgYXNzZXRVdWlkOiBlbnRyeS5wcmVmYWJVdWlkLFxuICAgICAgdHlwZTogJ2NjLlByZWZhYicsXG4gICAgICBwb3NpdGlvbjogeyB4OiAwLCB5OiAwLCB6OiAwIH0sXG4gICAgICB1bmxpbmtQcmVmYWI6IGZhbHNlLFxuICAgIH0pO1xuICAgIGNyZWF0ZWRVdWlkID0gY3JlYXRlZD8udXVpZDtcbiAgICBpZiAoY3JlYXRlZFV1aWQgPT09IHVuZGVmaW5lZCkgdGhyb3cgbmV3IEVycm9yKGDliJvlu7rmiL/pl7QgUHJlZmFiIOWksei0pe+8miR7ZW50cnkucHJlZmFiVXJsfWApO1xuXG4gICAgY29uc3QgbGlua2VkTm9kZXMgPSBhd2FpdCBzY2VuZS5xdWVyeU5vZGVzQnlBc3NldFV1aWQoZW50cnkucHJlZmFiVXVpZCk7XG4gICAgaWYgKCFsaW5rZWROb2Rlcy5pbmNsdWRlcyhjcmVhdGVkVXVpZCkpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihg5Yib5bu657uT5p6c5pyq5L+d55WZIFByZWZhYiDlhbPogZTvvJoke2VudHJ5LnByZWZhYlVybH1gKTtcbiAgICB9XG5cbiAgICBjb25zdCBjcmVhdGVkVHJlZSA9IGF3YWl0IHNjZW5lLnF1ZXJ5Tm9kZVRyZWUoKTtcbiAgICBjb25zdCBjcmVhdGVkTm9kZSA9IGZpbmROb2RlKGNyZWF0ZWRUcmVlLCBjcmVhdGVkVXVpZCk7XG4gICAgY29uc3Qgcm9vbVZpZXdDb21wb25lbnQgPSBjcmVhdGVkTm9kZSA9PT0gbnVsbCA/IG51bGwgOiBmaW5kQ29tcG9uZW50SW5Ob2RlKGNyZWF0ZWROb2RlLCAnUm9vbVZpZXcnLCBjb21wb25lbnRDbGFzc2VzKTtcbiAgICBjb25zdCByb29tVmlld1V1aWQgPSBnZXRTY2VuZUNvbXBvbmVudFV1aWQocm9vbVZpZXdDb21wb25lbnQpO1xuICAgIGlmIChyb29tVmlld1V1aWQgPT09IHVuZGVmaW5lZCkgdGhyb3cgbmV3IEVycm9yKCfnlJ/miJDnmoQgUHJlZmFiIOe8uuWwkSBSb29tVmlldyDnu4Tku7YnKTtcblxuICAgIGNvbnN0IGluc3RhbmNlSWQgPSBuZXh0Um9vbUluc3RhbmNlSWQoY3JlYXRlZFRyZWUsIGVudHJ5LmlkLCBleGlzdGluZ0lkcyk7XG4gICAgY29uc3Qgcm9vbVZpZXdUYXJnZXQgPSBnZXRTY2VuZUNvbXBvbmVudFRhcmdldChyb29tVmlld0NvbXBvbmVudCk7XG4gICAgaWYgKHJvb21WaWV3VGFyZ2V0ID09PSB1bmRlZmluZWQpIHRocm93IG5ldyBFcnJvcign55Sf5oiQ55qEIFByZWZhYiDnvLrlsJHlj6/nvJbovpHnmoQgUm9vbVZpZXcg57uE5Lu25a6a5L2NJyk7XG4gICAgaWYgKCEoYXdhaXQgc2NlbmUuc2V0UHJvcGVydHkocm9vbVZpZXdUYXJnZXQsICdyb29tSW5zdGFuY2VJZCcsIGluc3RhbmNlSWQsIHsgcmVjb3JkOiBmYWxzZSB9KSkpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcign5peg5rOV5YaZ5YWl5oi/6Ze05a6e5L6LIElEJyk7XG4gICAgfVxuICAgIGlmIChwbGFjZW1lbnRUYXJnZXQubW9kZSA9PT0gJ2dyaWQnKSB7XG4gICAgICBjb25zdCBhcHBsaWVkID0gYXdhaXQgc2NlbmUuZXhlY3V0ZUNvbXBvbmVudE1ldGhvZChcbiAgICAgICAgcm9vbVZpZXdVdWlkLFxuICAgICAgICAnYXBwbHlFZGl0b3JQbGFjZW1lbnQnLFxuICAgICAgICBbeyB4OiBwb3NpdGlvbj8ueCwgeTogcG9zaXRpb24/LnkgfV0sXG4gICAgICApO1xuICAgICAgaWYgKGFwcGxpZWQgIT09IHRydWUpIHRocm93IG5ldyBFcnJvcign5peg5rOV5oqK5oi/6Ze05ZC46ZmE5Yiw5ZCI5rOV6YC76L6R5qC8Jyk7XG4gICAgfVxuXG4gICAgYXdhaXQgc2NlbmUuZW5kUmVjb3JkaW5nKHVuZG9JZCk7XG4gICAgdW5kb0lkID0gdW5kZWZpbmVkO1xuICAgIHNlbGVjdE5vZGUoY3JlYXRlZFV1aWQpO1xuICAgIC8vIOiBmueEpuWPquaYr+e8lui+keWZqOS9k+mqjOWinuW8uu+8m1VuZG8g5bey5o+Q5Lqk5ZCO77yM6IGa54Sm5aSx6LSl5LiN6IO95Y+N5ZCR5Yig6Zmk5bey5oiQ5Yqf5Yib5bu655qE5oi/6Ze044CCXG4gICAgYXdhaXQgZm9jdXNOb2RlKGNyZWF0ZWRVdWlkKS5jYXRjaCgoKSA9PiB1bmRlZmluZWQpO1xuICAgIGNvbnN0IHBsYWNlbWVudE1lc3NhZ2UgPSBwbGFjZW1lbnRUYXJnZXQubW9kZSA9PT0gJ2dyaWQnXG4gICAgICA/ICflt7LmjInpgLvovpHnvZHmoLzmlL7nva4nXG4gICAgICA6IHBsYWNlbWVudFRhcmdldC5tb2RlID09PSAnY2FudmFzJyA/ICflt7LmlL7liLAgQ2FudmFzIOmhtuWxgicgOiAn5bey5pS+5Yiw5Zy65pmv6aG25bGCJztcbiAgICByZXR1cm4geyBvazogdHJ1ZSwgbWVzc2FnZTogYOW3suWIm+W7uiAke2VudHJ5LmRpc3BsYXlOYW1lfe+8jCR7cGxhY2VtZW50TWVzc2FnZX3vvIzlrp7kvosgSUTvvJoke2luc3RhbmNlSWR9YCwgbm9kZVV1aWQ6IGNyZWF0ZWRVdWlkIH07XG4gIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgaWYgKGNyZWF0ZWRVdWlkICE9PSB1bmRlZmluZWQpIGF3YWl0IHNjZW5lLnJlbW92ZU5vZGUoY3JlYXRlZFV1aWQpLmNhdGNoKCgpID0+IHVuZGVmaW5lZCk7XG4gICAgaWYgKHVuZG9JZCAhPT0gdW5kZWZpbmVkKSBhd2FpdCBzY2VuZS5jYW5jZWxSZWNvcmRpbmcodW5kb0lkKS5jYXRjaCgoKSA9PiB1bmRlZmluZWQpO1xuICAgIGF3YWl0IHNjZW5lLnNuYXBzaG90QWJvcnQoKS5jYXRjaCgoKSA9PiB1bmRlZmluZWQpO1xuICAgIHJldHVybiB7IG9rOiBmYWxzZSwgbWVzc2FnZTogYCR7dG9NZXNzYWdlKGVycm9yKX3vvJvlt7Llm57mu5rkuLTml7bmiL/pl7ToioLngrlgIH07XG4gIH1cbn1cblxuZnVuY3Rpb24gcmVzb2x2ZUNhbnZhc05vZGUoXG4gIHRyZWU6IFNjZW5lTm9kZVRyZWUsXG4gIGNvbnRleHQ6IFNjZW5lU2VsZWN0aW9uQ29udGV4dCxcbiAgY29tcG9uZW50Q2xhc3NlczogcmVhZG9ubHkgU2NlbmVDb21wb25lbnRDbGFzc0luZm9bXSxcbik6IFNjZW5lTm9kZVRyZWUgfCB1bmRlZmluZWQge1xuICBjb25zdCBub2RlcyA9IGZsYXR0ZW5UcmVlKHRyZWUpO1xuICBjb25zdCBieVV1aWQgPSBuZXcgTWFwKG5vZGVzLmZpbHRlcigobm9kZSkgPT4gdHlwZW9mIG5vZGUudXVpZCA9PT0gJ3N0cmluZycpLm1hcCgobm9kZSkgPT4gW25vZGUudXVpZCBhcyBzdHJpbmcsIG5vZGVdKSk7XG4gIGxldCBjdXJzb3IgPSBjb250ZXh0Lm5vZGVVdWlkID09PSB1bmRlZmluZWQgPyB1bmRlZmluZWQgOiBieVV1aWQuZ2V0KGNvbnRleHQubm9kZVV1aWQpO1xuICB3aGlsZSAoY3Vyc29yICE9PSB1bmRlZmluZWQpIHtcbiAgICBpZiAoaXNDYW52YXNOb2RlKGN1cnNvciwgY29tcG9uZW50Q2xhc3NlcykpIHJldHVybiBjdXJzb3I7XG4gICAgY3Vyc29yID0gY3Vyc29yLnBhcmVudCA9PT0gdW5kZWZpbmVkID8gdW5kZWZpbmVkIDogYnlVdWlkLmdldChjdXJzb3IucGFyZW50KTtcbiAgfVxuICByZXR1cm4gbm9kZXMuZmluZCgobm9kZSkgPT4gaXNDYW52YXNOb2RlKG5vZGUsIGNvbXBvbmVudENsYXNzZXMpKTtcbn1cblxuZnVuY3Rpb24gaXNDYW52YXNOb2RlKG5vZGU6IFNjZW5lTm9kZVRyZWUsIGNvbXBvbmVudENsYXNzZXM6IHJlYWRvbmx5IFNjZW5lQ29tcG9uZW50Q2xhc3NJbmZvW10pOiBib29sZWFuIHtcbiAgcmV0dXJuIGlzUHJvdG90eXBlU2NlbmVOb2RlTmFtZShub2RlLm5hbWUsICdjYW52YXMnKVxuICAgIHx8IChub2RlLmNvbXBvbmVudHMgPz8gW10pLnNvbWUoKGNvbXBvbmVudCkgPT4gY29tcG9uZW50VHlwZU1hdGNoZXMoY29tcG9uZW50LCAnQ2FudmFzJywgY29tcG9uZW50Q2xhc3NlcykpO1xufVxuXG5mdW5jdGlvbiBmbGF0dGVuVHJlZSh0cmVlOiBTY2VuZU5vZGVUcmVlKTogU2NlbmVOb2RlVHJlZVtdIHtcbiAgY29uc3QgcmVzdWx0OiBTY2VuZU5vZGVUcmVlW10gPSBbXTtcbiAgY29uc3QgdmlzaXQgPSAobm9kZTogU2NlbmVOb2RlVHJlZSwgcGFyZW50VXVpZD86IHN0cmluZyk6IHZvaWQgPT4ge1xuICAgIHJlc3VsdC5wdXNoKHBhcmVudFV1aWQgPT09IHVuZGVmaW5lZCB8fCBub2RlLnBhcmVudCAhPT0gdW5kZWZpbmVkID8gbm9kZSA6IHsgLi4ubm9kZSwgcGFyZW50OiBwYXJlbnRVdWlkIH0pO1xuICAgIGZvciAoY29uc3QgY2hpbGQgb2Ygbm9kZS5jaGlsZHJlbiA/PyBbXSkgdmlzaXQoY2hpbGQsIG5vZGUudXVpZCk7XG4gIH07XG4gIHZpc2l0KHRyZWUpO1xuICByZXR1cm4gcmVzdWx0O1xufVxuXG5mdW5jdGlvbiBmaW5kTm9kZSh0cmVlOiBTY2VuZU5vZGVUcmVlLCB1dWlkOiBzdHJpbmcpOiBTY2VuZU5vZGVUcmVlIHwgbnVsbCB7XG4gIHJldHVybiBmbGF0dGVuVHJlZSh0cmVlKS5maW5kKChub2RlKSA9PiBub2RlLnV1aWQgPT09IHV1aWQpID8/IG51bGw7XG59XG5cbmZ1bmN0aW9uIGZpbmRDb21wb25lbnRJbk5vZGUoXG4gIG5vZGU6IFNjZW5lTm9kZVRyZWUsXG4gIHR5cGU6IHN0cmluZyxcbiAgY29tcG9uZW50Q2xhc3NlczogcmVhZG9ubHkgU2NlbmVDb21wb25lbnRDbGFzc0luZm9bXSxcbik6IFNjZW5lQ29tcG9uZW50SW5mbyB8IG51bGwge1xuICBmb3IgKGNvbnN0IFtpbmRleCwgY29tcG9uZW50XSBvZiAobm9kZS5jb21wb25lbnRzID8/IFtdKS5lbnRyaWVzKCkpIHtcbiAgICBjb25zdCBjYW5kaWRhdGUgPSB7XG4gICAgICAuLi5jb21wb25lbnQsXG4gICAgICBub2RlVXVpZDogY29tcG9uZW50Lm5vZGVVdWlkID8/IG5vZGUudXVpZCxcbiAgICAgIGluZGV4OiBjb21wb25lbnQuaW5kZXggPz8gaW5kZXgsXG4gICAgfTtcbiAgICBpZiAoY29tcG9uZW50VHlwZU1hdGNoZXMoY2FuZGlkYXRlLCB0eXBlLCBjb21wb25lbnRDbGFzc2VzKSkgcmV0dXJuIGNhbmRpZGF0ZTtcbiAgfVxuICByZXR1cm4gbnVsbDtcbn1cblxuYXN5bmMgZnVuY3Rpb24gY29sbGVjdFJvb21JbnN0YW5jZUlkcyhcbiAgc2NlbmU6IFNjZW5lUXVlcnlQb3J0LFxuICB0cmVlOiBTY2VuZU5vZGVUcmVlLFxuICBjb21wb25lbnRDbGFzc2VzOiByZWFkb25seSBTY2VuZUNvbXBvbmVudENsYXNzSW5mb1tdLFxuKTogUHJvbWlzZTxzdHJpbmdbXT4ge1xuICBjb25zdCByZXN1bHQ6IHN0cmluZ1tdID0gW107XG4gIGZvciAoY29uc3Qgbm9kZSBvZiBmbGF0dGVuVHJlZSh0cmVlKSkge1xuICAgIGZvciAoY29uc3QgY29tcG9uZW50IG9mIG5vZGUuY29tcG9uZW50cyA/PyBbXSkge1xuICAgICAgaWYgKCFjb21wb25lbnRUeXBlTWF0Y2hlcyhjb21wb25lbnQsICdSb29tVmlldycsIGNvbXBvbmVudENsYXNzZXMpKSBjb250aW51ZTtcbiAgICAgIGNvbnN0IGNvbXBvbmVudFV1aWQgPSBnZXRTY2VuZUNvbXBvbmVudFV1aWQoY29tcG9uZW50KTtcbiAgICAgIGlmIChjb21wb25lbnRVdWlkID09PSB1bmRlZmluZWQpIGNvbnRpbnVlO1xuICAgICAgdHJ5IHtcbiAgICAgICAgY29uc3QgcXVlcmllZCA9IGF3YWl0IHNjZW5lLnF1ZXJ5Q29tcG9uZW50KGNvbXBvbmVudFV1aWQpO1xuICAgICAgICBjb25zdCBpZCA9IHJlYWRTdHJpbmdQcm9wZXJ0eShxdWVyaWVkPy52YWx1ZT8ucm9vbUluc3RhbmNlSWQpO1xuICAgICAgICBpZiAoaWQgIT09IHVuZGVmaW5lZCkgcmVzdWx0LnB1c2goaWQpO1xuICAgICAgfSBjYXRjaCB7XG4gICAgICAgIC8vIOaXpyBQcmVmYWIg55qE5Y2V57uE5Lu25p+l6K+i5aSx6LSl5LiN5bqU6Zi75pat5Yib5bu677yM5pyA57uI5ZSv5LiA5oCn5LuN55Sx6L+Q6KGM5pe25qCh6aqM44CCXG4gICAgICB9XG4gICAgfVxuICB9XG4gIHJldHVybiByZXN1bHQ7XG59XG5cbmZ1bmN0aW9uIHJlYWRTdHJpbmdQcm9wZXJ0eSh2YWx1ZTogdW5rbm93bik6IHN0cmluZyB8IHVuZGVmaW5lZCB7XG4gIGlmICh0eXBlb2YgdmFsdWUgPT09ICdzdHJpbmcnICYmIHZhbHVlLmxlbmd0aCA+IDApIHJldHVybiB2YWx1ZTtcbiAgaWYgKHR5cGVvZiB2YWx1ZSAhPT0gJ29iamVjdCcgfHwgdmFsdWUgPT09IG51bGwpIHJldHVybiB1bmRlZmluZWQ7XG4gIGNvbnN0IG5lc3RlZCA9ICh2YWx1ZSBhcyB7IHZhbHVlPzogdW5rbm93biB9KS52YWx1ZTtcbiAgcmV0dXJuIHR5cGVvZiBuZXN0ZWQgPT09ICdzdHJpbmcnICYmIG5lc3RlZC5sZW5ndGggPiAwID8gbmVzdGVkIDogdW5kZWZpbmVkO1xufVxuXG5mdW5jdGlvbiBzZWxlY3ROb2RlKHV1aWQ6IHN0cmluZyk6IHZvaWQge1xuICBjb25zdCBzZWxlY3Rpb24gPSAoZ2xvYmFsVGhpcyBhcyB7IEVkaXRvcj86IHsgU2VsZWN0aW9uPzogeyBzZWxlY3Q/OiAodHlwZTogc3RyaW5nLCB1dWlkOiBzdHJpbmcpID0+IHZvaWQgfSB9IH0pLkVkaXRvcj8uU2VsZWN0aW9uO1xuICBzZWxlY3Rpb24/LnNlbGVjdD8uKCdub2RlJywgdXVpZCk7XG59XG5cbmFzeW5jIGZ1bmN0aW9uIGZvY3VzTm9kZSh1dWlkOiBzdHJpbmcpOiBQcm9taXNlPHZvaWQ+IHtcbiAgYXdhaXQgKGdsb2JhbFRoaXMgYXMgeyBFZGl0b3I/OiB7IE1lc3NhZ2U/OiB7IHJlcXVlc3Q/OiAoLi4uYXJnczogdW5rbm93bltdKSA9PiBQcm9taXNlPHVua25vd24+IH0gfSB9KS5FZGl0b3I/Lk1lc3NhZ2U/LnJlcXVlc3Q/LihcbiAgICAnc2NlbmUnLFxuICAgICdmb2N1cy1jYW1lcmEnLFxuICAgIFt1dWlkXSxcbiAgKTtcbn1cblxuZnVuY3Rpb24gdG9NZXNzYWdlKHZhbHVlOiB1bmtub3duKTogc3RyaW5nIHtcbiAgcmV0dXJuIHZhbHVlIGluc3RhbmNlb2YgRXJyb3IgPyB2YWx1ZS5tZXNzYWdlIDogU3RyaW5nKHZhbHVlKTtcbn1cbiJdfQ==