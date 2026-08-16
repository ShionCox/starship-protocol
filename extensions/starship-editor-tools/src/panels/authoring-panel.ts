import {
  CREW_CATALOG_CHANGE_MESSAGE,
  CSV_CONFIG_CHANGE_MESSAGE,
  AUTHORING_BATCH_START_MESSAGE,
  AUTHORING_BATCH_END_MESSAGE,
  HULL_CATALOG_CHANGE_MESSAGE,
  PACKAGE_NAME,
  PSS_INDEX_CHANGE_MESSAGE,
  ROOM_CATALOG_CHANGE_MESSAGE,
} from '../constants';
import type { AuthoringState } from '../main';
import type { AuthoringSelection } from '../authoring-selection';
import type { EditorRoomCatalogEntry as RoomPrefabCatalogEntry, EditorCrewCatalogEntry as CrewPrefabCatalogEntry, EditorHullCatalogEntry as HullCatalogEntry } from '../csv/editor-catalog';
import {
  connectorPortsToEditorText,
  parseConnectorPortsEditorText,
  toRoomPreviewDto,
  type RoomCsvDraft,
  type RoomCsvRow,
  type ConnectorPortCsvRow,
} from '../rooms/room-csv-authoring';

type PageId = 'scene' | 'hulls' | 'rooms' | 'crew' | 'config' | 'pss' | 'validation';

const CSV_CONFIG_TABLES = [
  'game.csv', 'hulls.csv', 'rooms.csv', 'connector-ports.csv', 'floors.csv', 'crews.csv', 'crew-traits.csv', 'visuals.csv', 'visual-frames.csv', 'editor-prefabs.csv',
] as const;
type CsvConfigTableName = (typeof CSV_CONFIG_TABLES)[number];

type NoticeKind = 'success' | 'log' | 'warn' | 'error';

interface NativeNoticeApi {
  addNotice?: (options: {
    readonly title: string;
    readonly message?: string;
    readonly type?: NoticeKind;
    readonly source?: string;
    readonly timeout?: number;
  }) => number;
  removeNotice?: (id: number) => void;
}

interface NoticeSpec {
  readonly kind: NoticeKind;
  readonly title: string;
  readonly message: string;
  readonly scope?: string;
}

const NOTICE_TIMEOUTS: Readonly<Record<NoticeKind, number>> = {
  success: 3000,
  log: 4000,
  warn: 6000,
  error: 8000,
};

function getNativeNoticeApi(): NativeNoticeApi | undefined {
  const editor = (globalThis as { Editor?: { Task?: NativeNoticeApi } }).Editor;
  return editor?.Task;
}

function summarizeNotice(message: string, limit = 220): string {
  const normalized = message.trim().replace(/\s+/g, ' ');
  if (normalized.length <= limit) return normalized;
  return `${normalized.slice(0, Math.max(0, limit - 1))}…`;
}

const ROOM_CATEGORIES = [
  ['ALL', '全部'],
  ['ENERGY', '能源'],
  ['WEAPON', '武器'],
  ['DEFENSE', '防御'],
  ['MOBILITY', '机动'],
  ['SUPPORT', '支援'],
  ['MOVEMENT', '移动'],
  ['TACTICAL', '战术'],
  ['DRONE', '无人机'],
  ['ECONOMY', '经济'],
  ['SPECIAL', '特殊'],
] as const;

const template = `
<section id="root">
  <header class="topbar">
    <div class="brand-lockup">
      <span class="brand-mark">SP</span>
      <div><h1>创作工具</h1></div>
    </div>
    <div class="top-actions"><span id="sync" class="sync"><i></i>同步中</span><ui-button id="refresh">刷新</ui-button></div>
  </header>
  <div class="workbench">
    <nav class="sidebar" aria-label="创作模块">
      <button id="navScene" class="nav-item active" data-page="scene"><span class="nav-icon">场</span><span>场景</span></button>
      <button id="navHulls" class="nav-item" data-page="hulls"><span class="nav-icon">舰</span><span>船体与飞船</span></button>
      <button id="navRooms" class="nav-item" data-page="rooms"><span class="nav-icon">房</span><span>房间建筑</span></button>
      <button id="navCrew" class="nav-item" data-page="crew"><span class="nav-icon">员</span><span>船员</span></button>
      <button id="navConfig" class="nav-item" data-page="config"><span class="nav-icon">表</span><span>配置表</span></button>
      <button id="navPss" class="nav-item" data-page="pss"><span class="nav-icon">素</span><span>PSS 素材</span></button>
      <div class="nav-divider"></div>
      <button id="navValidation" class="nav-item" data-page="validation"><span class="nav-icon">验</span><span>校验</span><em id="navWarningCount">0</em></button>
    </nav>
    <main class="content">
      <section id="pageScene" class="page">
        <div class="page-heading"><div><h2>场景</h2></div><span id="sceneBadge" class="badge neutral">读取中</span></div>
        <section class="panel-card scene-card">
          <div id="selectionDirtyBanner" class="warning" hidden></div>
          <div class="scene-action-groups scene-action-groups--single">
            <section class="scene-action-group scene-action-group--primary">
              <h3>一键创建 / 更新</h3>
              <p class="muted-note">自动打开目标 Scene，补齐缺失结构并连接最新引用；已有手工布局和有效自定义贴图会保留。</p>
              <div class="actions">
                <ui-button id="createOrUpdateBoot" class="blue primary-action">一键创建/更新启动界面</ui-button>
                <ui-button id="createOrUpdateMain" class="blue primary-action">一键创建/更新主界面</ui-button>
                <ui-button id="createOrUpdateBattle" class="blue primary-action">一键创建/更新战斗界面</ui-button>
              </div>
            </section>
          </div>
        </section>
      </section>

      <section id="pageHulls" class="page" hidden>
        <div class="page-heading"><div><h2>船体与飞船</h2></div><span id="hullCount" class="count">0 个</span></div>
        <section class="panel-card scene-card">
          <div class="list-heading"><span>船体规则</span><ui-button id="newHull">新建定义</ui-button></div>
          <div class="form-grid"><label>稳定标识<input id="hullId" type="text" value="hull-starter"></label><label>中文名称<input id="hullDisplayName" type="text" value="初始护卫舰"></label><label>船体等级<input id="hullLevel" type="number" min="1" step="1" value="1"></label><label>网格宽度<input id="hullGridWidth" type="number" min="1" step="1" value="20"></label><label>网格高度<input id="hullGridHeight" type="number" min="1" step="1" value="10"></label><label>船员上限<input id="hullMaxCrew" type="number" min="0" step="1" value="12"></label><label>房间上限<input id="hullMaxRooms" type="number" min="1" step="1" value="24"></label><label>外观标识<input id="hullVisualId" type="text" value="visual-hull-starter"></label><label class="wide-field">船体格 Mask（V=虚空、B=可建造、W=固定墙；用 / 分隔每一行）<input id="hullCellMask" type="text" value=""></label></div>
          <div class="actions"><ui-button id="createHull" class="blue primary-action">创建船体定义</ui-button><ui-button id="cancelHull">取消草稿</ui-button><ui-button id="saveHull">保存选中船体</ui-button><ui-button id="createShip">在挂载点创建飞船</ui-button></div>
        </section>
        <section class="panel-card asset-list-card"><div class="list-heading"><span>已发现船体</span></div><div id="hullList"></div></section>
      </section>

      <section id="pageRooms" class="page" hidden>
        <div class="page-heading"><div><h2>房间建筑</h2><p class="muted-note">规则来自 rooms.csv；连接器停靠口来自 connector-ports.csv。</p></div><div class="heading-actions"><ui-button id="newRoom">新建定义</ui-button><span id="roomCount" class="count">0 个</span></div></div>
        <div class="toolbar"><input id="roomSearch" class="search" placeholder="搜索名称或稳定标识" autocomplete="off"><div id="roomCategories" class="category-tabs"></div></div>
        <div class="room-workspace"><section class="panel-card asset-list-card"><div class="list-heading"><span>rooms.csv 房间行</span></div><div id="list"></div></section><aside id="roomInspector" class="panel-card inspector" hidden><div class="inspector-heading"><div><h3 id="editTitle">房间属性</h3></div><span id="editState" class="badge neutral">未修改</span></div><div class="asset-path"><span id="editId">—</span><span id="editPath">rooms.csv</span></div><div id="roomInstanceInfo" class="instance-info" hidden></div><div class="form-grid"><label>中文名称<input id="editDisplayName" type="text"></label><label>房间分类<select id="editCategory"><option value="ENERGY">能源</option><option value="WEAPON">武器</option><option value="DEFENSE">防御</option><option value="MOBILITY">机动</option><option value="SUPPORT">支援</option><option value="MOVEMENT">移动</option><option value="TACTICAL">战术</option><option value="DRONE">无人机</option><option value="ECONOMY">经济</option><option value="SPECIAL">特殊</option></select></label><label>宽度（格）<input id="editWidth" type="number" min="1" step="1"></label><label>高度（格）<input id="editHeight" type="number" min="1" step="1"></label><label>最高等级<input id="editMaxLevel" type="number" min="1" step="1"></label><label>最大耐久<input id="editMaxHp" type="number" min="1" step="1"></label><label>最低能源<input id="editMinPower" type="number" min="0" step="1"></label><label>最高能源<input id="editMaxPower" type="number" min="0" step="1"></label><label>能源产能<input id="editPowerGeneration" type="number" min="0" step="1"></label><label>船员容量<input id="editCrewCapacity" type="number" min="0" step="1"></label><label>每 Tick 治疗量<input id="editHealingHp" type="number" min="0" step="1"></label><label>纵向连接器<select id="editVerticalConnectorKind"><option value="NONE">无</option><option value="ELEVATOR">电梯</option><option value="STAIRS">楼梯</option></select></label><label>视觉标识<input id="editVisualId" type="text"></label><label>金属成本<input id="editMetalCost" type="number" min="0" step="1"></label><label>建造时长（毫秒）<input id="editBuildDurationMs" type="number" min="1" step="1"></label><label>拆除时长（毫秒）<input id="editDemolishDurationMs" type="number" min="1" step="1"></label><label>返还千分比<input id="editRefundPermille" type="number" min="0" max="1000" step="1"></label><label class="wide-field">连接器停靠口（connector-ports.csv，每行 6 列）<textarea id="editConnectorPorts" rows="4" spellcheck="false"></textarea></label></div><div id="roomInstanceEditor" class="instance-editor" hidden><div class="list-heading"><span>场景实例白名单属性</span><span class="muted-note">只写逻辑格和初始耐久</span></div><div class="form-grid"><label>逻辑 X<input id="editInstanceX" type="number" min="0" step="1"></label><label>逻辑 Y<input id="editInstanceY" type="number" min="0" step="1"></label><label>初始耐久（-1 为最大）<input id="editInstanceHp" type="number" min="-1" step="1"></label></div><div class="inspector-actions"><ui-button id="saveRoomInstance" class="blue">保存实例</ui-button><ui-button id="cancelRoomInstance">取消实例修改</ui-button></div></div><div class="inspector-actions"><ui-button id="saveRoom" class="blue primary-action">保存 CSV 行</ui-button><ui-button id="cancelRoom" >取消草稿</ui-button><ui-button id="createSelectedRoom">创建实例</ui-button><ui-button id="openSelectedPrefab">打开预制体</ui-button></div></aside><div id="roomEmpty" class="panel-card empty-state"><h3>选择一个房间 CSV 行</h3></div></div>
      </section>

      <section id="pageCrew" class="page" hidden>
        <div class="page-heading"><div><h2>船员</h2></div><span id="crewCount" class="count">0 个</span></div>
        <section class="panel-card scene-card">
          <div class="list-heading"><span>船员定义直接来自 crews.csv 与 crew-traits.csv</span><ui-button id="newCrew">新建定义</ui-button></div>
        </section>
        <div class="room-workspace crew-workspace"><section class="panel-card asset-list-card"><div class="list-heading"><span>已发现船员</span></div><div id="crewList"></div></section><aside id="crewInspector" class="panel-card inspector" hidden><div class="inspector-heading"><div><h3 id="crewEditTitle">船员属性</h3></div><span id="crewEditState" class="badge neutral">未修改</span></div><div class="asset-path"><span id="crewEditId">—</span><span id="crewEditPath">—</span></div><div id="crewInstanceInfo" class="instance-info" hidden></div><div class="form-grid"><label>命名方式<select id="crewInstanceNameMode"><option value="GENERATED">自动生成代号</option><option value="FIXED">指定名称</option></select></label><label>指定名称<input id="crewInstanceCallSign" type="text" maxlength="16" placeholder="可选，1-16 个字符"></label><label>中文名称<input id="crewEditDisplayName" type="text"></label><label>船员职业<select id="crewEditRole"><option value="ENGINEER">工程师</option><option value="GUNNER">武器操作员</option><option value="MEDIC">医务员</option><option value="SOLDIER">士兵</option></select></label><label>稀有度<input id="crewEditRarity" type="text"></label><label>外观标识<input id="crewEditAppearanceId" type="text"></label><label>词条标识（| 分隔）<input id="crewEditTraitIds" type="text"></label><label>最大生命<input id="crewEditMaxHp" type="number" min="1" step="1"></label><label>每段移动耗时（固定步）<input id="crewEditMoveTicks" type="number" min="1" step="1"></label><label>每 Tick 维修量<input id="crewEditRepairHp" type="number" min="0" step="1"></label></div><div class="inspector-actions"><ui-button id="saveCrew" class="blue primary-action">保存属性</ui-button><ui-button id="cancelCrew">取消草稿</ui-button><ui-button id="createSelectedCrew">创建实例</ui-button><ui-button id="openSelectedCrewPrefab">打开预制体</ui-button></div></aside><div id="crewEmpty" class="panel-card empty-state"><h3>选择一个船员资源</h3></div></div>
      </section>

      <section id="pageConfig" class="page" hidden>
        <div class="page-heading"><div><h2>权威 CSV 配置表</h2><p class="muted-note">此页只读审计；编辑请进入对应领域页面。批量导入前会在内存中校验全部配置表。</p></div><span id="csvState" class="badge neutral">未读取</span></div>
        <section class="panel-card scene-card">
          <div class="toolbar"><select id="csvTableName">${CSV_CONFIG_TABLES.map((name) => `<option value="${name}">${name}</option>`).join('')}</select><ui-button id="csvReload">重新读取</ui-button><ui-button id="csvImport" class="blue">批量导入并校验</ui-button></div>
          <textarea id="csvEditor" class="csv-editor" spellcheck="false" readonly aria-label="CSV 配置审计内容"></textarea>
          <div id="csvStatus" class="instance-info">请选择配置表并读取。</div>
        </section>
      </section>

      <section id="pagePss" class="page" hidden>
        <div class="page-heading"><div><h2>PSS 参考素材</h2><p class="muted-note">只读索引；导入前仍需通过 manifest 校验和版权复核。</p></div><span id="pssCount" class="count">未读取</span></div>
        <section class="panel-card scene-card">
          <div class="toolbar"><input id="pssSearch" class="search" placeholder="搜索名称、来源 ID 或路径" autocomplete="off"><select id="pssKind"><option value="">全部类型</option><option value="room">房间</option><option value="crew">船员</option><option value="ship">船体</option><option value="item">物品</option><option value="missile">导弹</option></select><select id="pssLanguage"><option value="">全部语言</option><option value="CN">中文</option><option value="EN">英文</option><option value="NEUTRAL">无语言</option></select><ui-button id="pssRefresh" class="blue">重建索引</ui-button><ui-button id="pssBindRooms">全新重建房间外观</ui-button><ui-button id="pssBindCrews">全新重建船员外观</ui-button><ui-button id="pssBindHulls">导入并绑定新手船外观</ui-button></div>
          <div id="pssStatus" class="instance-info">尚未读取 PSS 索引</div>
          <div id="pssList" class="validation-list"></div>
          <div class="actions"><ui-button id="pssPrevious">上一页</ui-button><span id="pssPage" class="count">第 1 页</span><ui-button id="pssNext">下一页</ui-button></div>
        </section>
      </section>

      <section id="pageValidation" class="page" hidden>
        <div class="page-heading"><div><h2>校验</h2></div></div>
        <section class="panel-card validation-card"><div id="validationSummary" class="validation-summary">正在读取…</div><div id="validationList" class="validation-list"></div></section>
      </section>
      <div id="status" aria-live="polite" role="status"></div>
    </main>
  </div>
</section>`;

const style = `
:host { display:block; height:100%; min-height:0; overflow:hidden; color:var(--color-normal-contrast-weaker); font:13px/1.45 sans-serif; }
#root { box-sizing:border-box; height:100%; min-height:0; overflow:hidden; background:var(--color-normal-fill); }
.topbar { box-sizing:border-box; height:62px; display:flex; align-items:center; justify-content:space-between; gap:12px; min-width:0; padding:0 16px; border-bottom:1px solid var(--color-normal-border); background:rgba(0,0,0,.12); }
.brand-lockup,.top-actions,.heading-actions,.inspector-heading,.list-heading { display:flex; align-items:center; }
.brand-lockup { min-width:0; flex:1 1 auto; gap:10px; }.brand-lockup > div { min-width:0; }.brand-mark { display:grid; place-items:center; width:29px; height:29px; border-radius:5px; background:#2d9cc8; color:#fff; font-size:10px; font-weight:700; letter-spacing:.06em; }.brand-lockup h1 { margin:0; overflow:hidden; color:var(--color-normal-contrast); font-size:17px; font-weight:600; text-overflow:ellipsis; white-space:nowrap; }.top-actions { flex:0 0 auto; gap:9px; }.sync { display:inline-flex; align-items:center; gap:5px; color:var(--color-normal-contrast-weaker); font-size:11px; }.sync i { width:6px; height:6px; border-radius:50%; background:#6cc5a0; box-shadow:0 0 0 3px rgba(108,197,160,.14); }
.workbench { display:grid; grid-template-columns:122px minmax(0,1fr); height:calc(100% - 62px); min-height:0; }.sidebar { display:flex; flex-direction:column; gap:3px; min-height:0; padding:12px 8px; border-right:1px solid var(--color-normal-border); background:rgba(0,0,0,.1); }.nav-item { display:flex; align-items:center; gap:7px; width:100%; min-width:0; min-height:35px; padding:0 6px; border:0; border-radius:4px; background:transparent; color:var(--color-normal-contrast-weaker); text-align:left; cursor:pointer; }.nav-item:hover { background:rgba(255,255,255,.06); color:var(--color-normal-contrast); }.nav-item.active { background:rgba(45,156,200,.18); color:#83d7f4; }.nav-item > span:not(.nav-icon) { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }.nav-icon { display:grid; flex:0 0 auto; place-items:center; width:21px; height:21px; border:1px solid currentColor; border-radius:4px; font-size:10px; }.nav-item em { margin-left:auto; color:var(--color-normal-contrast-weaker); font-size:10px; font-style:normal; }.nav-divider { height:1px; margin:12px 5px; background:var(--color-normal-border); }
.content { min-width:0; min-height:0; overflow-y:auto; padding:16px; scrollbar-width:thin; }.content::-webkit-scrollbar { width:8px; }.content::-webkit-scrollbar-thumb { border-radius:8px; background:var(--color-normal-fill-emphasis,rgba(255,255,255,.18)); }.page { max-width:1120px; margin:0 auto; }.page-heading { display:flex; flex-wrap:wrap; align-items:flex-start; justify-content:space-between; gap:10px 18px; margin-bottom:18px; }.page-heading > div:first-child { min-width:0; flex:1 1 180px; }.page-heading h2 { margin:2px 0 4px; color:var(--color-normal-contrast); font-size:22px; font-weight:600; }.heading-actions { flex:0 1 auto; flex-wrap:wrap; gap:8px; max-width:100%; }.panel-card { border:1px solid var(--color-normal-border); border-radius:6px; background:var(--color-normal-fill-emphasis,rgba(255,255,255,.025)); }.scene-card,.validation-card { padding:16px; }.info-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(min(100%,180px),1fr)); gap:10px; }.info-item { min-width:0; padding:12px; border-radius:4px; background:rgba(0,0,0,.14); }.label { display:block; margin-bottom:5px; color:var(--color-normal-contrast-weaker); font-size:11px; }.value { display:block; overflow:hidden; color:var(--color-normal-contrast); text-overflow:ellipsis; white-space:nowrap; }.value.muted { color:var(--color-normal-contrast-weaker); }.actions,.inspector-actions { display:flex; flex-wrap:wrap; gap:8px; margin-top:15px; }.primary-action { min-width:138px; }
.badge,.count { flex:0 0 auto; border-radius:999px; font-size:11px; white-space:nowrap; }.badge { padding:4px 8px; border:1px solid var(--color-normal-border); }.badge.ok { color:#8fe0b1; border-color:rgba(105,202,153,.4); background:rgba(105,202,153,.1); }.badge.warn { color:#f0cd78; border-color:rgba(240,205,120,.35); background:rgba(240,205,120,.08); }.badge.neutral,.count { color:var(--color-normal-contrast-weaker); }.toolbar { display:flex; flex-wrap:wrap; align-items:center; justify-content:space-between; gap:8px 12px; margin-bottom:12px; }.search { box-sizing:border-box; width:min(310px,100%); min-width:0; flex:1 1 180px; height:30px; padding:5px 9px; color:var(--color-normal-contrast); background:var(--color-normal-fill); border:1px solid var(--color-normal-border); border-radius:4px; outline:none; }.search:focus,input:focus,select:focus { border-color:#3ea9d1; }.category-tabs { display:flex; min-width:0; flex:1 1 220px; flex-wrap:wrap; gap:4px; }.category-tab { padding:5px 9px; border:1px solid transparent; border-radius:4px; background:transparent; color:var(--color-normal-contrast-weaker); cursor:pointer; }.category-tab:hover { background:rgba(255,255,255,.06); color:var(--color-normal-contrast); }.category-tab.active { border-color:rgba(59,169,210,.45); background:rgba(45,156,200,.16); color:#8bdaf3; }.room-workspace { display:grid; grid-template-columns:repeat(auto-fit,minmax(min(100%,300px),1fr)); gap:12px; align-items:start; }.asset-list-card { min-width:0; min-height:310px; padding:12px 14px; }.list-heading { justify-content:space-between; padding-bottom:10px; color:var(--color-normal-contrast); font-weight:600; }.room { display:flex; flex-wrap:wrap; align-items:center; justify-content:space-between; gap:8px 10px; padding:11px 4px; border-top:1px solid var(--color-normal-border); cursor:pointer; }.room:hover,.room.selected { background:rgba(255,255,255,.04); }.room.selected { box-shadow:inset 2px 0 #39a9d1; }.room-main { min-width:0; flex:1 1 120px; }.room-name { display:block; overflow:hidden; color:var(--color-normal-contrast); font-weight:600; text-overflow:ellipsis; white-space:nowrap; }.room-meta { display:flex; flex-wrap:wrap; gap:7px; margin-top:3px; color:var(--color-normal-contrast-weaker); font-size:11px; }.room-category { color:#8eb9e8; }.room-id { overflow:hidden; max-width:160px; text-overflow:ellipsis; white-space:nowrap; }.room-actions { display:flex; flex:0 0 auto; gap:5px; }.room ui-button { min-width:54px; }.inspector { min-width:0; padding:15px; }.inspector-heading { justify-content:space-between; align-items:flex-start; }.inspector-heading h3 { margin:2px 0 0; color:var(--color-normal-contrast); font-size:16px; }.asset-path { display:flex; flex-direction:column; gap:2px; min-width:0; margin:13px 0; padding:8px 9px; border-radius:4px; background:rgba(0,0,0,.14); }.asset-path span:first-child { color:#8bdaf3; font-weight:600; }.asset-path span:last-child { overflow:hidden; color:var(--color-normal-contrast-weaker); font-size:10px; text-overflow:ellipsis; white-space:nowrap; }.form-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(min(100%,160px),1fr)); gap:10px; }.form-grid label { display:flex; min-width:0; flex-direction:column; gap:5px; color:var(--color-normal-contrast-weaker); font-size:11px; }.form-grid input,.form-grid select { box-sizing:border-box; width:100%; height:29px; padding:4px 7px; color:var(--color-normal-contrast); background:var(--color-normal-fill); border:1px solid var(--color-normal-border); border-radius:3px; }.empty-state { display:flex; flex-direction:column; align-items:center; justify-content:center; min-height:250px; padding:25px; text-align:center; }.empty-state h3 { margin:10px 0 5px; color:var(--color-normal-contrast); font-size:16px; }.validation-summary { color:var(--color-normal-contrast); font-weight:600; }.validation-list { margin-top:12px; }.validation-item { padding:9px 10px; border-top:1px solid var(--color-normal-border); color:#f0cd78; font-size:12px; white-space:pre-wrap; }.validation-ok { color:#8fe0b1; }.warning { margin-top:10px; padding:9px 10px; border-left:2px solid #e8c46a; background:rgba(232,196,106,.08); color:#e8c46a; white-space:pre-wrap; }.empty { padding:28px 5px; color:var(--color-normal-contrast-weaker); text-align:center; }.hidden { display:none !important; }#status { display:none; margin-top:12px; padding:9px 10px; border-radius:4px; white-space:pre-wrap; }.content > #status.visible { display:block; }.content > #status.info { color:var(--color-normal-contrast-weaker); background:rgba(255,255,255,.05); }.content > #status.warn { color:#f0cd78; background:rgba(240,205,120,.1); }.content > #status.error { color:#ff9696; background:rgba(255,110,110,.1); }
.inspector { padding:12px; }
.inspector-heading h3 { font-size:15px; }
.asset-path { margin:9px 0 10px; padding:7px 8px; }
.form-grid { grid-template-columns:repeat(2,minmax(0,1fr)); gap:7px 8px; }
.form-grid label { gap:3px; }
.form-grid input,.form-grid select { height:28px; padding:3px 7px; }
.wide-field { grid-column:1 / -1; }
.inspector-actions { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:6px; margin-top:11px; }
.inspector-actions ui-button,.inspector-actions .primary-action { box-sizing:border-box; width:100%; min-width:0; }
.scene-inspector { margin-top:14px; padding-top:12px; border-top:1px solid var(--color-normal-border); }
.scene-inspector h3 { margin:0; color:var(--color-normal-contrast); font-size:15px; }
.scene-inspector .asset-path { margin:8px 0 10px; }
.scene-core-form { margin-top:10px; }
.scene-core-form .form-grid { grid-template-columns:repeat(2,minmax(0,1fr)); }
.check-field { align-items:flex-start; }
.check-field input { width:18px; height:18px; margin:5px 0 0; }
.instance-info { margin-top:9px; padding:8px; border-radius:4px; background:rgba(0,0,0,.14); color:var(--color-normal-contrast-weaker); font-size:11px; white-space:pre-wrap; }
.instance-info { border-left:2px solid #3ea9d1; }
.csv-editor { box-sizing:border-box; width:100%; min-height:420px; resize:vertical; padding:10px; border:1px solid var(--color-normal-border); border-radius:4px; outline:none; color:var(--color-normal-contrast); background:rgba(0,0,0,.2); font:12px/1.5 Consolas,"Microsoft YaHei Mono",monospace; tab-size:2; white-space:pre; }
.csv-editor:focus { border-color:#3ea9d1; }
.scene-actions { grid-template-columns:minmax(150px,220px); }
@media (max-width:760px) { .workbench { grid-template-columns:62px minmax(0,1fr); }.sidebar { padding:12px 8px; }.nav-item > span:not(.nav-icon),.nav-item em { display:none; }.nav-item { justify-content:center; padding:0; }.content { padding:12px; }.inspector { order:-1; } }
@media (max-width:520px) { .heading-actions { width:100%; }.topbar { padding:0 12px; }.sync { font-size:0; }.sync i { margin-right:2px; } }
/* 统一场景操作组和窄停靠宽度，保证 420px 仍可完成主要操作。 */
.actions > select,.actions > ui-button { min-width:0; flex:1 1 150px; }
.scene-action-groups { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:10px; margin-top:15px; }
.scene-action-groups--single { grid-template-columns:1fr; }
.scene-action-group { min-width:0; padding:11px; border:1px solid var(--color-normal-border); border-radius:5px; background:rgba(0,0,0,.08); }
.scene-action-group h3 { margin:0; color:var(--color-normal-contrast); font-size:12px; font-weight:600; }
.scene-action-group .actions { margin-top:9px; }
@media (max-width:760px) { .scene-action-groups { grid-template-columns:1fr; }.scene-action-group .actions { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); }.scene-action-group .actions > select,.scene-action-group .actions > ui-button { width:100%; }.form-grid { grid-template-columns:1fr; }.wide-field { grid-column:auto; } }
@media (max-width:520px) { .scene-action-group .actions,.inspector-actions { display:grid; grid-template-columns:1fr; }.scene-action-group .actions > select,.scene-action-group .actions > ui-button,.inspector-actions ui-button { grid-column:1 / -1; width:100%; } }
@media (max-width:420px) { .content { padding:8px; }.scene-card,.validation-card { padding:10px; }.toolbar,.actions { align-items:stretch; }.toolbar > *, .actions > *, .heading-actions > * { width:100%; min-width:0; flex-basis:100%; }.form-grid input,.form-grid select,.form-grid textarea { font-size:12px; } }
`;

let stopPolling: (() => void) | undefined;
let startPolling: (() => void) | undefined;
let stopDraftTimers: (() => void) | undefined;
let stopCatalogListening: (() => void) | undefined;

module.exports = Editor.Panel.define({
  template,
  style,
  $: {
    sceneBadge: '#sceneBadge', roomCount: '#roomCount',
     navWarningCount: '#navWarningCount', sync: '#sync', createOrUpdateBoot: '#createOrUpdateBoot', createOrUpdateMain: '#createOrUpdateMain', createOrUpdateBattle: '#createOrUpdateBattle',
    refresh: '#refresh', list: '#list', status: '#status', roomSearch: '#roomSearch', roomCategories: '#roomCategories',
    roomInspector: '#roomInspector', roomEmpty: '#roomEmpty', roomInstanceInfo: '#roomInstanceInfo', editTitle: '#editTitle', editState: '#editState', editId: '#editId', editPath: '#editPath',
    editDisplayName: '#editDisplayName', editCategory: '#editCategory', editWidth: '#editWidth', editHeight: '#editHeight', editMaxLevel: '#editMaxLevel', newRoom: '#newRoom',
    editMaxHp: '#editMaxHp', editMinPower: '#editMinPower', editMaxPower: '#editMaxPower', editPowerGeneration: '#editPowerGeneration', editCrewCapacity: '#editCrewCapacity', editHealingHp: '#editHealingHp', editVerticalConnectorKind: '#editVerticalConnectorKind', editVisualId: '#editVisualId', editMetalCost: '#editMetalCost', editBuildDurationMs: '#editBuildDurationMs', editDemolishDurationMs: '#editDemolishDurationMs', editRefundPermille: '#editRefundPermille', editConnectorPorts: '#editConnectorPorts', saveRoom: '#saveRoom', cancelRoom: '#cancelRoom',
    roomInstanceEditor: '#roomInstanceEditor', editInstanceX: '#editInstanceX', editInstanceY: '#editInstanceY', editInstanceHp: '#editInstanceHp', saveRoomInstance: '#saveRoomInstance', cancelRoomInstance: '#cancelRoomInstance',
    createSelectedRoom: '#createSelectedRoom', openSelectedPrefab: '#openSelectedPrefab', validationSummary: '#validationSummary', validationList: '#validationList',
    navScene: '#navScene', navHulls: '#navHulls', navRooms: '#navRooms', navCrew: '#navCrew', navConfig: '#navConfig', navPss: '#navPss', navValidation: '#navValidation',
    pageScene: '#pageScene', pageHulls: '#pageHulls', pageRooms: '#pageRooms', pageCrew: '#pageCrew', pageConfig: '#pageConfig', pagePss: '#pagePss', pageValidation: '#pageValidation',
    hullCount: '#hullCount', hullList: '#hullList', hullId: '#hullId', hullDisplayName: '#hullDisplayName', hullLevel: '#hullLevel', hullGridWidth: '#hullGridWidth', hullGridHeight: '#hullGridHeight', hullMaxCrew: '#hullMaxCrew', hullMaxRooms: '#hullMaxRooms', hullVisualId: '#hullVisualId', hullCellMask: '#hullCellMask', newHull: '#newHull', cancelHull: '#cancelHull', createHull: '#createHull', saveHull: '#saveHull', createShip: '#createShip',
    crewCount: '#crewCount', crewList: '#crewList', crewInspector: '#crewInspector', crewEmpty: '#crewEmpty', crewInstanceInfo: '#crewInstanceInfo', crewInstanceNameMode: '#crewInstanceNameMode', crewInstanceCallSign: '#crewInstanceCallSign', crewEditTitle: '#crewEditTitle', crewEditState: '#crewEditState', crewEditId: '#crewEditId', crewEditPath: '#crewEditPath', crewEditDisplayName: '#crewEditDisplayName', crewEditRole: '#crewEditRole', crewEditRarity: '#crewEditRarity', crewEditAppearanceId: '#crewEditAppearanceId', crewEditTraitIds: '#crewEditTraitIds', crewEditMaxHp: '#crewEditMaxHp', crewEditMoveTicks: '#crewEditMoveTicks', crewEditRepairHp: '#crewEditRepairHp', newCrew: '#newCrew', cancelCrew: '#cancelCrew', saveCrew: '#saveCrew', createSelectedCrew: '#createSelectedCrew', openSelectedCrewPrefab: '#openSelectedCrewPrefab',
    selectionDirtyBanner: '#selectionDirtyBanner',
    pssSearch: '#pssSearch', pssKind: '#pssKind', pssLanguage: '#pssLanguage', pssRefresh: '#pssRefresh', pssBindRooms: '#pssBindRooms', pssBindCrews: '#pssBindCrews', pssBindHulls: '#pssBindHulls', pssStatus: '#pssStatus', pssList: '#pssList', pssPrevious: '#pssPrevious', pssNext: '#pssNext', pssPage: '#pssPage', pssCount: '#pssCount',
    csvTableName: '#csvTableName', csvEditor: '#csvEditor', csvReload: '#csvReload', csvImport: '#csvImport', csvStatus: '#csvStatus', csvState: '#csvState',
  },
  listeners: {
    show() { startPolling?.(); },
    hide() { stopPolling?.(); stopDraftTimers?.(); },
  },
  ready() {
    const el = <T extends HTMLElement>(key: string): T => {
      const value = (this.$ as unknown as Record<string, HTMLElement | null>)[key];
      if (value !== undefined && value !== null) return value as T;
      throw new Error(`创作面板缺少必需节点：${key}`);
    };
    const sceneBadge = el<HTMLElement>('sceneBadge');
    const roomCount = el<HTMLElement>('roomCount');
    const navWarningCount = el<HTMLElement>('navWarningCount');
    const sync = el<HTMLElement>('sync');
    const createOrUpdateBoot = el<HTMLElement>('createOrUpdateBoot');
    const createOrUpdateMain = el<HTMLElement>('createOrUpdateMain');
    const createOrUpdateBattle = el<HTMLElement>('createOrUpdateBattle');
    const refresh = el<HTMLElement>('refresh');
    const list = el<HTMLElement>('list');
    const status = el<HTMLElement>('status');
    const roomSearch = el<HTMLInputElement>('roomSearch');
    const roomCategories = el<HTMLElement>('roomCategories');
    const roomInspector = el<HTMLElement>('roomInspector');
    const roomEmpty = el<HTMLElement>('roomEmpty');
    const roomInstanceInfo = el<HTMLElement>('roomInstanceInfo');
    const editState = el<HTMLElement>('editState');
    const editId = el<HTMLElement>('editId');
    const editPath = el<HTMLElement>('editPath');
    const editTitle = el<HTMLElement>('editTitle');
    const saveRoom = el<HTMLElement>('saveRoom');
    const cancelRoom = el<HTMLElement>('cancelRoom');
    const newRoom = el<HTMLElement>('newRoom');
    const createSelectedRoom = el<HTMLElement>('createSelectedRoom');
    const openSelectedPrefab = el<HTMLElement>('openSelectedPrefab');
    const roomInstanceEditor = el<HTMLElement>('roomInstanceEditor');
    const editInstanceX = el<HTMLInputElement>('editInstanceX');
    const editInstanceY = el<HTMLInputElement>('editInstanceY');
    const editInstanceHp = el<HTMLInputElement>('editInstanceHp');
    const editConnectorPorts = el<HTMLTextAreaElement>('editConnectorPorts');
    const saveRoomInstance = el<HTMLElement>('saveRoomInstance');
    const cancelRoomInstance = el<HTMLElement>('cancelRoomInstance');
    const validationSummary = el<HTMLElement>('validationSummary');
    const validationList = el<HTMLElement>('validationList');
    const selectionDirtyBanner = el<HTMLElement>('selectionDirtyBanner');
    const crewCount = el<HTMLElement>('crewCount');
    const hullCount = el<HTMLElement>('hullCount');
    const hullList = el<HTMLElement>('hullList');
    const createHull = el<HTMLElement>('createHull');
    const newHull = el<HTMLElement>('newHull');
    const cancelHull = el<HTMLElement>('cancelHull');
    const saveHull = el<HTMLElement>('saveHull');
    const createShip = el<HTMLElement>('createShip');
    const crewList = el<HTMLElement>('crewList');
    const crewInspector = el<HTMLElement>('crewInspector');
    const crewEmpty = el<HTMLElement>('crewEmpty');
    const crewInstanceInfo = el<HTMLElement>('crewInstanceInfo');
    const crewInstanceNameMode = el<HTMLSelectElement>('crewInstanceNameMode');
    const crewInstanceCallSign = el<HTMLInputElement>('crewInstanceCallSign');
    const crewEditTitle = el<HTMLElement>('crewEditTitle');
    const crewEditState = el<HTMLElement>('crewEditState');
    const crewEditId = el<HTMLElement>('crewEditId');
    const crewEditPath = el<HTMLElement>('crewEditPath');
    const saveCrew = el<HTMLElement>('saveCrew');
    const newCrew = el<HTMLElement>('newCrew');
    const cancelCrew = el<HTMLElement>('cancelCrew');
    const createSelectedCrew = el<HTMLElement>('createSelectedCrew');
    const openSelectedCrewPrefab = el<HTMLElement>('openSelectedCrewPrefab');
    const pssSearch = el<HTMLInputElement>('pssSearch');
    const pssKind = el<HTMLSelectElement>('pssKind');
    const pssLanguage = el<HTMLSelectElement>('pssLanguage');
    const pssRefresh = el<HTMLElement>('pssRefresh');
    const pssBindRooms = el<HTMLElement>('pssBindRooms');
    const pssBindCrews = el<HTMLElement>('pssBindCrews');
    const pssBindHulls = el<HTMLElement>('pssBindHulls');
    const pssStatus = el<HTMLElement>('pssStatus');
    const pssList = el<HTMLElement>('pssList');
    const pssPrevious = el<HTMLElement>('pssPrevious');
    const pssNext = el<HTMLElement>('pssNext');
    const pssPage = el<HTMLElement>('pssPage');
    const pssCount = el<HTMLElement>('pssCount');
    const csvTableName = el<HTMLSelectElement>('csvTableName');
    const csvEditor = el<HTMLTextAreaElement>('csvEditor');
    const csvReload = el<HTMLElement>('csvReload');
    const csvImport = el<HTMLElement>('csvImport');
    const csvStatus = el<HTMLElement>('csvStatus');
    const csvState = el<HTMLElement>('csvState');
    const pages: Record<PageId, HTMLElement> = {
      scene: el('pageScene'), hulls: el('pageHulls'), rooms: el('pageRooms'), crew: el('pageCrew'), config: el('pageConfig'), pss: el('pagePss'), validation: el('pageValidation'),
    };
    const nav: Record<PageId, HTMLElement> = {
      scene: el('navScene'), hulls: el('navHulls'), rooms: el('navRooms'), crew: el('navCrew'), config: el('navConfig'), pss: el('navPss'), validation: el('navValidation'),
    };
    const field = (key: string): HTMLInputElement | HTMLSelectElement => el<HTMLInputElement | HTMLSelectElement>(key);
    let timer: ReturnType<typeof setInterval> | undefined;
    let batchPaused = false;
    let lastSelectionKey = '';
    let refreshStateSequence = 0;
    let state: AuthoringState | undefined;
    let activePage: PageId = 'scene';
    let activeCategory = 'ALL';
    let selectedRoomId = '';
    let roomEntries: readonly RoomPrefabCatalogEntry[] = [];
    let roomDrafts: readonly RoomCsvDraft[] = [];
    let roomDraftBaseline: RoomCsvDraft | undefined;
    const roomDraftSession = createDraftSession();
    let roomDraftLoadSequence = 0;
    let roomDraftLoadPending = false;
    let roomInstanceDirty = false;
    let blockedSelectionUuid = '';
    let blockedSelectionName = '';
    let selectedCrewId = '';
    let crewEntries: readonly CrewPrefabCatalogEntry[] = [];
    let hullEntries: readonly HullCatalogEntry[] = [];
    let selectedHullId = '';
    let crewDraftBaseline: Record<string, string> | undefined;
    let hullDraftBaseline: Record<string, string> | undefined;
    const crewDraftSession = createDraftSession();
    const hullDraftSession = createDraftSession();
    stopDraftTimers = () => {
      invalidateDraftSession(roomDraftSession);
      invalidateDraftSession(crewDraftSession);
      invalidateDraftSession(hullDraftSession);
    };
    let pssPageNumber = 1;
    let csvTables: Readonly<Record<CsvConfigTableName, string>> | undefined;

    const noticeIds = new Map<string, { readonly signature: string; readonly id?: number; readonly timestamp: number }>();
    let inlineDetailScope = 'global';
    let inlineDetailKind: 'info' | 'warn' | 'error' | undefined;

    const clearInlineDetail = (scope?: string): void => {
      if (scope !== undefined && inlineDetailKind !== undefined && inlineDetailKind !== 'info' && inlineDetailScope !== scope) return;
      status.className = '';
      status.textContent = '';
      inlineDetailKind = undefined;
    };

    const setInlineDetail = (message: string, kind: 'info' | 'warn' | 'error', scope = 'global'): void => {
      status.className = `visible ${kind}`;
      status.textContent = message;
      inlineDetailScope = scope;
      inlineDetailKind = kind;
    };

    const reportNotice = ({ kind, title, message, scope = 'global' }: NoticeSpec): void => {
      const fullMessage = message.trim();
      const signature = `${kind}|${title}|${fullMessage}`;
      const now = Date.now();
      const previous = noticeIds.get(scope);
      if (previous?.signature === signature && now - previous.timestamp < 3000) {
        if (kind === 'warn' || kind === 'error') setInlineDetail(fullMessage, kind, scope);
        return;
      }
      if (previous?.id !== undefined) getNativeNoticeApi()?.removeNotice?.(previous.id);
      const api = getNativeNoticeApi();
      const id = api?.addNotice?.({
        title,
        message: summarizeNotice(fullMessage),
        type: kind,
        source: '星舰创作工具',
        timeout: NOTICE_TIMEOUTS[kind],
      });
      noticeIds.set(scope, { signature, id, timestamp: now });
      if (kind === 'warn' || kind === 'error') setInlineDetail(fullMessage, kind, scope);
      else clearInlineDetail(scope);
    };

    const reportResult = (
      scope: string,
      title: string,
      result: { readonly ok: boolean; readonly message: string; readonly cancelled?: boolean },
    ): void => {
      if (result.cancelled === true) {
        clearInlineDetail(scope);
        return;
      }
      reportNotice({ kind: result.ok ? 'success' : 'error', title, message: result.message, scope });
    };

    const dispatchConfirm = (target: HTMLElement): void => {
      const legacy = target as HTMLElement & { readonly listeners?: Record<string, (() => void) | undefined> };
      if (typeof target.dispatchEvent === 'function' && typeof Event === 'function') target.dispatchEvent(new Event('confirm'));
      else legacy.listeners?.confirm?.();
    };

    const renderSelectionBanner = (): void => {
      selectionDirtyBanner.replaceChildren();
      selectionDirtyBanner.hidden = blockedSelectionUuid === '';
      if (blockedSelectionUuid === '') return;
      const text = document.createElement('span');
      text.textContent = `检测到 Creator 选择已变更为“${blockedSelectionName || '新节点'}”，当前草稿尚未保存。`;
      const save = document.createElement('button');
      save.textContent = '保存并切换';
      save.addEventListener('click', () => {
        if (roomDraftSession.dirty) dispatchConfirm(saveRoom);
        else if (crewDraftSession.dirty) dispatchConfirm(saveCrew);
        else if (hullDraftSession.dirty) dispatchConfirm(saveHull);
        else if (roomInstanceDirty) dispatchConfirm(saveRoomInstance);
        else { blockedSelectionUuid = ''; blockedSelectionName = ''; renderSelectionBanner(); void refreshState(true); }
      });
      const discard = document.createElement('button');
      discard.textContent = '放弃并切换';
      discard.addEventListener('click', () => {
        invalidateDraftSession(roomDraftSession);
        invalidateDraftSession(crewDraftSession);
        invalidateDraftSession(hullDraftSession);
        roomInstanceDirty = false;
        blockedSelectionUuid = '';
        blockedSelectionName = '';
        renderSelectionBanner();
        reportNotice({ kind: 'success', title: '已放弃草稿', message: '已放弃未保存草稿，正在切换选择。', scope: 'draft-selection' });
        void refreshState(true);
      });
      selectionDirtyBanner.append(text, save, discard);
    };

    const setPage = (page: PageId): void => {
      if (hasAnyDraftDirty() && page !== activePage && !canLeaveAnyDraft()) return;
      activePage = page;
      for (const [key, button] of Object.entries(nav)) {
        button.className = `nav-item${key === page ? ' active' : ''}`;
        button.setAttribute('aria-current', key === page ? 'page' : 'false');
      }
      for (const [key, section] of Object.entries(pages)) section.hidden = key !== page;
    };

    const hasAnyDraftDirty = (): boolean => roomDraftSession.dirty || roomInstanceDirty || crewDraftSession.dirty || hullDraftSession.dirty;
    const canLeaveAnyDraft = (): boolean => {
      if (!hasAnyDraftDirty()) return true;
      reportNotice({ kind: 'warn', title: '存在未保存修改', message: '当前领域存在未保存修改，请先点击“保存”或“取消”。', scope: 'draft-navigation' });
      return false;
    };

    const renderCategories = (): void => {
      roomCategories.replaceChildren();
      for (const [value, label] of ROOM_CATEGORIES) {
        const button = document.createElement('button');
        button.className = `category-tab${activeCategory === value ? ' active' : ''}`;
        button.textContent = label;
        button.setAttribute('data-category', value);
        button.addEventListener('click', () => { activeCategory = value; renderCategories(); renderRoomList(); });
        roomCategories.append(button);
      }
    };

    const renderValidation = (next: AuthoringState): void => {
      const warnings = next.warnings;
      validationSummary.textContent = warnings.length === 0 ? '当前校验通过，没有资源发现警告' : `${warnings.length} 条需要处理的问题`;
      validationList.replaceChildren();
      if (warnings.length === 0) {
        const ok = document.createElement('div'); ok.className = 'validation-item validation-ok'; ok.textContent = '✓ 房间定义、预制体依赖和场景目录均已读取'; validationList.append(ok);
      } else {
        for (const warning of warnings) { const item = document.createElement('div'); item.className = 'validation-item'; item.textContent = warning; validationList.append(item); }
      }
    };

    const renderPss = async (): Promise<void> => {
      pssStatus.textContent = '正在读取只读 PSS 索引…';
      try {
        const query = {
          query: pssSearch.value.trim() || undefined,
          kind: pssKind.value || undefined,
          language: pssLanguage.value || undefined,
          page: pssPageNumber,
          pageSize: 24,
        };
        const result = await Editor.Message.request(PACKAGE_NAME, 'search-pss-assets', query) as {
          readonly entries: readonly { readonly assetId: string; readonly displayName: string; readonly aliases?: readonly string[]; readonly kind: string; readonly language: string; readonly sourceId: string; readonly sourcePath: string; readonly sourceSprite?: { readonly path?: string } }[];
          readonly page: number; readonly total: number; readonly totalPages: number; readonly hasPrevious: boolean; readonly hasNext: boolean; readonly warnings: readonly string[];
        };
        pssPageNumber = result.page;
        pssCount.textContent = `${result.total} 个结果`;
        pssPage.textContent = `第 ${result.page} / ${Math.max(1, result.totalPages)} 页`;
        setElementDisabled(pssPrevious, !result.hasPrevious);
        setElementDisabled(pssNext, !result.hasNext);
        pssList.replaceChildren();
        if (result.entries.length === 0) {
          const empty = document.createElement('div'); empty.className = 'empty'; empty.textContent = '没有索引结果；请确认 PSS 只读素材库路径可用。'; pssList.append(empty);
        } else {
          for (const entry of result.entries) {
            const item = document.createElement('div'); item.className = 'validation-item';
            const aliases = entry.aliases === undefined || entry.aliases.length === 0 ? '' : `（别名：${entry.aliases.slice(0, 2).join('、')}）`;
            item.textContent = `${entry.displayName}${aliases} · ${entry.kind}/${entry.language} · ${entry.sourceId} · ${entry.sourceSprite?.path ?? entry.sourcePath}`;
            pssList.append(item);
          }
        }
        pssStatus.textContent = result.warnings.length === 0
          ? '索引只读；来源数据不会被插件修改。'
          : `索引可用，但有 ${result.warnings.length} 条来源警告：${result.warnings[0]}`;
      } catch (cause) {
        pssCount.textContent = '读取失败';
        pssList.replaceChildren();
        const message = `无法读取 PSS 索引：${cause instanceof Error ? cause.message : String(cause)}`;
        pssStatus.textContent = message;
        reportNotice({ kind: 'error', title: '读取 PSS 索引失败', message, scope: 'pss-index-load' });
      }
    };

    const renderCsvTable = (): void => {
      const name = csvTableName.value as CsvConfigTableName;
      csvEditor.value = csvTables?.[name] ?? '';
      csvState.textContent = csvTables === undefined ? '未读取' : '已读取';
      csvState.className = `badge ${csvTables === undefined ? 'neutral' : 'ok'}`;
    };

    const loadCsvTables = async (): Promise<void> => {
      csvStatus.textContent = '正在读取全部权威 CSV…';
      try {
        const result = await Editor.Message.request(PACKAGE_NAME, 'get-csv-config-tables') as {
          readonly ok: boolean;
          readonly message: string;
          readonly bundle?: { readonly tables: Readonly<Record<CsvConfigTableName, string>> };
        };
        if (!result.ok || result.bundle === undefined) throw new Error(result.message);
        csvTables = result.bundle.tables;
        renderCsvTable();
        csvStatus.textContent = result.message;
      } catch (cause) {
        csvTables = undefined;
        renderCsvTable();
        const message = `读取配置表失败：${cause instanceof Error ? cause.message : String(cause)}`;
        csvStatus.textContent = message;
        reportNotice({ kind: 'error', title: '读取配置表失败', message, scope: 'csv-config-load' });
      }
    };

    const getRoomDraft = (id = selectedRoomId): RoomCsvDraft | undefined => roomDrafts.find((draft) => draft.id === id);

    const canLeaveRoomDraft = (): boolean => canLeaveAnyDraft();

    const applyRoomDraftToFields = (draft: RoomCsvDraft): void => {
      field('editDisplayName').value = draft.displayName;
      field('editCategory').value = draft.category;
      field('editWidth').value = draft.width;
      field('editHeight').value = draft.height;
      field('editMaxLevel').value = draft.maxLevel;
      field('editMaxHp').value = draft.maxHp;
      field('editMinPower').value = draft.minPower;
      field('editMaxPower').value = draft.maxPower;
      field('editPowerGeneration').value = draft.powerGeneration;
      field('editCrewCapacity').value = draft.crewCapacity;
      field('editHealingHp').value = draft.healingHpPerTick;
      field('editVerticalConnectorKind').value = draft.verticalConnectorKind;
      field('editVisualId').value = draft.visualId;
      field('editMetalCost').value = draft.metalCost;
      field('editBuildDurationMs').value = draft.buildDurationMs;
      field('editDemolishDurationMs').value = draft.demolishDurationMs;
      field('editRefundPermille').value = draft.refundPermille;
      editConnectorPorts.value = connectorPortsToEditorText(draft.connectorPorts);
      invalidateDraftSession(roomDraftSession);
      roomDraftBaseline = draft;
      roomDraftSession.dirty = false;
      editState.textContent = '已加载';
      editState.className = 'badge ok';
    };

    const readRoomDraftFromFields = (): RoomCsvDraft | null => {
      const baseline = roomDraftBaseline ?? getRoomDraft();
      if (baseline === undefined) return null;
      let connectorPorts: readonly ConnectorPortCsvRow[];
      try {
        connectorPorts = parseConnectorPortsEditorText(editConnectorPorts.value, baseline.id);
      } catch (cause) {
        reportNotice({ kind: 'error', title: '房间字段校验失败', message: cause instanceof Error ? cause.message : String(cause), scope: 'room-form' });
        return null;
      }
      return {
        ...baseline,
        displayName: field('editDisplayName').value.trim(),
        category: field('editCategory').value,
        width: field('editWidth').value.trim(),
        height: field('editHeight').value.trim(),
        maxLevel: field('editMaxLevel').value.trim(),
        maxHp: field('editMaxHp').value.trim(),
        minPower: field('editMinPower').value.trim(),
        maxPower: field('editMaxPower').value.trim(),
        powerGeneration: field('editPowerGeneration').value.trim(),
        crewCapacity: field('editCrewCapacity').value.trim(),
        healingHpPerTick: field('editHealingHp').value.trim(),
        verticalConnectorKind: field('editVerticalConnectorKind').value,
        visualId: field('editVisualId').value.trim(),
        metalCost: field('editMetalCost').value.trim(),
        buildDurationMs: field('editBuildDurationMs').value.trim(),
        demolishDurationMs: field('editDemolishDurationMs').value.trim(),
        refundPermille: field('editRefundPermille').value.trim(),
        connectorPorts,
      };
    };

    const renderInspector = (): void => {
      const draft = getRoomDraft();
      const roomSelection = state?.selection.kind === 'room-instance' ? state.selection : undefined;
      if (draft === undefined && roomSelection === undefined) { roomInspector.hidden = true; roomEmpty.hidden = false; roomInstanceEditor.hidden = true; return; }
      roomInspector.hidden = false; roomEmpty.hidden = true;
      editPath.textContent = 'rooms.csv';
      if (draft !== undefined) {
        editState.textContent = roomDraftSession.dirty ? '未保存' : '已加载';
        editState.className = `badge ${roomDraftSession.dirty ? 'warn' : 'ok'}`;
        editTitle.textContent = draft.displayName;
        editId.textContent = draft.id;
        if (!roomDraftSession.dirty && (roomDraftBaseline?.id !== draft.id || JSON.stringify(roomDraftBaseline) !== JSON.stringify(draft))) applyRoomDraftToFields(draft);
      } else {
        editState.textContent = roomSelection?.validation.ok ? '实例已读取' : '实例有问题';
        editState.className = `badge ${roomSelection?.validation.ok ? 'ok' : 'warn'}`;
        editTitle.textContent = roomSelection?.name ?? '房间实例';
        editId.textContent = roomSelection?.definitionId ?? '定义缺失';
        roomDraftBaseline = undefined;
        for (const key of ['editDisplayName', 'editCategory', 'editWidth', 'editHeight', 'editMaxLevel', 'editMaxHp', 'editMinPower', 'editMaxPower', 'editPowerGeneration', 'editCrewCapacity', 'editHealingHp', 'editVerticalConnectorKind', 'editVisualId', 'editMetalCost', 'editBuildDurationMs', 'editDemolishDurationMs', 'editRefundPermille']) field(key).value = '';
        editConnectorPorts.value = '';
      }
      roomInstanceInfo.hidden = roomSelection === undefined;
      roomInstanceInfo.textContent = roomSelection === undefined ? '' : `实例标识：${roomSelection.instanceId ?? '未读取'}\n节点路径：${roomSelection.path ?? '—'}\n逻辑格：${formatGridPosition(roomSelection.gridPosition)}\n初始耐久：${roomSelection.initialHp ?? '未读取'}\n校验：${roomSelection.validation.message}`;
      roomInstanceEditor.hidden = roomSelection === undefined;
      if (roomSelection !== undefined && !roomInstanceDirty) {
        editInstanceX.value = String(roomSelection.gridPosition?.x ?? '');
        editInstanceY.value = String(roomSelection.gridPosition?.y ?? '');
        editInstanceHp.value = String(roomSelection.initialHp ?? -1);
      }
    };

    const renderRoomList = (): void => {
      list.replaceChildren();
      const query = roomSearch.value.trim().toLowerCase();
      const source = roomDrafts;
      const visible = source.filter((draft) => (activeCategory === 'ALL' || draft.category === activeCategory) && (query === '' || draft.displayName.toLowerCase().includes(query) || draft.id.toLowerCase().includes(query)));
      if (visible.length === 0) { const empty = document.createElement('div'); empty.className = 'empty'; empty.textContent = source.length === 0 ? '暂无 rooms.csv 房间行' : '没有符合筛选条件的房间'; list.append(empty); }
      const canCreate = state?.roomTarget.ok === true;
      const createReason = state?.roomTarget.message ?? '正在读取当前场景放置目标';
      for (const draft of visible) {
        const entry = roomEntries.find((item) => item.id === draft.id);
        appendRoomCsvEntry(list, draft, selectedRoomId === draft.id, canCreate && entry !== undefined, entry === undefined ? '缺少对应房间 Prefab' : createReason, () => {
          if (draft.id === selectedRoomId || canLeaveRoomDraft()) {
            if (draft.id !== selectedRoomId) invalidateDraftSession(roomDraftSession);
            selectedRoomId = draft.id;
            roomDraftBaseline = undefined;
            roomInstanceDirty = false;
            renderRoomList();
            renderInspector();
          }
        }, async () => {
          if (entry === undefined) return;
          setInlineDetail(`正在创建 ${draft.displayName}…`, 'info');
          try { const result = await Editor.Message.request(PACKAGE_NAME, 'create-room-instance', entry) as { ok: boolean; message: string }; reportResult('room-instance-create', '房间实例创建结果', result); await refreshState(true); } catch (cause) { reportNotice({ kind: 'error', title: '房间实例创建失败', message: cause instanceof Error ? cause.message : String(cause), scope: 'room-instance-create' }); }
        });
      }
      renderInspector();
    };

    const renderCrewInspector = (): void => {
      const entry = crewEntries.find((item) => item.id === selectedCrewId);
      const draftOnly = entry === undefined && crewDraftBaseline?.id === selectedCrewId ? crewDraftBaseline : undefined;
      const crewSelection = state?.selection.kind === 'crew-instance' ? state.selection : undefined;
      if (entry === undefined && draftOnly === undefined && crewSelection === undefined) { crewInspector.hidden = true; crewEmpty.hidden = false; return; }
      crewInspector.hidden = false; crewEmpty.hidden = true;
      if (draftOnly !== undefined) {
        crewEditState.textContent = '新建草稿'; crewEditState.className = 'badge warn'; crewEditTitle.textContent = draftOnly.displayName; crewEditId.textContent = draftOnly.id; crewEditPath.textContent = 'crews.csv（未保存）';
        if (!crewDraftSession.dirty) {
          field('crewEditDisplayName').value = draftOnly.displayName; field('crewEditRole').value = draftOnly.role; field('crewEditRarity').value = draftOnly.rarity; field('crewEditAppearanceId').value = draftOnly.appearanceId; field('crewEditTraitIds').value = draftOnly.traitIds; field('crewEditMaxHp').value = draftOnly.maxHp; field('crewEditMoveTicks').value = draftOnly.moveTicksPerEdge; field('crewEditRepairHp').value = draftOnly.repairHpPerTick;
        }
        return;
      }
      if (entry === undefined) {
        crewEditState.textContent = crewSelection?.validation.ok ? '实例已读取' : '实例有问题';
        crewEditState.className = `badge ${crewSelection?.validation.ok ? 'ok' : 'warn'}`;
        crewEditTitle.textContent = crewSelection?.name ?? '船员实例';
        crewEditId.textContent = crewSelection?.definitionId ?? '定义缺失';
        crewEditPath.textContent = crewSelection?.path ?? '—';
        crewInstanceInfo.hidden = false;
        crewInstanceInfo.textContent = `实例标识：${crewSelection?.instanceId ?? '未读取'}\n初始房间：${crewSelection?.initialRoomInstanceId ?? '未读取'}\n初始站位：${crewSelection?.initialStationIndex ?? '未读取'}\n初始生命：${crewSelection?.initialHp ?? '未读取'}\n当前代号：${crewSelection?.callSign ?? '未读取'}\n校验：${crewSelection?.validation.message ?? '未读取'}`;
        crewInstanceNameMode.value = crewSelection?.nameMode === 'FIXED' ? 'FIXED' : 'GENERATED';
        crewInstanceCallSign.value = crewSelection?.callSign ?? '';
        for (const key of ['crewEditDisplayName', 'crewEditRole', 'crewEditRarity', 'crewEditAppearanceId', 'crewEditTraitIds', 'crewEditMaxHp', 'crewEditMoveTicks', 'crewEditRepairHp']) field(key).value = '';
        return;
      }
      crewEditState.textContent = crewDraftSession.dirty ? '未保存' : '已加载'; crewEditState.className = `badge ${crewDraftSession.dirty ? 'warn' : 'ok'}`; crewEditTitle.textContent = entry.displayName; crewEditId.textContent = entry.id; crewEditPath.textContent = 'crews.csv';
      if (crewDraftBaseline?.id !== entry.id) {
        crewDraftBaseline = { id: entry.id, displayName: entry.displayName, role: entry.role, rarity: entry.rarity, maxHp: String(entry.maxHp), moveTicksPerEdge: String(entry.moveTicksPerEdge), repairHpPerTick: String(entry.repairHpPerTick), appearanceId: entry.appearanceId, traitIds: entry.traitIds.join('|') };
        if (!crewDraftSession.dirty) {
          field('crewEditDisplayName').value = entry.displayName;
          field('crewEditRole').value = entry.role;
          field('crewEditRarity').value = entry.rarity;
          field('crewEditAppearanceId').value = entry.appearanceId;
          field('crewEditTraitIds').value = entry.traitIds.join('|');
          field('crewEditMaxHp').value = String(entry.maxHp);
          field('crewEditMoveTicks').value = String(entry.moveTicksPerEdge);
          field('crewEditRepairHp').value = String(entry.repairHpPerTick);
        }
      } else if (!crewDraftSession.dirty) {
        field('crewEditDisplayName').value = entry.displayName;
        field('crewEditRole').value = entry.role;
        field('crewEditRarity').value = entry.rarity;
        field('crewEditAppearanceId').value = entry.appearanceId;
        field('crewEditTraitIds').value = entry.traitIds.join('|');
        field('crewEditMaxHp').value = String(entry.maxHp);
        field('crewEditMoveTicks').value = String(entry.moveTicksPerEdge);
        field('crewEditRepairHp').value = String(entry.repairHpPerTick);
      }
      crewInstanceInfo.hidden = crewSelection === undefined;
      crewInstanceInfo.textContent = crewSelection === undefined ? '' : `实例标识：${crewSelection.instanceId ?? '未读取'}\n初始房间：${crewSelection.initialRoomInstanceId ?? '未读取'}\n初始站位：${crewSelection.initialStationIndex ?? '未读取'}\n初始生命：${crewSelection.initialHp ?? '未读取'}\n当前代号：${crewSelection.callSign ?? '未读取'}\n校验：${crewSelection.validation.message}`;
      crewInstanceNameMode.value = crewSelection?.nameMode === 'FIXED' ? 'FIXED' : 'GENERATED';
      crewInstanceCallSign.value = crewSelection?.callSign ?? '';
    };

    const renderCrewList = (): void => {
      crewList.replaceChildren();
      if (crewEntries.length === 0) { const empty = document.createElement('div'); empty.className = 'empty'; empty.textContent = '暂无船员资源，请先创建船员模板'; crewList.append(empty); }
      for (const entry of crewEntries) appendCrewEntry(crewList, entry, selectedCrewId === entry.id, () => {
        if (entry.id !== selectedCrewId && !canLeaveAnyDraft()) return;
        if (entry.id !== selectedCrewId) {
          invalidateDraftSession(crewDraftSession);
          crewDraftBaseline = undefined;
        }
        selectedCrewId = entry.id;
        crewDraftSession.dirty = false;
        renderCrewList(); renderCrewInspector();
      }, async () => {
        setInlineDetail(`正在创建 ${entry.displayName} 实例…`, 'info');
          try { const result = await Editor.Message.request(PACKAGE_NAME, 'create-crew-instance', { entry, nameMode: crewInstanceNameMode.value, callSign: crewInstanceCallSign.value.trim() }) as { ok: boolean; message: string }; reportResult('crew-instance-create', '船员实例创建结果', result); await refreshState(true); } catch (cause) { reportNotice({ kind: 'error', title: '船员实例创建失败', message: cause instanceof Error ? cause.message : String(cause), scope: 'crew-instance-create' }); }
      });
      renderCrewInspector();
    };

    const loadHullForm = (entry: HullCatalogEntry): void => {
      selectedHullId = entry.id;
      field('hullId').value = entry.id;
      field('hullDisplayName').value = entry.displayName;
      field('hullLevel').value = String(entry.level);
      field('hullGridWidth').value = String(entry.gridWidth);
      field('hullGridHeight').value = String(entry.gridHeight);
      field('hullMaxCrew').value = String(entry.maxCrew);
      field('hullMaxRooms').value = String(entry.maxRooms);
      field('hullVisualId').value = entry.visualId;
      field('hullCellMask').value = entry.cellMask;
    };

    const renderHullList = (): void => {
      hullList.replaceChildren();
      const selectedEntry = hullEntries.find((entry) => entry.id === selectedHullId);
      if (selectedEntry !== undefined && !hullDraftSession.dirty) {
        hullDraftBaseline = { id: selectedEntry.id, displayName: selectedEntry.displayName, level: String(selectedEntry.level), gridWidth: String(selectedEntry.gridWidth), gridHeight: String(selectedEntry.gridHeight), maxCrew: String(selectedEntry.maxCrew), maxRooms: String(selectedEntry.maxRooms), cellMask: selectedEntry.cellMask, visualId: selectedEntry.visualId, baseConstructionSlots: '3' };
        loadHullForm(selectedEntry);
      }
      for (const entry of hullEntries) {
        const row = document.createElement('div');
        row.className = `room${selectedHullId === entry.id ? ' selected' : ''}`;
        row.addEventListener('click', () => {
          if (entry.id !== selectedHullId && !canLeaveAnyDraft()) return;
          if (entry.id !== selectedHullId) {
            invalidateDraftSession(hullDraftSession);
            hullDraftBaseline = undefined;
          }
          hullDraftSession.dirty = false;
          hullDraftBaseline = { id: entry.id, displayName: entry.displayName, level: String(entry.level), gridWidth: String(entry.gridWidth), gridHeight: String(entry.gridHeight), maxCrew: String(entry.maxCrew), maxRooms: String(entry.maxRooms), cellMask: entry.cellMask, visualId: entry.visualId, baseConstructionSlots: '3' };
          loadHullForm(entry);
          renderHullList();
        });
        const main = document.createElement('div'); main.className = 'room-main';
        const name = document.createElement('span'); name.className = 'room-name'; name.textContent = entry.displayName;
        const meta = document.createElement('div'); meta.className = 'room-meta';
        for (const text of [`${entry.gridWidth} × ${entry.gridHeight} 格`, `船员 ${entry.maxCrew}`, entry.id]) { const item = document.createElement('span'); item.textContent = text; meta.append(item); }
        main.append(name, meta); row.append(main); hullList.append(row);
      }
      if (hullEntries.length === 0) { const empty = document.createElement('div'); empty.className = 'empty'; empty.textContent = '暂无船体定义'; hullList.append(empty); }
    };

    const render = (next: AuthoringState): void => {
      const previousUuid = state?.selection.uuid;
      if (next.selection.uuid !== previousUuid && hasAnyDraftDirty()) {
        blockedSelectionUuid = next.selection.uuid ?? '';
        blockedSelectionName = next.selection.name ?? '';
        renderSelectionBanner();
        reportNotice({ kind: 'warn', title: '选择切换已暂停', message: '选择已暂存，请保存或放弃当前草稿后切换。', scope: 'draft-selection' });
        return;
      }
      blockedSelectionUuid = '';
      blockedSelectionName = '';
      renderSelectionBanner();
      state = next; roomEntries = next.rooms; crewEntries = next.crews ?? []; hullEntries = next.hulls ?? [];
      if (next.selection.uuid !== previousUuid) {
        if (next.selection.kind === 'room-instance') {
          selectedRoomId = next.selection.definitionId ?? '';
          activePage = 'rooms';
        } else if (next.selection.kind === 'crew-instance') {
          selectedCrewId = next.selection.definitionId ?? '';
          activePage = 'crew';
        } else if (next.selection.kind === 'ship-instance') {
          selectedHullId = next.selection.hullDefinitionId ?? '';
          activePage = 'hulls';
        } else {
          activePage = 'scene';
        }
      }
      const placementMode = next.roomTarget.mode ?? (next.roomTarget.ok ? 'grid' : 'blocked');
      const placementLabel = placementMode === 'grid' ? '网格放置' : placementMode === 'canvas' ? '画布顶层放置' : placementMode === 'scene-root' ? '场景顶层放置' : '需要处理';
      sceneBadge.textContent = next.roomTarget.ok ? '已就绪' : '需要处理'; sceneBadge.className = `badge ${next.roomTarget.ok ? 'ok' : 'warn'}`; roomCount.textContent = `${next.rooms.length} 个`; crewCount.textContent = `${crewEntries.length} 个`; hullCount.textContent = `${hullEntries.length} 个`; navWarningCount.textContent = String(next.warnings.length); sync.innerHTML = '<i></i>已同步'; createOrUpdateBoot.removeAttribute('disabled'); createOrUpdateMain.removeAttribute('disabled'); createOrUpdateBattle.removeAttribute('disabled'); renderCategories(); renderHullList(); renderRoomList(); renderCrewList(); renderValidation(next); setPage(activePage);
      if (activePage === 'rooms' && roomDrafts.length === 0 && !roomDraftLoadPending) void loadRoomDraftsFromMain();
    };

    const refreshState = async (force: boolean, refreshCatalog: boolean = force): Promise<void> => {
      const selected = getSelectedNodeUuid();
      if (!force && selected === lastSelectionKey && state !== undefined && state.selection.uuid === selected) return;
      lastSelectionKey = selected;
      const sequence = ++refreshStateSequence;
      try {
        const next = await Editor.Message.request(PACKAGE_NAME, refreshCatalog ? 'refresh-authoring-state' : 'get-authoring-state') as AuthoringState;
        if (sequence === refreshStateSequence) render(next);
      } catch (cause) {
        if (sequence === refreshStateSequence) { sync.innerHTML = '<i></i>读取失败'; reportNotice({ kind: 'error', title: '读取创作状态失败', message: cause instanceof Error ? cause.message : String(cause), scope: 'authoring-state' }); }
      }
    };

    const loadRoomDraftsFromMain = async (): Promise<void> => {
      const sequence = ++roomDraftLoadSequence;
      roomDraftLoadPending = true;
      try {
        const result = await Editor.Message.request(PACKAGE_NAME, 'get-room-csv-drafts') as { readonly ok: boolean; readonly message: string; readonly drafts?: readonly RoomCsvDraft[] };
        if (!result.ok || result.drafts === undefined) throw new Error(result.message);
        if (sequence !== roomDraftLoadSequence) return;
        roomDrafts = result.drafts;
        if (!roomDraftSession.dirty && (getRoomDraft() === undefined || roomDraftBaseline === undefined)) {
          const selected = result.drafts.find((draft) => draft.id === selectedRoomId) ?? result.drafts[0];
          selectedRoomId = selected?.id ?? selectedRoomId;
          roomDraftBaseline = undefined;
        }
        roomCount.textContent = `${result.drafts.length} 个`;
        renderRoomList();
      } catch (cause) {
        if (sequence === roomDraftLoadSequence) reportNotice({ kind: 'error', title: '读取房间 CSV 失败', message: `读取房间 CSV 失败：${cause instanceof Error ? cause.message : String(cause)}`, scope: 'room-csv-load' });
      } finally {
        if (sequence === roomDraftLoadSequence) roomDraftLoadPending = false;
      }
    };

    const readCrewEditDraft = (): Record<string, string> | null => {
      const entry = crewEntries.find((item) => item.id === selectedCrewId);
      const baseline = crewDraftBaseline?.id === selectedCrewId ? crewDraftBaseline : undefined;
      if (entry === undefined && baseline === undefined) return null;
      return { id: selectedCrewId, displayName: field('crewEditDisplayName').value.trim(), role: field('crewEditRole').value, rarity: field('crewEditRarity').value.trim(), maxHp: field('crewEditMaxHp').value.trim(), moveTicksPerEdge: field('crewEditMoveTicks').value.trim(), repairHpPerTick: field('crewEditRepairHp').value.trim(), appearanceId: field('crewEditAppearanceId').value.trim(), traitIds: field('crewEditTraitIds').value.trim() };
    };

    const runBusy = async <T>(targets: readonly HTMLElement[], progress: string, action: () => Promise<T>): Promise<T | undefined> => {
      if (targets.some((target) => target.hasAttribute?.('disabled'))) return undefined;
      targets.forEach((target) => setElementDisabled(target, true));
      setInlineDetail(progress, 'info');
      try { return await action(); }
      finally { targets.forEach((target) => setElementDisabled(target, false)); }
    };

    const confirmDanger = async (message: string, detail: string): Promise<boolean> => {
      const dialog = (globalThis as { Editor?: { Dialog?: { warn?: (message: string, options?: Record<string, unknown>) => Promise<{ readonly response?: number }> } } }).Editor?.Dialog;
      if (dialog?.warn === undefined) {
        reportNotice({ kind: 'error', title: '无法确认危险操作', message: `${message}：当前 Creator 不提供公开确认弹窗，操作已停止。`, scope: 'danger-confirm' });
        return false;
      }
      try {
        const result = await dialog.warn(message, { detail, buttons: ['取消', '继续'], cancel: 0, default: 0 });
        return result.response === 1;
      } catch (cause) {
        reportNotice({ kind: 'error', title: '危险操作确认失败', message: cause instanceof Error ? cause.message : String(cause), scope: 'danger-confirm' });
        return false;
      }
    };

    const sceneUpdateButtons = [createOrUpdateBoot, createOrUpdateMain, createOrUpdateBattle] as const;
    const sceneNames: Readonly<Record<'BOOT' | 'MAIN' | 'BATTLE', string>> = {
      BOOT: '启动界面',
      MAIN: '主界面',
      BATTLE: '战斗界面',
    };

    const runSceneUpdate = async (kind: 'BOOT' | 'MAIN' | 'BATTLE'): Promise<void> => {
      if (hasAnyDraftDirty()) {
        reportNotice({ kind: 'warn', title: '场景更新已暂停', message: '当前领域存在未保存修改，请先保存或取消预览后再更新场景。', scope: 'scene-update' });
        return;
      }
      const result = await runBusy(sceneUpdateButtons, `正在创建/更新${sceneNames[kind]}…`, async () => {
        try {
          return await Editor.Message.request(PACKAGE_NAME, 'create-or-update-scene', kind) as { readonly ok: boolean; readonly message: string };
        } catch (cause) {
          return { ok: false, message: `${sceneNames[kind]}更新失败：${cause instanceof Error ? cause.message : String(cause)}` };
        }
      });
      if (result !== undefined) {
        reportResult(`scene-update-${kind}`, `${sceneNames[kind]}更新结果`, result);
        await refreshState(true);
      }
    };

    for (const [page, button] of Object.entries(nav) as [PageId, HTMLElement][]) button.addEventListener('click', () => {
      setPage(page);
      if (page === 'config' && csvTables === undefined) void loadCsvTables();
      if (page === 'rooms' && roomDrafts.length === 0 && !roomDraftLoadPending) void loadRoomDraftsFromMain();
    });
    const queueRoomPreview = (): void => {
      roomDraftSession.dirty = true;
      editState.textContent = '未保存'; editState.className = 'badge warn';
      if (roomDraftSession.timer !== undefined) clearTimeout(roomDraftSession.timer);
      const sequence = ++roomDraftSession.sequence;
      roomDraftSession.timer = setTimeout(async () => {
        roomDraftSession.timer = undefined;
        const draft = readRoomDraftFromFields();
        if (draft === null) return;
        const checked = toRoomPreviewDto(draft);
        if (checked.ok === false) { setInlineDetail(`预览未发送：${checked.message}`, 'error'); return; }
        try {
          const result = await Editor.Message.request(PACKAGE_NAME, 'preview-room-definition', draft) as { readonly ok: boolean; readonly message: string };
          if (sequence === roomDraftSession.sequence && !result.ok) setInlineDetail(result.message, 'error');
        } catch (cause) {
          if (sequence === roomDraftSession.sequence) setInlineDetail(`房间预览失败：${cause instanceof Error ? cause.message : String(cause)}`, 'error');
        }
      }, 150);
    };
    for (const key of ['editDisplayName', 'editCategory', 'editWidth', 'editHeight', 'editMaxLevel', 'editMaxHp', 'editMinPower', 'editMaxPower', 'editPowerGeneration', 'editCrewCapacity', 'editHealingHp', 'editVerticalConnectorKind', 'editVisualId', 'editMetalCost', 'editBuildDurationMs', 'editDemolishDurationMs', 'editRefundPermille']) {
      field(key).addEventListener('input', queueRoomPreview);
    }
    editConnectorPorts.addEventListener('input', queueRoomPreview);
    const queueCrewPreview = (): void => {
      crewDraftSession.dirty = true;
      crewEditState.textContent = '未保存'; crewEditState.className = 'badge warn';
      const draft = readCrewEditDraft();
      if (draft === null) return;
      if (crewDraftSession.timer !== undefined) clearTimeout(crewDraftSession.timer);
      const sequence = ++crewDraftSession.sequence;
      crewDraftSession.timer = setTimeout(async () => {
        crewDraftSession.timer = undefined;
        if (sequence !== crewDraftSession.sequence || draft.id !== selectedCrewId) return;
        try {
          const result = await Editor.Message.request(PACKAGE_NAME, 'preview-crew-definition', { draft }) as { readonly ok: boolean; readonly message: string };
          if (sequence === crewDraftSession.sequence && draft.id === selectedCrewId && !result.ok) setInlineDetail(result.message, 'error');
        } catch (cause) {
          if (sequence === crewDraftSession.sequence && draft.id === selectedCrewId) setInlineDetail(`船员预览失败：${cause instanceof Error ? cause.message : String(cause)}`, 'error');
        }
      }, 150);
    };
    const readHullEditDraft = (): Record<string, string> | null => {
      const entry = hullEntries.find((item) => item.id === selectedHullId);
      const baseline = hullDraftBaseline?.id === selectedHullId ? hullDraftBaseline : undefined;
      if (entry === undefined && baseline === undefined) return null;
      return {
        id: selectedHullId,
        displayName: field('hullDisplayName').value.trim(),
        level: field('hullLevel').value.trim(),
        gridWidth: field('hullGridWidth').value.trim(),
        gridHeight: field('hullGridHeight').value.trim(),
        cellMask: field('hullCellMask').value.trim(),
        maxCrew: field('hullMaxCrew').value.trim(),
        maxRooms: field('hullMaxRooms').value.trim(),
        baseConstructionSlots: baseline?.baseConstructionSlots ?? '3',
        visualId: field('hullVisualId').value.trim(),
      };
    };
    const queueHullPreview = (): void => {
      hullDraftSession.dirty = true;
      const draft = readHullEditDraft();
      if (draft === null) return;
      if (hullDraftSession.timer !== undefined) clearTimeout(hullDraftSession.timer);
      const sequence = ++hullDraftSession.sequence;
      hullDraftSession.timer = setTimeout(async () => {
        hullDraftSession.timer = undefined;
        if (sequence !== hullDraftSession.sequence || draft.id !== selectedHullId) return;
        try {
          const result = await Editor.Message.request(PACKAGE_NAME, 'preview-hull-definition', { draft }) as { readonly ok: boolean; readonly message: string };
          if (sequence === hullDraftSession.sequence && draft.id === selectedHullId && !result.ok) setInlineDetail(result.message, 'error');
        } catch (cause) {
          if (sequence === hullDraftSession.sequence && draft.id === selectedHullId) setInlineDetail(`船体预览失败：${cause instanceof Error ? cause.message : String(cause)}`, 'error');
        }
      }, 150);
    };
    for (const key of ['crewEditDisplayName', 'crewEditRole', 'crewEditRarity', 'crewEditAppearanceId', 'crewEditTraitIds', 'crewEditMaxHp', 'crewEditMoveTicks', 'crewEditRepairHp']) field(key).addEventListener('input', queueCrewPreview);
    const syncRepairDefault = (roleKey: string, repairKey: string): void => {
      const role = field(roleKey).value;
      const repair = field(repairKey);
      if (role !== 'ENGINEER') repair.value = '0';
      else if (Number(repair.value) === 0) repair.value = '1';
    };
    field('crewEditRole').addEventListener('change', () => { syncRepairDefault('crewEditRole', 'crewEditRepairHp'); queueCrewPreview(); });
    roomSearch.addEventListener('input', renderRoomList);
      pssSearch.addEventListener('input', () => { pssPageNumber = 1; void renderPss(); });
      pssKind.addEventListener('change', () => { pssPageNumber = 1; void renderPss(); });
      pssLanguage.addEventListener('change', () => { pssPageNumber = 1; void renderPss(); });
      pssRefresh.addEventListener('confirm', async () => {
      const result = await runBusy([pssRefresh], '正在重建 PSS 索引…', async () => {
        try { await Editor.Message.request(PACKAGE_NAME, 'build-pss-index'); pssPageNumber = 1; await renderPss(); return true; }
        catch (cause) { const message = `无法重建 PSS 索引：${cause instanceof Error ? cause.message : String(cause)}`; pssStatus.textContent = message; reportNotice({ kind: 'error', title: 'PSS 索引重建失败', message, scope: 'pss-index' }); return false; }
      });
      if (result === true) reportNotice({ kind: 'success', title: 'PSS 索引已重建', message: 'PSS 索引已重建。', scope: 'pss-index' });
      });
      pssBindRooms.addEventListener('confirm', async () => {
        if (!await confirmDanger('确认全新重建房间外观？', '这会按视觉 CSV 重写首批房间 Prefab 的外观引用。')) return;
        await runBusy([pssBindRooms], '正在从视觉 CSV 全新重建五个房间外观…', async () => {
          try { const result = await Editor.Message.request(PACKAGE_NAME, 'bind-first-pss-room-appearances', 'MAIN') as { readonly ok: boolean; readonly message: string }; pssStatus.textContent = result.message; reportResult('pss-room-bind', '房间外观绑定结果', result); }
          catch (cause) { const message = `房间外观绑定失败：${cause instanceof Error ? cause.message : String(cause)}`; pssStatus.textContent = message; reportNotice({ kind: 'error', title: '房间外观绑定失败', message, scope: 'pss-room-bind' }); }
        });
      });
      pssBindCrews.addEventListener('confirm', async () => {
        if (!await confirmDanger('确认全新重建船员外观？', '这会按视觉 CSV 重写首批船员 Prefab 的外观引用。')) return;
        await runBusy([pssBindCrews], '正在从视觉 CSV 全新重建四套船员外观…', async () => {
          try { const result = await Editor.Message.request(PACKAGE_NAME, 'bind-first-pss-crew-appearances', 'MAIN') as { readonly ok: boolean; readonly message: string }; pssStatus.textContent = result.message; reportResult('pss-crew-bind', '船员外观绑定结果', result); }
          catch (cause) { const message = `船员外观绑定失败：${cause instanceof Error ? cause.message : String(cause)}`; pssStatus.textContent = message; reportNotice({ kind: 'error', title: '船员外观绑定失败', message, scope: 'pss-crew-bind' }); }
        });
      });
      field('pssBindHulls').addEventListener('confirm', async () => {
        if (!await confirmDanger('确认导入并绑定新手船外观？', '这会复制 PSS 只读素材并重写主场景船体外观引用。')) return;
        await runBusy([pssBindHulls], '正在校验并导入 PSS 4324/261 船体外观…', async () => {
          try { const result = await Editor.Message.request(PACKAGE_NAME, 'import-and-bind-first-pss-hull-appearances', 'MAIN') as { readonly ok: boolean; readonly message: string }; pssStatus.textContent = result.message; reportResult('pss-hull-bind', '船体外观导入结果', result); }
          catch (cause) { const message = `船体外观导入失败：${cause instanceof Error ? cause.message : String(cause)}`; pssStatus.textContent = message; reportNotice({ kind: 'error', title: '船体外观导入失败', message, scope: 'pss-hull-bind' }); }
        });
      });
      pssPrevious.addEventListener('confirm', () => { pssPageNumber = Math.max(1, pssPageNumber - 1); void renderPss(); });
      pssNext.addEventListener('confirm', () => { pssPageNumber += 1; void renderPss(); });
      csvTableName.addEventListener('change', renderCsvTable);
      csvReload.addEventListener('confirm', () => { void loadCsvTables(); });
      csvImport.addEventListener('confirm', async () => {
        if (!await confirmDanger('确认批量导入全部 CSV？', '会覆盖当前正式 CSV 配置；导入前会校验完整表头、稳定 ID 和跨表引用。')) return;
        await runBusy([csvImport], '正在校验并导入全部 CSV…', async () => {
        csvState.textContent = '校验中…';
        csvStatus.textContent = '配置表页为只读审计；批量导入请通过领域导入流程提交全部文件。';
        try {
          const result = await Editor.Message.request(PACKAGE_NAME, 'import-csv-config-bundle') as {
            readonly ok: boolean;
            readonly message: string;
            readonly bundle?: { readonly tables: Readonly<Record<CsvConfigTableName, string>> };
          };
          if (result.ok && result.bundle !== undefined) {
            csvTables = result.bundle.tables;
            renderCsvTable();
          } else {
            csvState.textContent = '校验失败';
            csvState.className = 'badge warn';
          }
          csvStatus.textContent = result.ok ? `全部配置表校验通过：${result.message}` : result.message;
          reportResult('csv-import', 'CSV 批量导入结果', result);
        } catch (cause) {
          csvState.textContent = '读取失败';
          csvState.className = 'badge warn';
          const message = `读取配置表失败：${cause instanceof Error ? cause.message : String(cause)}`;
          csvStatus.textContent = message;
          reportNotice({ kind: 'error', title: 'CSV 批量导入失败', message, scope: 'csv-import' });
        }
        });
      });
    stopCatalogListening?.();
    const broadcastMessage = getBroadcastMessagePort();
    const onRoomCatalogChange = (): void => { if (!batchPaused) { void refreshState(true, false); void loadRoomDraftsFromMain(); } };
    const onPssIndexChange = (): void => { if (!batchPaused) void renderPss(); };
    const onCsvConfigChange = (): void => { if (!batchPaused) { void loadCsvTables(); void loadRoomDraftsFromMain(); } };
    // 不销毁/重建 Creator 面板宿主的 interval；批处理期间让既有回调空转，
    // 避免窗口切换 Prefab 时与 Creator 内部 timers 生命周期发生竞态。
    const onAuthoringBatchStart = (): void => { batchPaused = true; };
    const onAuthoringBatchEnd = (): void => { batchPaused = false; };
    if (broadcastMessage?.addBroadcastListener !== undefined) {
      broadcastMessage.addBroadcastListener(ROOM_CATALOG_CHANGE_MESSAGE, onRoomCatalogChange);
      broadcastMessage.addBroadcastListener(CREW_CATALOG_CHANGE_MESSAGE, onRoomCatalogChange);
      broadcastMessage.addBroadcastListener(HULL_CATALOG_CHANGE_MESSAGE, onRoomCatalogChange);
      broadcastMessage.addBroadcastListener(PSS_INDEX_CHANGE_MESSAGE, onPssIndexChange);
      broadcastMessage.addBroadcastListener(CSV_CONFIG_CHANGE_MESSAGE, onCsvConfigChange);
      broadcastMessage.addBroadcastListener(AUTHORING_BATCH_START_MESSAGE, onAuthoringBatchStart);
      broadcastMessage.addBroadcastListener(AUTHORING_BATCH_END_MESSAGE, onAuthoringBatchEnd);
      stopCatalogListening = () => {
        broadcastMessage.removeBroadcastListener?.(ROOM_CATALOG_CHANGE_MESSAGE, onRoomCatalogChange);
        broadcastMessage.removeBroadcastListener?.(CREW_CATALOG_CHANGE_MESSAGE, onRoomCatalogChange);
        broadcastMessage.removeBroadcastListener?.(HULL_CATALOG_CHANGE_MESSAGE, onRoomCatalogChange);
        broadcastMessage.removeBroadcastListener?.(PSS_INDEX_CHANGE_MESSAGE, onPssIndexChange);
        broadcastMessage.removeBroadcastListener?.(CSV_CONFIG_CHANGE_MESSAGE, onCsvConfigChange);
        broadcastMessage.removeBroadcastListener?.(AUTHORING_BATCH_START_MESSAGE, onAuthoringBatchStart);
        broadcastMessage.removeBroadcastListener?.(AUTHORING_BATCH_END_MESSAGE, onAuthoringBatchEnd);
        stopCatalogListening = undefined;
      };
    }
    saveRoom.addEventListener('confirm', async () => {
      const draft = readRoomDraftFromFields();
      if (draft === null) return;
      const checked = toRoomPreviewDto(draft);
      if (checked.ok === false) { editState.textContent = '校验失败'; reportNotice({ kind: 'error', title: '房间保存校验失败', message: checked.message, scope: 'room-save' }); return; }
      invalidateDraftSession(roomDraftSession);
      editState.textContent = '保存中…';
      try {
        const result = await Editor.Message.request(PACKAGE_NAME, 'save-room-csv-draft', { draft }) as { readonly ok: boolean; readonly message: string; readonly draft?: RoomCsvDraft };
        reportResult('room-save', '房间保存结果', result);
        if (result.ok) {
          roomDraftSession.dirty = false;
          roomDraftBaseline = result.draft ?? draft;
          editState.textContent = '已保存';
          await loadRoomDraftsFromMain();
          await refreshState(true);
        } else editState.textContent = '校验失败';
      } catch (cause) {
        editState.textContent = '保存失败';
        reportNotice({ kind: 'error', title: '房间保存失败', message: cause instanceof Error ? cause.message : String(cause), scope: 'room-save' });
      }
    });
    newRoom.addEventListener('confirm', async () => {
      setInlineDetail('正在创建房间定义草稿…', 'info');
      try { const result = await Editor.Message.request(PACKAGE_NAME, 'create-room-csv-draft', {} ) as { readonly ok: boolean; readonly message: string; readonly draft?: RoomCsvDraft };
        if (result.ok && result.draft) { roomDrafts = [...roomDrafts, result.draft]; selectedRoomId = result.draft.id; roomDraftBaseline = result.draft; applyRoomDraftToFields(result.draft); roomDraftSession.dirty = true; editState.textContent = '新建草稿'; editState.className = 'badge warn'; renderRoomList(); renderInspector(); setPage('rooms'); }
        reportResult('room-draft-create', '房间草稿创建结果', result);
      } catch (cause) { reportNotice({ kind: 'error', title: '房间草稿创建失败', message: cause instanceof Error ? cause.message : String(cause), scope: 'room-draft-create' }); }
    });
    cancelRoom.addEventListener('confirm', async () => {
      try { await Editor.Message.request(PACKAGE_NAME, 'cancel-authoring-preview'); } catch { /* 清理失败时仍恢复表单基线 */ }
      if (roomDraftBaseline !== undefined && !roomEntries.some((entry) => entry.id === roomDraftBaseline?.id)) {
        roomDrafts = roomDrafts.filter((draft) => draft.id !== roomDraftBaseline?.id);
        selectedRoomId = '';
        roomDraftBaseline = undefined;
        roomDraftSession.dirty = false;
        await loadRoomDraftsFromMain();
        reportNotice({ kind: 'success', title: '已取消房间草稿', message: '已取消新建房间定义草稿。', scope: 'room-draft-cancel' });
        return;
      }
      if (!roomDraftSession.dirty) { await loadRoomDraftsFromMain(); return; }
      if (roomDraftBaseline !== undefined) {
        applyRoomDraftToFields(roomDraftBaseline);
        editState.textContent = '已取消修改';
        editState.className = 'badge neutral';
        roomDraftSession.dirty = false;
        reportNotice({ kind: 'success', title: '已取消房间修改', message: '已取消房间 CSV 草稿修改。', scope: 'room-draft-cancel' });
      } else {
        roomDraftSession.dirty = false;
        await loadRoomDraftsFromMain();
      }
    });
    saveRoomInstance.addEventListener('confirm', async () => {
      const selection = state?.selection.kind === 'room-instance' ? state.selection : undefined;
      if (selection?.uuid === undefined) { reportNotice({ kind: 'warn', title: '无法保存房间实例', message: '请先选择房间实例。', scope: 'room-instance-save' }); return; }
      const x = Number(editInstanceX.value); const y = Number(editInstanceY.value); const initialHp = Number(editInstanceHp.value);
      if (!Number.isInteger(x) || !Number.isInteger(y) || !Number.isInteger(initialHp)) { reportNotice({ kind: 'warn', title: '房间实例输入无效', message: '实例位置和初始耐久必须是整数。', scope: 'room-instance-save' }); return; }
      saveRoomInstance.setAttribute('disabled', 'true');
      try {
        const result = await Editor.Message.request(PACKAGE_NAME, 'update-room-instance', { nodeUuid: selection.uuid, x, y, initialHp }) as { readonly ok: boolean; readonly message: string };
        reportResult('room-instance-save', '房间实例保存结果', result);
        if (result.ok) { roomInstanceDirty = false; await refreshState(true, false); }
      } catch (cause) {
        reportNotice({ kind: 'error', title: '房间实例保存失败', message: cause instanceof Error ? cause.message : String(cause), scope: 'room-instance-save' });
      } finally { saveRoomInstance.removeAttribute('disabled'); }
    });
    cancelRoomInstance.addEventListener('confirm', () => { roomInstanceDirty = false; renderInspector(); reportNotice({ kind: 'success', title: '已取消房间实例修改', message: '已取消房间实例修改。', scope: 'room-instance-cancel' }); });
    editInstanceX.addEventListener('input', () => { roomInstanceDirty = true; });
    editInstanceY.addEventListener('input', () => { roomInstanceDirty = true; });
    editInstanceHp.addEventListener('input', () => { roomInstanceDirty = true; });
    newCrew.addEventListener('confirm', async () => { setInlineDetail('正在创建船员定义草稿…', 'info'); try { const result = await Editor.Message.request(PACKAGE_NAME, 'create-crew-csv-draft', {}) as { ok: boolean; message: string; draft?: Record<string, string> }; reportResult('crew-draft-create', '船员草稿创建结果', result); if (result.ok && result.draft) { invalidateDraftSession(crewDraftSession); selectedCrewId = result.draft.id; crewDraftBaseline = result.draft; crewDraftSession.dirty = false; renderCrewInspector(); crewDraftSession.dirty = true; crewEditState.textContent = '新建草稿'; crewEditState.className = 'badge warn'; } } catch (cause) { reportNotice({ kind: 'error', title: '船员草稿创建失败', message: cause instanceof Error ? cause.message : String(cause), scope: 'crew-draft-create' }); } });
    cancelCrew.addEventListener('confirm', async () => { invalidateDraftSession(crewDraftSession); try { await Editor.Message.request(PACKAGE_NAME, 'cancel-authoring-preview'); } catch { /* 表单基线仍可恢复 */ } if (crewDraftBaseline) { const isNew = !crewEntries.some((entry) => entry.id === crewDraftBaseline?.id); if (isNew) { selectedCrewId = ''; crewDraftBaseline = undefined; crewEditState.textContent = '已取消'; crewInspector.hidden = true; crewEmpty.hidden = false; } else { for (const [key, value] of Object.entries(crewDraftBaseline)) { const target = field(`crewEdit${key[0].toUpperCase()}${key.slice(1)}`); if (target) target.value = value; } crewEditState.textContent = '已取消修改'; crewEditState.className = 'badge neutral'; } crewDraftSession.dirty = false; reportNotice({ kind: 'success', title: '已取消船员修改', message: '已取消船员草稿修改。', scope: 'crew-draft-cancel' }); } });
    saveCrew.addEventListener('confirm', async () => { const draft = readCrewEditDraft(); if (draft === null) return; invalidateDraftSession(crewDraftSession); crewEditState.textContent = '保存中…'; try { const result = await Editor.Message.request(PACKAGE_NAME, 'save-crew-csv-draft', { draft }) as { ok: boolean; message: string }; reportResult('crew-save', '船员保存结果', result); crewEditState.textContent = result.ok ? '已保存' : '校验失败'; if (result.ok) { crewDraftBaseline = draft; crewDraftSession.dirty = false; await Editor.Message.request(PACKAGE_NAME, 'cancel-authoring-preview'); await refreshState(true); } } catch (cause) { crewEditState.textContent = '保存失败'; reportNotice({ kind: 'error', title: '船员保存失败', message: cause instanceof Error ? cause.message : String(cause), scope: 'crew-save' }); } });
    newHull.addEventListener('confirm', async () => { setInlineDetail('正在创建船体定义草稿…', 'info'); try { const result = await Editor.Message.request(PACKAGE_NAME, 'create-hull-csv-draft', {}) as { ok: boolean; message: string; draft?: Record<string, string> }; reportResult('hull-draft-create', '船体草稿创建结果', result); if (result.ok && result.draft) { invalidateDraftSession(hullDraftSession); selectedHullId = result.draft.id; hullDraftBaseline = result.draft; hullDraftSession.dirty = true; field('hullId').value = result.draft.id; field('hullDisplayName').value = result.draft.displayName ?? ''; field('hullLevel').value = result.draft.level ?? ''; field('hullGridWidth').value = result.draft.gridWidth ?? ''; field('hullGridHeight').value = result.draft.gridHeight ?? ''; field('hullMaxCrew').value = result.draft.maxCrew ?? ''; field('hullMaxRooms').value = result.draft.maxRooms ?? ''; field('hullVisualId').value = result.draft.visualId ?? ''; field('hullCellMask').value = result.draft.cellMask ?? ''; } } catch (cause) { reportNotice({ kind: 'error', title: '船体草稿创建失败', message: cause instanceof Error ? cause.message : String(cause), scope: 'hull-draft-create' }); } });
    cancelHull.addEventListener('confirm', async () => { invalidateDraftSession(hullDraftSession); try { await Editor.Message.request(PACKAGE_NAME, 'cancel-authoring-preview'); } catch { /* 表单基线仍可恢复 */ } if (hullDraftBaseline) { const isNew = !hullEntries.some((entry) => entry.id === hullDraftBaseline?.id); if (isNew) { selectedHullId = ''; hullDraftBaseline = undefined; } else { field('hullDisplayName').value = hullDraftBaseline.displayName ?? ''; field('hullLevel').value = hullDraftBaseline.level ?? ''; field('hullGridWidth').value = hullDraftBaseline.gridWidth ?? ''; field('hullGridHeight').value = hullDraftBaseline.gridHeight ?? ''; field('hullMaxCrew').value = hullDraftBaseline.maxCrew ?? ''; field('hullMaxRooms').value = hullDraftBaseline.maxRooms ?? ''; field('hullVisualId').value = hullDraftBaseline.visualId ?? ''; field('hullCellMask').value = hullDraftBaseline.cellMask ?? ''; } hullDraftSession.dirty = false; reportNotice({ kind: 'success', title: '已取消船体修改', message: '已取消船体草稿修改。', scope: 'hull-draft-cancel' }); } });
    createHull.addEventListener('confirm', () => { setPage('hulls'); reportNotice({ kind: 'warn', title: '请先创建船体草稿', message: '请使用“新建定义”创建 hulls.csv 草稿，再保存。', scope: 'hull-create-help' }); });
    saveHull.addEventListener('confirm', async () => { const entry = hullEntries.find((item) => item.id === selectedHullId); const baseline = hullDraftBaseline?.id === selectedHullId ? hullDraftBaseline : undefined; if (entry === undefined && baseline === undefined) { reportNotice({ kind: 'warn', title: '无法保存船体', message: '请先选择一个船体定义。', scope: 'hull-save' }); return; } const draft = readHullEditDraft(); if (draft === null) { reportNotice({ kind: 'warn', title: '无法保存船体', message: '请先选择一个船体定义。', scope: 'hull-save' }); return; } invalidateDraftSession(hullDraftSession); setInlineDetail('正在保存 hulls.csv…', 'info'); try { const result = await Editor.Message.request(PACKAGE_NAME, 'save-hull-csv-draft', { draft }) as { ok: boolean; message: string }; reportResult('hull-save', '船体保存结果', result); if (result.ok) { hullDraftBaseline = draft; hullDraftSession.dirty = false; await Editor.Message.request(PACKAGE_NAME, 'cancel-authoring-preview'); await refreshState(true); } } catch (cause) { reportNotice({ kind: 'error', title: '船体保存失败', message: cause instanceof Error ? cause.message : String(cause), scope: 'hull-save' }); } });
    for (const key of ['hullDisplayName', 'hullLevel', 'hullGridWidth', 'hullGridHeight', 'hullMaxCrew', 'hullMaxRooms', 'hullVisualId', 'hullCellMask']) field(key).addEventListener('input', queueHullPreview);
    createShip.addEventListener('confirm', async () => { const entry = hullEntries.find((item) => item.id === selectedHullId); if (entry === undefined) { reportNotice({ kind: 'warn', title: '无法创建飞船', message: '请先选择一个船体定义。', scope: 'ship-instance-create' }); return; } setInlineDetail('正在创建飞船实例…', 'info'); try { const result = await Editor.Message.request(PACKAGE_NAME, 'create-ship-instance', entry) as { ok: boolean; message: string }; reportResult('ship-instance-create', '飞船实例创建结果', result); if (result.ok) await refreshState(true); } catch (cause) { reportNotice({ kind: 'error', title: '飞船实例创建失败', message: cause instanceof Error ? cause.message : String(cause), scope: 'ship-instance-create' }); } });
    createSelectedCrew.addEventListener('confirm', async () => { const entry = crewEntries.find((item) => item.id === selectedCrewId); if (entry === undefined) return; setInlineDetail(`正在创建 ${entry.displayName} 实例…`, 'info'); try { const result = await Editor.Message.request(PACKAGE_NAME, 'create-crew-instance', { entry, nameMode: crewInstanceNameMode.value, callSign: crewInstanceCallSign.value.trim() }) as { ok: boolean; message: string }; reportResult('crew-instance-create', '船员实例创建结果', result); await refreshState(true); } catch (cause) { reportNotice({ kind: 'error', title: '船员实例创建失败', message: cause instanceof Error ? cause.message : String(cause), scope: 'crew-instance-create' }); } });
    openSelectedCrewPrefab.addEventListener('confirm', () => { const entry = crewEntries.find((item) => item.id === selectedCrewId); if (entry !== undefined) Editor.Message.send(PACKAGE_NAME, 'open-created-prefab', entry.prefabUrl); });
    createSelectedRoom.addEventListener('confirm', () => { const entry = roomEntries.find((item) => item.id === selectedRoomId); if (entry === undefined) return; void (async () => { setInlineDetail(`正在创建 ${entry.displayName}…`, 'info'); try { const result = await Editor.Message.request(PACKAGE_NAME, 'create-room-instance', entry) as { ok: boolean; message: string }; reportResult('room-instance-create', '房间实例创建结果', result); await refreshState(true); } catch (cause) { reportNotice({ kind: 'error', title: '房间实例创建失败', message: cause instanceof Error ? cause.message : String(cause), scope: 'room-instance-create' }); } })(); });
    openSelectedPrefab.addEventListener('confirm', () => { const entry = roomEntries.find((item) => item.id === selectedRoomId); if (entry !== undefined) Editor.Message.send(PACKAGE_NAME, 'open-created-prefab', entry.prefabUrl); });
    createOrUpdateBoot.addEventListener('confirm', () => { void runSceneUpdate('BOOT'); });
    createOrUpdateMain.addEventListener('confirm', () => { void runSceneUpdate('MAIN'); });
    createOrUpdateBattle.addEventListener('confirm', () => { void runSceneUpdate('BATTLE'); });
    refresh.addEventListener('confirm', () => { void refreshState(true); });
    setPage('scene'); renderCategories(); void renderPss();
    startPolling = () => { if (timer !== undefined) return; void refreshState(true); if (activePage === 'rooms' && !roomDraftLoadPending) void loadRoomDraftsFromMain(); timer = setInterval(() => { if (!batchPaused) void refreshState(false); }, 500); };
    stopPolling = () => { if (timer !== undefined) clearInterval(timer); timer = undefined; };
    startPolling();
  },
  beforeClose() { stopPolling?.(); stopDraftTimers?.(); stopCatalogListening?.(); },
  close() { stopPolling?.(); stopDraftTimers?.(); stopCatalogListening?.(); stopPolling = undefined; startPolling = undefined; stopDraftTimers = undefined; stopCatalogListening = undefined; },
});

function appendRoomCsvEntry(
  list: HTMLElement,
  draft: RoomCsvDraft,
  selected: boolean,
  canCreate: boolean,
  createReason: string,
  onSelect: () => void,
  onCreate: () => Promise<void>,
): void {
  const row = document.createElement('div'); row.className = `room${selected ? ' selected' : ''}`; row.title = `稳定标识：${draft.id}`; row.addEventListener('click', onSelect);
  const main = document.createElement('div'); main.className = 'room-main'; const label = document.createElement('span'); label.className = 'room-name'; label.textContent = draft.displayName; const meta = document.createElement('div'); meta.className = 'room-meta'; const category = document.createElement('span'); category.className = 'room-category'; category.textContent = translateCategory(draft.category); const size = document.createElement('span'); size.textContent = `${draft.width} × ${draft.height} 格`; const id = document.createElement('span'); id.className = 'room-id'; id.textContent = draft.id; meta.append(category, size, id); main.append(label, meta);
  const actions = document.createElement('div'); actions.className = 'room-actions'; const create = document.createElement('ui-button'); create.textContent = '创建'; create.title = canCreate ? '创建到当前场景' : `无法创建：${createReason}`; if (!canCreate) create.setAttribute('disabled', 'true'); create.addEventListener('confirm', (event) => { event.stopPropagation?.(); void onCreate(); }); actions.append(create); row.append(main, actions); list.append(row);
}

function appendCrewEntry(list: HTMLElement, entry: CrewPrefabCatalogEntry, selected: boolean, onSelect: () => void, onCreate: () => Promise<void>): void {
  const row = document.createElement('div'); row.className = `room${selected ? ' selected' : ''}`; row.title = `稳定标识：${entry.id}`; row.addEventListener('click', onSelect);
  const main = document.createElement('div'); main.className = 'room-main'; const label = document.createElement('span'); label.className = 'room-name'; label.textContent = entry.displayName; const meta = document.createElement('div'); meta.className = 'room-meta'; const role = document.createElement('span'); role.className = 'room-category'; role.textContent = translateCrewRole(entry.role); const ticks = document.createElement('span'); ticks.textContent = `${entry.moveTicksPerEdge} 固定步/段`; const repair = document.createElement('span'); repair.textContent = `维修 ${entry.repairHpPerTick}/Tick`; const id = document.createElement('span'); id.className = 'room-id'; id.textContent = entry.id; meta.append(role, ticks, repair, id); main.append(label, meta);
  const actions = document.createElement('div'); actions.className = 'room-actions'; const create = document.createElement('ui-button'); create.textContent = '创建'; create.title = '创建到船员层'; create.addEventListener('confirm', (event) => { event.stopPropagation?.(); void onCreate(); }); actions.append(create); row.append(main, actions); list.append(row);
}

function translateCategory(category: string): string { return ({ ENERGY: '能源', WEAPON: '武器', DEFENSE: '防御', MOBILITY: '机动', SUPPORT: '支援', MOVEMENT: '移动', TACTICAL: '战术', DRONE: '无人机', ECONOMY: '经济', SPECIAL: '特殊' } as Record<string, string>)[category] ?? category; }
function translateCrewRole(role: string): string { return ({ ENGINEER: '工程师', GUNNER: '武器操作员', MEDIC: '医务员', SOLDIER: '士兵' } as Record<string, string>)[role] ?? role; }

function translateSemanticRole(role: string): string {
  return ({ mainCamera: '主相机', canvas: '画布', worldRoot: '世界根', currentShipMount: '当前飞船挂载点', playerShipMount: '我方飞船挂载点', enemyShipMount: '敌方飞船挂载点', shipView: '飞船视图', gridRoot: '网格根', roomRoot: '房间容器', crewRoot: '船员层', effectRoot: '特效层', projectileRoot: '弹道层', battleEnvironment: '战斗环境', uiRoot: '界面根', appRoot: '应用根' } as Record<string, string>)[role] ?? role;
}

function formatPosition(position: { readonly x?: number; readonly y?: number; readonly z?: number } | undefined): string {
  if (position === undefined) return '—';
  return `${position.x ?? 0}, ${position.y ?? 0}, ${position.z ?? 0}`;
}

function setElementDisabled(element: HTMLElement, disabled: boolean): void {
  const toggleAttribute = (element as HTMLElement & { toggleAttribute?: (name: string, force?: boolean) => void }).toggleAttribute;
  if (typeof toggleAttribute === 'function') toggleAttribute.call(element, 'disabled', disabled);
  else if (disabled) element.setAttribute?.('disabled', 'true');
  else element.removeAttribute?.('disabled');
}

function formatGridPosition(position: { readonly x: number; readonly y: number } | undefined): string {
  return position === undefined ? '未读取' : `(${position.x}, ${position.y})`;
}

function getSelectedNodeUuid(): string {
  try {
    const selection = (globalThis as { Editor?: { Selection?: { getSelected?: (type: string) => readonly string[] } } }).Editor?.Selection;
    return selection?.getSelected?.('node')?.[0] ?? '';
  } catch {
    return '';
  }
}

function appendInfo(parent: HTMLElement, label: string, value: string): void {
  const item = document.createElement('div'); item.className = 'info-item';
  const labelElement = document.createElement('span'); labelElement.className = 'label'; labelElement.textContent = label;
  const valueElement = document.createElement('span'); valueElement.className = 'value'; valueElement.textContent = value; valueElement.title = value;
  item.append(labelElement, valueElement); parent.append(item);
}

interface BroadcastMessagePort {
  addBroadcastListener?(name: string, callback: (...args: unknown[]) => void): void;
  removeBroadcastListener?(name: string, callback: (...args: unknown[]) => void): void;
}

function getBroadcastMessagePort(): BroadcastMessagePort | undefined {
  const message = (globalThis as { Editor?: { Message?: unknown } }).Editor?.Message;
  return typeof message === 'object' && message !== null ? message as BroadcastMessagePort : undefined;
}

/**
 * 领域表单共享的草稿会话：dirty 表示表单相对基线有未保存修改，
 * sequence 用于让迟到的异步预览结果失效，timer 只保留最后一次输入。
 */
interface DraftSession {
  dirty: boolean;
  timer?: ReturnType<typeof setTimeout>;
  sequence: number;
}

function createDraftSession(): DraftSession {
  return { dirty: false, sequence: 0 };
}

function invalidateDraftSession(session: DraftSession): void {
  if (session.timer !== undefined) clearTimeout(session.timer);
  session.timer = undefined;
  session.sequence += 1;
}
