import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('地板完整占满单格并保留一像素内边界', () => {
  const source = readFileSync('assets/scripts/presentation/FloorView.ts', 'utf8');
  assert.match(source, /transform\.setContentSize\(cellSize, cellSize\)/);
  assert.match(source, /const inset = 1/);
  assert.match(source, /graphics\.rect\(-cellSize \/ 2 \+ inset, -cellSize \/ 2 \+ inset, cellSize - inset \* 2, cellSize - inset \* 2\)/);
  assert.doesNotMatch(source, /cellSize \* 0\.28/);
});

test('ShipView 固定地板、高亮、房间、船员和施工层顺序', () => {
  const source = readFileSync('assets/scripts/presentation/ShipView.ts', 'utf8');
  assert.match(source, /this\.floorRoot = ensureShipLayer\(this\.(?:contentRoot|node), '地板容器'\)/);
  assert.match(source, /this\.interactionRoot = ensureShipLayer\(this\.(?:contentRoot|node), '网格交互高亮层', true\)/);
  assert.match(source, /\[this\.hullAppearanceRoot, this\.gridRoot, this\.floorRoot, this\.interactionRoot, this\.roomRoot, this\.crewRoot, this\.constructionRoot, effectsRoot\]/);
  assert.match(source, /setContentSize\(0, 0\)/);
  assert.match(source, /refreshInteractionCell/);
});

test('船员表现解析所有导航锚点且缺失时中文报错，不再跳到房间中心', () => {
  const crewView = readFileSync('assets/scripts/presentation/CrewView.ts', 'utf8');
  assert.match(crewView, /this\.navigation\?\.getNode\(nodeId\)/);
  assert.match(crewView, /navigationAnchorToParentLocal/);
  assert.match(crewView, /导航节点缺少可视锚点/);
  assert.doesNotMatch(crewView, /getRoomPlacement\(navigationNode\.roomId\)/);
});

test('船员在地板上沿行走而不是埋在地板中心', () => {
  const crewView = readFileSync('assets/scripts/presentation/CrewView.ts', 'utf8');
  const mainScene = readFileSync('assets/scripts/bootstrap/MainSceneBootstrap.ts', 'utf8');
  assert.match(crewView, /FLOOR_FOOT_ANCHOR_OFFSET\s*=\s*0\.5/);
  assert.match(crewView, /视觉占用宽度（格）/);
  assert.match(crewView, /视觉占用高度（格）/);
  assert.match(crewView, /navigationNode\.kind === 'FLOOR' \|\| navigationNode\.kind === 'CONNECTOR_STOP'/);
  assert.match(crewView, /y: anchor\.y \+ FLOOR_FOOT_ANCHOR_OFFSET/);
  assert.match(crewView, /setAnchorPoint\(0\.5, 0\)/);
  assert.match(mainScene, /\[target\.position\.y - 1, target\.position\.y\]/);
  assert.match(mainScene, /navigation\.getNode\(nodeId\)\?\.kind === 'FLOOR'/);
  assert.match(mainScene, /该站立格下方没有已完成地板/);
});

test('空闲船员在房间或地板上沿使用稳定序列闲逛且不写入规则状态', () => {
  const crewView = readFileSync('assets/scripts/presentation/CrewView.ts', 'utf8');
  assert.match(crewView, /startOrKeepIdleWander/);
  assert.match(crewView, /stableVisualUnit\(crewId, cursor/);
  assert.match(crewView, /IDLE_WANDER_MIN_PAUSE_SECONDS\s*=\s*1\.5/);
  assert.match(crewView, /scheduleIdleWanderPause/);
  assert.match(crewView, /getVisualMotionTarget/);
  assert.match(crewView, /resetVisualMotion/);
  assert.match(crewView, /node\.kind === 'FLOOR'/);
  assert.match(crewView, /getFloorIdleWanderRange/);
  assert.match(crewView, /const halfRange = 0\.5 - FLOOR_WANDER_EDGE_INSET_CELLS/);
  assert.match(crewView, /const footY = node\.anchor\.y \+ FLOOR_FOOT_ANCHOR_OFFSET/);
  assert.match(crewView, /visualRoot/);
  assert.doesNotMatch(crewView, /Math\.random/);
  assert.doesNotMatch(crewView, /revision\s*[+]=|PlayerStatePort|localStorage/);
});

test('船员使用随闲逛节点移动的一点五格命中框', () => {
  const crewView = readFileSync('assets/scripts/presentation/CrewView.ts', 'utf8');
  assert.match(crewView, /CREW_HIT_AREA_MIN_CELLS\s*=\s*1\.5/);
  assert.match(crewView, /this\.pointerTargets = \[this\.node\]/);
  assert.match(crewView, /this\.pointerTargets\.push\(this\.visualRoot\)/);
  assert.match(crewView, /for \(const target of this\.pointerTargets\) target\.on\(Node\.EventType\.MOUSE_DOWN/);
  assert.match(crewView, /for \(const target of this\.pointerTargets\) target\.off\(Node\.EventType\.MOUSE_DOWN/);
  assert.match(crewView, /cellSize \* CREW_HIT_AREA_MIN_CELLS/);
  assert.match(crewView, /transform\.setContentSize\(hitWidth, hitHeight\)/);
  assert.match(crewView, /visualTransform\?\.setContentSize\(hitWidth, hitHeight\)/);
});

test('船员状态遥测直接标明普通边、电梯或楼梯', () => {
  const panel = readFileSync('assets/scripts/presentation/CrewStatusPanel.ts', 'utf8');
  const bootstrap = readFileSync('assets/scripts/bootstrap/MainSceneBootstrap.ts', 'utf8');
  assert.match(panel, /edgeLabel: '—' \| '普通' \| '电梯' \| '楼梯'/);
  assert.match(panel, /路径：\$\{telemetry\.edgeLabel\} \$\{telemetry\.edgeUsedTicks\}\/\$\{telemetry\.edgeTotalTicks\} Tick/);
  assert.match(panel, /最近连接器：\$\{this\.lastConnector\.label\} \$\{this\.lastConnector\.totalTicks\} Tick/);
  assert.match(panel, /已完成（\$\{this\.maxObservedPatrolResumeTicks\} Tick）/);
  assert.match(bootstrap, /currentNode\?\.kind === 'CONNECTOR_STOP' && nextNode\?\.kind === 'CONNECTOR_STOP'/);
  assert.match(bootstrap, /connectorKind === 'ELEVATOR' \? '电梯' : connectorKind === 'STAIRS' \? '楼梯' : '普通'/);
});

test('右键不启动镜头平移，世界菜单只通过 Cocos 组件交互', () => {
  const camera = readFileSync('assets/scripts/input/CameraController.ts', 'utf8');
  const interaction = readFileSync('assets/scripts/presentation/WorldInteractionController.ts', 'utf8');
  assert.match(camera, /event\.getButton\(\) === EventMouse\.BUTTON_LEFT/);
  assert.match(interaction, /EventMouse\.BUTTON_RIGHT/);
  assert.doesNotMatch(interaction, /BlockInputEvents/);
  assert.doesNotMatch(interaction, /ensureAuthoringPrefabStructure|refreshMenuGraphics|new Node\(|addComponent\(/);
  assert.match(interaction, /placeMenu/);
  assert.match(interaction, /location\.x - canvasTransform\.contentSize\.width/);
  assert.match(interaction, /menuX = localX \+ halfWidth \+ gap/);
  assert.match(interaction, /menuY = localY - halfHeight - gap/);
  assert.doesNotMatch(interaction, /document\.|window\.|HTMLElement|addEventListener/);
});

test('网格交互使用主相机投影，镜头缩放后拖拽落点不偏移', () => {
  const interaction = readFileSync('assets/scripts/presentation/WorldInteractionController.ts', 'utf8');
  assert.match(interaction, /const camera = this\.binding\?\.camera/);
  assert.match(interaction, /camera\.screenToWorld\(new Vec3\(location\.x, location\.y, 0\), this\.pointerWorld\)/);
  assert.match(interaction, /event\.getLocation\(\)/);
  assert.match(interaction, /Input\.EventType\.MOUSE_MOVE/);
  assert.match(interaction, /handleGlobalBuildMouseMove/);
  assert.doesNotMatch(interaction, /worldPointToGridCell\(this\.pointerWorld\.set\(location\.x, location\.y, 0\)\)/);
  assert.doesNotMatch(interaction, /worldCenterToGridCandidate\(this\.pointerWorld\.set\(location\.x, location\.y, 0\)/);
});

test('左键房间和船员只切换选择，不再直接移动或拖动房间', () => {
  const room = readFileSync('assets/scripts/presentation/RoomView.ts', 'utf8');
  const crew = readFileSync('assets/scripts/presentation/CrewView.ts', 'utf8');
  assert.match(room, /BUTTON_LEFT[\s\S]*this\.handleRoomClick\(this\.placement\.instanceId\)/);
  assert.doesNotMatch(room, /handleRuntimeMouseMove|handleRuntimeMouseUp|runtimeDragOffset/);
  assert.match(crew, /BUTTON_LEFT[\s\S]*this\.selectHandler\(id\)/);
  assert.doesNotMatch(crew, /MOVE_CREW|ISSUE_MOVE_ORDER/);
});

test('右键移动在发送 Command 前显示目标站位占用原因', () => {
  const mainScene = readFileSync('assets/scripts/bootstrap/MainSceneBootstrap.ts', 'utf8');
  assert.match(mainScene, /entry\.currentNodeId === targetNodeId \|\| entry\.targetNodeId === targetNodeId/);
  assert.match(mainScene, /目标站位已被其他船员占用/);
  assert.match(mainScene, /targetOccupied \? '目标站位已被其他船员占用'/);
});

test('拆除动作必须经过确认前置，控制器不直接发送拆除 Command', () => {
  const interaction = readFileSync('assets/scripts/presentation/WorldInteractionController.ts', 'utf8');
  const dialog = readFileSync('assets/scripts/presentation/DemolitionConfirmDialog.ts', 'utf8');
  assert.match(interaction, /'DEMOLISH'/);
  assert.match(interaction, /confirmAction\?/);
  assert.match(interaction, /if \(action\.id === 'DEMOLISH'\)/);
  assert.match(dialog, /class DemolitionConfirmDialog/);
  assert.match(dialog, /public confirm\(\)/);
  assert.match(dialog, /public cancel\(\)/);
  assert.doesNotMatch(interaction, /START_DEMOLITION/);
});
