import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const runtimeFiles = [
  'assets/scripts/bootstrap/configureGameDisplay.ts',
  'assets/scripts/bootstrap/BootSceneBootstrap.ts',
  'assets/scripts/bootstrap/MainSceneBootstrap.ts',
  'assets/scripts/bootstrap/BattleSceneBootstrap.ts',
  'assets/scripts/presentation/UIRootController.ts',
  'assets/scripts/presentation/MainPageRouter.ts',
  'assets/scripts/presentation/PowerPanel.ts',
  'assets/scripts/presentation/CrewStatusPanel.ts',
];

test('场景与界面源码不直接访问存储，也不保留 Prototype 运行时兜底', () => {
  for (const file of runtimeFiles) {
    const source = readFileSync(file, 'utf8');
    assert.equal(/localStorage|sessionStorage/.test(source), false, `${file} 不得直接访问浏览器存储`);
    assert.equal(/createRuntimeFallback|ensureRuntimeConsumer|Prototype/.test(source), false, `${file} 不得保留 Prototype 兜底`);
  }
});

test('Main 与 Battle 都通过持久引用绑定共享界面组件', () => {
  const main = readFileSync('assets/scripts/bootstrap/MainSceneBootstrap.ts', 'utf8');
  const battle = readFileSync('assets/scripts/bootstrap/BattleSceneBootstrap.ts', 'utf8');
  assert.match(main, /type: PowerPanel/);
  assert.match(main, /type: CrewStatusPanel/);
  assert.match(main, /LocalPlayerStatePort/);
  assert.match(battle, /type: BattleHUD/);
  assert.doesNotMatch(battle, /getComponentsInChildren\(RoomView\)/);
});

test('共享 UIRoot 提供主页面切换和 Battle 往返入口', () => {
  const router = readFileSync('assets/scripts/presentation/MainPageRouter.ts', 'utf8');
  const battleHud = readFileSync('assets/scripts/presentation/BattleHUD.ts', 'utf8');
  assert.match(router, /进入战斗按钮/);
  assert.match(router, /director\.loadScene\('BattleScene'/);
  assert.match(battleHud, /返回主场景按钮/);
  assert.match(battleHud, /director\.loadScene\('MainScene'/);
  assert.match(readFileSync('assets/scripts/bootstrap/MainSceneBootstrap.ts', 'utf8'), /director\.preloadScene\('BattleScene'/);
});

test('镜头和主页面路由精确管理全局与页面输入监听', () => {
  const camera = readFileSync('assets/scripts/input/CameraController.ts', 'utf8');
  assert.match(camera, /input\.on\(Input\.EventType\.MOUSE_UP, this\.onMouseUp, this\)/);
  assert.match(camera, /input\.off\(Input\.EventType\.MOUSE_UP, this\.onMouseUp, this\)/);

  const router = readFileSync('assets/scripts/presentation/MainPageRouter.ts', 'utf8');
  assert.match(router, /navigationHandlers/);
  assert.match(router, /button\.off\(Node\.EventType\.TOUCH_END, handler, this\)/);
  assert.doesNotMatch(router, /off\(Node\.EventType\.TOUCH_END\);/);
});

test('场景往返时只重新解析持久组件，不动态创建节点或覆盖 UI 布局', () => {
  const mainBootstrap = readFileSync('assets/scripts/bootstrap/MainSceneBootstrap.ts', 'utf8');
  const battleBootstrap = readFileSync('assets/scripts/bootstrap/BattleSceneBootstrap.ts', 'utf8');
  assert.match(mainBootstrap, /resolvePersistedSceneReferences/);
  assert.match(battleBootstrap, /resolvePersistedSceneReferences/);
  assert.doesNotMatch(mainBootstrap, /new Node\(|addComponent\(/);
  assert.doesNotMatch(battleBootstrap, /new Node\(|addComponent\(/);
});

test('船员固定 Tick 只更新一次表现位置并使用 Cocos Tween 插值', () => {
  const crewView = readFileSync('assets/scripts/presentation/CrewView.ts', 'utf8');
  assert.doesNotMatch(crewView, /this\.selectHandler = selectHandler;\s*this\.refresh\(state, false\)/);
  assert.match(crewView, /movementTweenSeconds = 0\.1/);
  assert.match(crewView, /tween\(this\.node\)\.to\(this\.movementTweenSeconds/);
});

test('Web Desktop 使用占满视口的 16:9 正式模板', () => {
  const html = readFileSync('build-templates/web-desktop/index.ejs', 'utf8');
  const css = readFileSync('build-templates/web-desktop/style.css', 'utf8');
  const display = readFileSync('assets/scripts/bootstrap/configureGameDisplay.ts', 'utf8');
  assert.match(html, /cc_exact_fit_screen="true"/);
  assert.match(html, /cssUrl %>\?v=5/);
  assert.match(html, /screen-orientation" content="landscape"/);
  assert.doesNotMatch(html, /class="header"|class="footer"/);
  assert.match(css, /#GameDiv[\s\S]*#GameCanvas/);
  assert.match(css, /width:\s*min\(100vw, 177\.7777778vh\)\s*!important/);
  assert.match(css, /height:\s*min\(100vh, 56\.25vw\)\s*!important/);
  assert.doesNotMatch(css, /transform:/);
  assert.match(css, /background:\s*#000/);
  assert.match(css, /overflow:\s*hidden/);
  assert.match(display, /view\.resizeWithBrowserSize\(true\)/);
  assert.match(display, /view\.setDesignResolutionSize\(GAME_DESIGN_WIDTH, GAME_DESIGN_HEIGHT, ResolutionPolicy\.SHOW_ALL\)/);
  assert.match(display, /if \(isConfigured\)/);
  for (const bootstrapFile of runtimeFiles.slice(1, 4)) {
    assert.match(readFileSync(bootstrapFile, 'utf8'), /configureGameDisplay\(\)/);
  }
});
