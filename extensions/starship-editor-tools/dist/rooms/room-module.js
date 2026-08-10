"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.roomEditorToolModule = void 0;
exports.setRoomCatalog = setRoomCatalog;
exports.getRoomCatalog = getRoomCatalog;
exports.createRoomFromSelection = createRoomFromSelection;
const constants_1 = require("../constants");
const room_scene_authoring_1 = require("./room-scene-authoring");
const editor_scene_1 = require("../shared/editor-scene");
let roomCatalog = [];
function resolveTargetDirectory(context) {
    if (context.isDirectory === true &&
        context.readonly !== true &&
        typeof context.url === 'string' &&
        (context.url === constants_1.DEFAULT_PREFAB_DIRECTORY || context.url.startsWith(`${constants_1.DEFAULT_PREFAB_DIRECTORY}/`))) {
        return context.url;
    }
    return constants_1.DEFAULT_PREFAB_DIRECTORY;
}
exports.roomEditorToolModule = {
    id: 'rooms',
    getAssetCreateMenu(context) {
        return [
            {
                label: '新建房间建筑…',
                click() {
                    Editor.Message.send(constants_1.PACKAGE_NAME, 'open-room-create', {
                        targetDirectory: resolveTargetDirectory(context),
                        templateUrl: constants_1.DEFAULT_TEMPLATE_URL,
                    });
                },
            },
        ];
    },
};
function setRoomCatalog(entries) {
    roomCatalog = entries;
}
function getRoomCatalog() {
    return roomCatalog;
}
async function createRoomFromSelection(entry, context) {
    return await (0, room_scene_authoring_1.createRoomInstance)(editor_scene_1.editorSceneQuery, context, entry);
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicm9vbS1tb2R1bGUuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi9zcmMvcm9vbXMvcm9vbS1tb2R1bGUudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7O0FBcUNBLHdDQUVDO0FBRUQsd0NBRUM7QUFFRCwwREFLQztBQWxERCw0Q0FBNEY7QUFHNUYsaUVBQTREO0FBQzVELHlEQUEwRDtBQUUxRCxJQUFJLFdBQVcsR0FBc0MsRUFBRSxDQUFDO0FBRXhELFNBQVMsc0JBQXNCLENBQUMsT0FBeUI7SUFDdkQsSUFDRSxPQUFPLENBQUMsV0FBVyxLQUFLLElBQUk7UUFDNUIsT0FBTyxDQUFDLFFBQVEsS0FBSyxJQUFJO1FBQ3pCLE9BQU8sT0FBTyxDQUFDLEdBQUcsS0FBSyxRQUFRO1FBQy9CLENBQUMsT0FBTyxDQUFDLEdBQUcsS0FBSyxvQ0FBd0IsSUFBSSxPQUFPLENBQUMsR0FBRyxDQUFDLFVBQVUsQ0FBQyxHQUFHLG9DQUF3QixHQUFHLENBQUMsQ0FBQyxFQUNwRyxDQUFDO1FBQ0QsT0FBTyxPQUFPLENBQUMsR0FBRyxDQUFDO0lBQ3JCLENBQUM7SUFDRCxPQUFPLG9DQUF3QixDQUFDO0FBQ2xDLENBQUM7QUFFWSxRQUFBLG9CQUFvQixHQUFxQjtJQUNwRCxFQUFFLEVBQUUsT0FBTztJQUNYLGtCQUFrQixDQUFDLE9BQU87UUFDeEIsT0FBTztZQUNMO2dCQUNFLEtBQUssRUFBRSxTQUFTO2dCQUNoQixLQUFLO29CQUNILE1BQU0sQ0FBQyxPQUFPLENBQUMsSUFBSSxDQUFDLHdCQUFZLEVBQUUsa0JBQWtCLEVBQUU7d0JBQ3BELGVBQWUsRUFBRSxzQkFBc0IsQ0FBQyxPQUFPLENBQUM7d0JBQ2hELFdBQVcsRUFBRSxnQ0FBb0I7cUJBQ2xDLENBQUMsQ0FBQztnQkFDTCxDQUFDO2FBQ0Y7U0FDRixDQUFDO0lBQ0osQ0FBQztDQUNGLENBQUM7QUFFRixTQUFnQixjQUFjLENBQUMsT0FBMEM7SUFDdkUsV0FBVyxHQUFHLE9BQU8sQ0FBQztBQUN4QixDQUFDO0FBRUQsU0FBZ0IsY0FBYztJQUM1QixPQUFPLFdBQVcsQ0FBQztBQUNyQixDQUFDO0FBRU0sS0FBSyxVQUFVLHVCQUF1QixDQUMzQyxLQUE2QixFQUM3QixPQUE4QjtJQUU5QixPQUFPLE1BQU0sSUFBQSx5Q0FBa0IsRUFBQywrQkFBZ0IsRUFBRSxPQUFPLEVBQUUsS0FBSyxDQUFDLENBQUM7QUFDcEUsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IERFRkFVTFRfUFJFRkFCX0RJUkVDVE9SWSwgREVGQVVMVF9URU1QTEFURV9VUkwsIFBBQ0tBR0VfTkFNRSB9IGZyb20gJy4uL2NvbnN0YW50cyc7XG5pbXBvcnQgdHlwZSB7IEFzc2V0TWVudUNvbnRleHQsIEVkaXRvclRvb2xNb2R1bGUsIFNjZW5lU2VsZWN0aW9uQ29udGV4dCB9IGZyb20gJy4uL2NvbnRyYWN0cyc7XG5pbXBvcnQgdHlwZSB7IFJvb21QcmVmYWJDYXRhbG9nRW50cnkgfSBmcm9tICcuL2Rpc2NvdmVyLXJvb20tcHJlZmFicyc7XG5pbXBvcnQgeyBjcmVhdGVSb29tSW5zdGFuY2UgfSBmcm9tICcuL3Jvb20tc2NlbmUtYXV0aG9yaW5nJztcbmltcG9ydCB7IGVkaXRvclNjZW5lUXVlcnkgfSBmcm9tICcuLi9zaGFyZWQvZWRpdG9yLXNjZW5lJztcblxubGV0IHJvb21DYXRhbG9nOiByZWFkb25seSBSb29tUHJlZmFiQ2F0YWxvZ0VudHJ5W10gPSBbXTtcblxuZnVuY3Rpb24gcmVzb2x2ZVRhcmdldERpcmVjdG9yeShjb250ZXh0OiBBc3NldE1lbnVDb250ZXh0KTogc3RyaW5nIHtcbiAgaWYgKFxuICAgIGNvbnRleHQuaXNEaXJlY3RvcnkgPT09IHRydWUgJiZcbiAgICBjb250ZXh0LnJlYWRvbmx5ICE9PSB0cnVlICYmXG4gICAgdHlwZW9mIGNvbnRleHQudXJsID09PSAnc3RyaW5nJyAmJlxuICAgIChjb250ZXh0LnVybCA9PT0gREVGQVVMVF9QUkVGQUJfRElSRUNUT1JZIHx8IGNvbnRleHQudXJsLnN0YXJ0c1dpdGgoYCR7REVGQVVMVF9QUkVGQUJfRElSRUNUT1JZfS9gKSlcbiAgKSB7XG4gICAgcmV0dXJuIGNvbnRleHQudXJsO1xuICB9XG4gIHJldHVybiBERUZBVUxUX1BSRUZBQl9ESVJFQ1RPUlk7XG59XG5cbmV4cG9ydCBjb25zdCByb29tRWRpdG9yVG9vbE1vZHVsZTogRWRpdG9yVG9vbE1vZHVsZSA9IHtcbiAgaWQ6ICdyb29tcycsXG4gIGdldEFzc2V0Q3JlYXRlTWVudShjb250ZXh0KSB7XG4gICAgcmV0dXJuIFtcbiAgICAgIHtcbiAgICAgICAgbGFiZWw6ICfmlrDlu7rmiL/pl7Tlu7rnrZHigKYnLFxuICAgICAgICBjbGljaygpIHtcbiAgICAgICAgICBFZGl0b3IuTWVzc2FnZS5zZW5kKFBBQ0tBR0VfTkFNRSwgJ29wZW4tcm9vbS1jcmVhdGUnLCB7XG4gICAgICAgICAgICB0YXJnZXREaXJlY3Rvcnk6IHJlc29sdmVUYXJnZXREaXJlY3RvcnkoY29udGV4dCksXG4gICAgICAgICAgICB0ZW1wbGF0ZVVybDogREVGQVVMVF9URU1QTEFURV9VUkwsXG4gICAgICAgICAgfSk7XG4gICAgICAgIH0sXG4gICAgICB9LFxuICAgIF07XG4gIH0sXG59O1xuXG5leHBvcnQgZnVuY3Rpb24gc2V0Um9vbUNhdGFsb2coZW50cmllczogcmVhZG9ubHkgUm9vbVByZWZhYkNhdGFsb2dFbnRyeVtdKTogdm9pZCB7XG4gIHJvb21DYXRhbG9nID0gZW50cmllcztcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGdldFJvb21DYXRhbG9nKCk6IHJlYWRvbmx5IFJvb21QcmVmYWJDYXRhbG9nRW50cnlbXSB7XG4gIHJldHVybiByb29tQ2F0YWxvZztcbn1cblxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIGNyZWF0ZVJvb21Gcm9tU2VsZWN0aW9uKFxuICBlbnRyeTogUm9vbVByZWZhYkNhdGFsb2dFbnRyeSxcbiAgY29udGV4dDogU2NlbmVTZWxlY3Rpb25Db250ZXh0LFxuKSB7XG4gIHJldHVybiBhd2FpdCBjcmVhdGVSb29tSW5zdGFuY2UoZWRpdG9yU2NlbmVRdWVyeSwgY29udGV4dCwgZW50cnkpO1xufVxuIl19