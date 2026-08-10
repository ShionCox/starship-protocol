import { DEFAULT_PREFAB_DIRECTORY, DEFAULT_TEMPLATE_URL, PACKAGE_NAME } from '../constants';
import type { AuthoringState } from '../main';
import type { RoomDefinitionEditRequest } from '../rooms/edit-room-definition';
import type { RoomPrefabCatalogEntry } from '../rooms/discover-room-prefabs';

type PageId = 'scene' | 'rooms' | 'validation';

const ROOM_CATEGORIES = [
  ['ALL', '全部'],
  ['ENERGY', '能源'],
  ['WEAPON', '武器'],
  ['DEFENSE', '防御'],
  ['MOBILITY', '机动'],
  ['SUPPORT', '支援'],
  ['TACTICAL', '战术'],
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
      <button id="navRooms" class="nav-item" data-page="rooms"><span class="nav-icon">房</span><span>房间建筑</span></button>
      <div class="nav-divider"></div>
      <button id="navValidation" class="nav-item" data-page="validation"><span class="nav-icon">验</span><span>校验</span><em id="navWarningCount">0</em></button>
    </nav>
    <main class="content">
      <section id="pageScene" class="page">
        <div class="page-heading"><div><h2>场景</h2></div><span id="sceneBadge" class="badge neutral">读取中</span></div>
        <section class="panel-card scene-card">
          <div class="info-grid">
            <div class="info-item"><span class="label">当前选择</span><span id="selection" class="value">正在读取…</span></div>
            <div class="info-item"><span class="label">房间容器</span><span id="target" class="value">正在读取…</span></div>
          </div>
          <div class="actions"><ui-button id="initialize" class="blue primary-action">补齐场景骨架</ui-button><ui-button id="sceneRefresh">重新校验</ui-button></div>
        </section>
      </section>

      <section id="pageRooms" class="page" hidden>
        <div class="page-heading"><div><h2>房间建筑</h2></div><div class="heading-actions"><span id="roomCount" class="count">0 个</span><ui-button id="newRoom" class="blue">新建定义</ui-button></div></div>
        <div class="toolbar"><input id="roomSearch" class="search" placeholder="搜索名称或稳定 ID" autocomplete="off"><div id="roomCategories" class="category-tabs"></div></div>
        <div class="room-workspace"><section class="panel-card asset-list-card"><div class="list-heading"><span>已发现资源</span></div><div id="list"></div></section><aside id="roomInspector" class="panel-card inspector" hidden><div class="inspector-heading"><div><h3 id="editTitle">房间属性</h3></div><span id="editState" class="badge neutral">未修改</span></div><div class="asset-path"><span id="editId">—</span><span id="editPath">—</span></div><div class="form-grid"><label>中文名称<input id="editDisplayName" type="text"></label><label>房间分类<select id="editCategory"><option value="ENERGY">能源</option><option value="WEAPON">武器</option><option value="DEFENSE">防御</option><option value="MOBILITY">机动</option><option value="SUPPORT">支援</option><option value="MOVEMENT">移动</option><option value="TACTICAL">战术</option><option value="DRONE">无人机</option><option value="ECONOMY">经济</option><option value="SPECIAL">特殊</option></select></label><label>宽度（格）<input id="editWidth" type="number" min="1" step="1"></label><label>高度（格）<input id="editHeight" type="number" min="1" step="1"></label><label>最高等级<input id="editMaxLevel" type="number" min="1" step="1"></label><label>最大耐久<input id="editMaxHp" type="number" min="1" step="1"></label><label>最低能源<input id="editMinPower" type="number" min="0" step="1"></label><label>最高能源<input id="editMaxPower" type="number" min="0" step="1"></label><label>船员容量<input id="editCrewCapacity" type="number" min="0" step="1"></label></div><div class="inspector-actions"><ui-button id="saveRoom" class="blue primary-action">保存属性</ui-button><ui-button id="createSelectedRoom">创建实例</ui-button><ui-button id="openSelectedPrefab">打开 Prefab</ui-button></div></aside><div id="roomEmpty" class="panel-card empty-state"><h3>选择一个资源</h3></div></div>
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
.badge,.count { flex:0 0 auto; border-radius:999px; font-size:11px; white-space:nowrap; }.badge { padding:4px 8px; border:1px solid var(--color-normal-border); }.badge.ok { color:#8fe0b1; border-color:rgba(105,202,153,.4); background:rgba(105,202,153,.1); }.badge.warn { color:#f0cd78; border-color:rgba(240,205,120,.35); background:rgba(240,205,120,.08); }.badge.neutral,.count { color:var(--color-normal-contrast-weaker); }.toolbar { display:flex; flex-wrap:wrap; align-items:center; justify-content:space-between; gap:8px 12px; margin-bottom:12px; }.search { box-sizing:border-box; width:min(310px,100%); min-width:0; flex:1 1 180px; height:30px; padding:5px 9px; color:var(--color-normal-contrast); background:var(--color-normal-fill); border:1px solid var(--color-normal-border); border-radius:4px; outline:none; }.search:focus,input:focus,select:focus { border-color:#3ea9d1; }.category-tabs { display:flex; min-width:0; flex:1 1 220px; flex-wrap:wrap; gap:4px; }.category-tab { padding:5px 9px; border:1px solid transparent; border-radius:4px; background:transparent; color:var(--color-normal-contrast-weaker); cursor:pointer; }.category-tab:hover { background:rgba(255,255,255,.06); color:var(--color-normal-contrast); }.category-tab.active { border-color:rgba(59,169,210,.45); background:rgba(45,156,200,.16); color:#8bdaf3; }.room-workspace { display:grid; grid-template-columns:repeat(auto-fit,minmax(min(100%,300px),1fr)); gap:12px; align-items:start; }.asset-list-card { min-width:0; min-height:310px; padding:12px 14px; }.list-heading { justify-content:space-between; padding-bottom:10px; color:var(--color-normal-contrast); font-weight:600; }.room { display:flex; flex-wrap:wrap; align-items:center; justify-content:space-between; gap:8px 10px; padding:11px 4px; border-top:1px solid var(--color-normal-border); cursor:pointer; }.room:hover,.room.selected { background:rgba(255,255,255,.04); }.room.selected { box-shadow:inset 2px 0 #39a9d1; }.room-main { min-width:0; flex:1 1 120px; }.room-name { display:block; overflow:hidden; color:var(--color-normal-contrast); font-weight:600; text-overflow:ellipsis; white-space:nowrap; }.room-meta { display:flex; flex-wrap:wrap; gap:7px; margin-top:3px; color:var(--color-normal-contrast-weaker); font-size:11px; }.room-category { color:#8eb9e8; }.room-id { overflow:hidden; max-width:160px; text-overflow:ellipsis; white-space:nowrap; }.room-actions { display:flex; flex:0 0 auto; gap:5px; }.room ui-button { min-width:54px; }.inspector { min-width:0; padding:15px; }.inspector-heading { justify-content:space-between; align-items:flex-start; }.inspector-heading h3 { margin:2px 0 0; color:var(--color-normal-contrast); font-size:16px; }.asset-path { display:flex; flex-direction:column; gap:2px; min-width:0; margin:13px 0; padding:8px 9px; border-radius:4px; background:rgba(0,0,0,.14); }.asset-path span:first-child { color:#8bdaf3; font-weight:600; }.asset-path span:last-child { overflow:hidden; color:var(--color-normal-contrast-weaker); font-size:10px; text-overflow:ellipsis; white-space:nowrap; }.form-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(min(100%,160px),1fr)); gap:10px; }.form-grid label { display:flex; min-width:0; flex-direction:column; gap:5px; color:var(--color-normal-contrast-weaker); font-size:11px; }.form-grid input,.form-grid select { box-sizing:border-box; width:100%; height:29px; padding:4px 7px; color:var(--color-normal-contrast); background:var(--color-normal-fill); border:1px solid var(--color-normal-border); border-radius:3px; }.empty-state { display:flex; flex-direction:column; align-items:center; justify-content:center; min-height:250px; padding:25px; text-align:center; }.empty-state h3 { margin:10px 0 5px; color:var(--color-normal-contrast); font-size:16px; }.validation-summary { color:var(--color-normal-contrast); font-weight:600; }.validation-list { margin-top:12px; }.validation-item { padding:9px 10px; border-top:1px solid var(--color-normal-border); color:#f0cd78; font-size:12px; white-space:pre-wrap; }.validation-ok { color:#8fe0b1; }.warning { margin-top:10px; padding:9px 10px; border-left:2px solid #e8c46a; background:rgba(232,196,106,.08); color:#e8c46a; white-space:pre-wrap; }.empty { padding:28px 5px; color:var(--color-normal-contrast-weaker); text-align:center; }.hidden { display:none !important; }#status { display:none; margin-top:12px; padding:9px 10px; border-radius:4px; white-space:pre-wrap; }.content > #status.visible { display:block; }.content > #status.info { color:var(--color-normal-contrast-weaker); background:rgba(255,255,255,.05); }.content > #status.ok { color:#8fe0b1; background:rgba(105,202,153,.1); }.content > #status.error { color:#ff9696; background:rgba(255,110,110,.1); }
@media (max-width:760px) { .workbench { grid-template-columns:62px minmax(0,1fr); }.sidebar { padding:12px 8px; }.nav-item > span:not(.nav-icon),.nav-item em { display:none; }.nav-item { justify-content:center; padding:0; }.content { padding:12px; }.inspector { order:-1; } }
@media (max-width:520px) { .heading-actions { width:100%; }.topbar { padding:0 12px; }.sync { font-size:0; }.sync i { margin-right:2px; } }
`;

let stopPolling: (() => void) | undefined;
let startPolling: (() => void) | undefined;

module.exports = Editor.Panel.define({
  template,
  style,
  $: {
    selection: '#selection', target: '#target', sceneBadge: '#sceneBadge', roomCount: '#roomCount',
    navWarningCount: '#navWarningCount', newRoom: '#newRoom', sync: '#sync', initialize: '#initialize', sceneRefresh: '#sceneRefresh',
    refresh: '#refresh', list: '#list', status: '#status', roomSearch: '#roomSearch', roomCategories: '#roomCategories',
    roomInspector: '#roomInspector', roomEmpty: '#roomEmpty', editTitle: '#editTitle', editState: '#editState', editId: '#editId', editPath: '#editPath',
    editDisplayName: '#editDisplayName', editCategory: '#editCategory', editWidth: '#editWidth', editHeight: '#editHeight', editMaxLevel: '#editMaxLevel',
    editMaxHp: '#editMaxHp', editMinPower: '#editMinPower', editMaxPower: '#editMaxPower', editCrewCapacity: '#editCrewCapacity', saveRoom: '#saveRoom',
    createSelectedRoom: '#createSelectedRoom', openSelectedPrefab: '#openSelectedPrefab', validationSummary: '#validationSummary', validationList: '#validationList',
    navScene: '#navScene', navRooms: '#navRooms', navValidation: '#navValidation',
    pageScene: '#pageScene', pageRooms: '#pageRooms', pageValidation: '#pageValidation',
  },
  listeners: {
    show() { startPolling?.(); },
    hide() { stopPolling?.(); },
  },
  ready() {
    const el = <T extends HTMLElement>(key: string): T => (this.$ as unknown as Record<string, HTMLElement | null>)[key] as T;
    const selection = el<HTMLElement>('selection');
    const target = el<HTMLElement>('target');
    const sceneBadge = el<HTMLElement>('sceneBadge');
    const roomCount = el<HTMLElement>('roomCount');
    const navWarningCount = el<HTMLElement>('navWarningCount');
    const newRoom = el<HTMLElement>('newRoom');
    const sync = el<HTMLElement>('sync');
    const initialize = el<HTMLElement>('initialize');
    const sceneRefresh = el<HTMLElement>('sceneRefresh');
    const refresh = el<HTMLElement>('refresh');
    const list = el<HTMLElement>('list');
    const status = el<HTMLElement>('status');
    const roomSearch = el<HTMLInputElement>('roomSearch');
    const roomCategories = el<HTMLElement>('roomCategories');
    const roomInspector = el<HTMLElement>('roomInspector');
    const roomEmpty = el<HTMLElement>('roomEmpty');
    const editState = el<HTMLElement>('editState');
    const editId = el<HTMLElement>('editId');
    const editPath = el<HTMLElement>('editPath');
    const editTitle = el<HTMLElement>('editTitle');
    const saveRoom = el<HTMLElement>('saveRoom');
    const createSelectedRoom = el<HTMLElement>('createSelectedRoom');
    const openSelectedPrefab = el<HTMLElement>('openSelectedPrefab');
    const validationSummary = el<HTMLElement>('validationSummary');
    const validationList = el<HTMLElement>('validationList');
    const pages: Record<PageId, HTMLElement> = {
      scene: el('pageScene'), rooms: el('pageRooms'), validation: el('pageValidation'),
    };
    const nav: Record<PageId, HTMLElement> = {
      scene: el('navScene'), rooms: el('navRooms'), validation: el('navValidation'),
    };
    const field = (key: string): HTMLInputElement | HTMLSelectElement => el<HTMLInputElement | HTMLSelectElement>(key);
    let timer: ReturnType<typeof setInterval> | undefined;
    let lastSelectionKey = '';
    let state: AuthoringState | undefined;
    let activePage: PageId = 'scene';
    let activeCategory = 'ALL';
    let selectedRoomId = '';
    let roomEntries: readonly RoomPrefabCatalogEntry[] = [];

    const showStatus = (message: string, ok?: boolean): void => {
      status.className = `visible ${ok === undefined ? 'info' : ok ? 'ok' : 'error'}`;
      status.textContent = message;
    };

    const setPage = (page: PageId): void => {
      activePage = page;
      for (const [key, button] of Object.entries(nav)) {
        button.className = `nav-item${key === page ? ' active' : ''}`;
        button.setAttribute('aria-current', key === page ? 'page' : 'false');
      }
      for (const [key, section] of Object.entries(pages)) section.hidden = key !== page;
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
        const ok = document.createElement('div'); ok.className = 'validation-item validation-ok'; ok.textContent = '✓ 房间定义、Prefab 依赖和场景目录均已读取'; validationList.append(ok);
      } else {
        for (const warning of warnings) { const item = document.createElement('div'); item.className = 'validation-item'; item.textContent = warning; validationList.append(item); }
      }
    };

    const renderInspector = (): void => {
      const entry = roomEntries.find((item) => item.id === selectedRoomId);
      if (entry === undefined) { roomInspector.hidden = true; roomEmpty.hidden = false; return; }
      roomInspector.hidden = false; roomEmpty.hidden = true; editState.textContent = '已加载'; editState.className = 'badge ok'; editTitle.textContent = entry.displayName; editId.textContent = entry.id; editPath.textContent = entry.configUrl;
      field('editDisplayName').value = entry.displayName; field('editCategory').value = entry.category; field('editWidth').value = String(entry.width); field('editHeight').value = String(entry.height); field('editMaxLevel').value = String(entry.maxLevel); field('editMaxHp').value = String(entry.maxHp); field('editMinPower').value = String(entry.minPower); field('editMaxPower').value = String(entry.maxPower); field('editCrewCapacity').value = String(entry.crewCapacity);
    };

    const renderRoomList = (): void => {
      list.replaceChildren();
      const query = roomSearch.value.trim().toLowerCase();
      const visible = roomEntries.filter((entry) => (activeCategory === 'ALL' || entry.category === activeCategory) && (query === '' || entry.displayName.toLowerCase().includes(query) || entry.id.toLowerCase().includes(query)));
      if (visible.length === 0) { const empty = document.createElement('div'); empty.className = 'empty'; empty.textContent = roomEntries.length === 0 ? '暂无可用房间，请从资源管理器右键创建定义' : '没有符合筛选条件的房间'; list.append(empty); }
      for (const entry of visible) appendRoomEntry(list, entry, selectedRoomId === entry.id, state?.roomTarget.ok === true, () => { selectedRoomId = entry.id; renderRoomList(); renderInspector(); }, async () => {
        showStatus(`正在创建 ${entry.displayName}…`);
        try { const result = await Editor.Message.request(PACKAGE_NAME, 'create-room-instance', entry) as { ok: boolean; message: string }; showStatus(result.message, result.ok); await refreshState(true); } catch (cause) { showStatus(cause instanceof Error ? cause.message : String(cause), false); }
      });
      renderInspector();
    };

    const render = (next: AuthoringState): void => {
      state = next; roomEntries = next.rooms; selection.textContent = next.selection.uuid === undefined ? '未选择节点' : next.selection.name ?? '未命名节点'; selection.className = next.selection.uuid === undefined ? 'value muted' : 'value'; selection.title = next.selection.name ?? ''; target.textContent = next.roomTarget.ok ? next.roomTarget.path ?? '标准房间容器' : next.roomTarget.message; target.className = next.roomTarget.ok ? 'value' : 'value muted'; target.title = next.roomTarget.path ?? next.roomTarget.message; sceneBadge.textContent = next.roomTarget.ok ? '场景可用' : '需要处理'; sceneBadge.className = `badge ${next.roomTarget.ok ? 'ok' : 'warn'}`; roomCount.textContent = `${next.rooms.length} 个`; navWarningCount.textContent = String(next.warnings.length); sync.innerHTML = '<i></i>已同步'; initialize.removeAttribute('disabled'); renderCategories(); renderRoomList(); renderValidation(next); setPage(activePage);
    };

    const refreshState = async (force: boolean): Promise<void> => {
      const selected = Editor.Selection.getSelected('node')?.[0] ?? '';
      if (!force && selected === lastSelectionKey && state !== undefined) return;
      lastSelectionKey = selected;
      try { render(await Editor.Message.request(PACKAGE_NAME, force ? 'refresh-authoring-state' : 'get-authoring-state') as AuthoringState); } catch (cause) { sync.innerHTML = '<i></i>读取失败'; showStatus(cause instanceof Error ? cause.message : String(cause), false); }
    };

    const readEditRequest = (): RoomDefinitionEditRequest | null => {
      const entry = roomEntries.find((item) => item.id === selectedRoomId); if (entry === undefined) return null;
      return { configUrl: entry.configUrl, id: entry.id, displayName: field('editDisplayName').value.trim(), category: field('editCategory').value, width: Number(field('editWidth').value), height: Number(field('editHeight').value), maxLevel: Number(field('editMaxLevel').value), maxHp: Number(field('editMaxHp').value), minPower: Number(field('editMinPower').value), maxPower: Number(field('editMaxPower').value), crewCapacity: Number(field('editCrewCapacity').value) };
    };

    for (const [page, button] of Object.entries(nav) as [PageId, HTMLElement][]) button.addEventListener('click', () => setPage(page));
    for (const key of ['editDisplayName', 'editCategory', 'editWidth', 'editHeight', 'editMaxLevel', 'editMaxHp', 'editMinPower', 'editMaxPower', 'editCrewCapacity']) {
      field(key).addEventListener('input', () => { editState.textContent = '未保存'; editState.className = 'badge warn'; });
    }
    roomSearch.addEventListener('input', renderRoomList);
    saveRoom.addEventListener('confirm', async () => { const request = readEditRequest(); if (request === null) return; editState.textContent = '保存中…'; try { const result = await Editor.Message.request(PACKAGE_NAME, 'update-room-definition', request) as { ok: boolean; message: string }; showStatus(result.message, result.ok); if (result.ok) { editState.textContent = '已保存'; await refreshState(true); } else editState.textContent = '校验失败'; } catch (cause) { editState.textContent = '保存失败'; showStatus(cause instanceof Error ? cause.message : String(cause), false); } });
    createSelectedRoom.addEventListener('confirm', () => { const entry = roomEntries.find((item) => item.id === selectedRoomId); if (entry === undefined) return; void (async () => { showStatus(`正在创建 ${entry.displayName}…`); try { const result = await Editor.Message.request(PACKAGE_NAME, 'create-room-instance', entry) as { ok: boolean; message: string }; showStatus(result.message, result.ok); await refreshState(true); } catch (cause) { showStatus(cause instanceof Error ? cause.message : String(cause), false); } })(); });
    openSelectedPrefab.addEventListener('confirm', () => { const entry = roomEntries.find((item) => item.id === selectedRoomId); if (entry !== undefined) Editor.Message.send(PACKAGE_NAME, 'open-created-prefab', entry.prefabUrl); });
    initialize.addEventListener('confirm', async () => { showStatus('正在初始化 Prototype 场景骨架…'); try { const result = await Editor.Message.request(PACKAGE_NAME, 'initialize-prototype-scene') as { ok: boolean; message: string }; showStatus(result.message, result.ok); await refreshState(true); } catch (cause) { showStatus(cause instanceof Error ? cause.message : String(cause), false); } });
    sceneRefresh.addEventListener('confirm', () => { void refreshState(true); }); refresh.addEventListener('confirm', () => { void refreshState(true); });
    newRoom.addEventListener('confirm', () => Editor.Message.send(PACKAGE_NAME, 'open-room-create', { targetDirectory: DEFAULT_PREFAB_DIRECTORY, templateUrl: DEFAULT_TEMPLATE_URL }));
    setPage('scene'); renderCategories();
    startPolling = () => { if (timer !== undefined) return; void refreshState(true); timer = setInterval(() => { void refreshState(false); }, 500); };
    stopPolling = () => { if (timer !== undefined) clearInterval(timer); timer = undefined; };
    startPolling();
  },
  beforeClose() { stopPolling?.(); },
  close() { stopPolling?.(); stopPolling = undefined; startPolling = undefined; },
});

function appendRoomEntry(list: HTMLElement, entry: RoomPrefabCatalogEntry, selected: boolean, canCreate: boolean, onSelect: () => void, onCreate: () => Promise<void>): void {
  const row = document.createElement('div'); row.className = `room${selected ? ' selected' : ''}`; row.title = `稳定 ID：${entry.id}`; row.addEventListener('click', onSelect);
  const main = document.createElement('div'); main.className = 'room-main'; const label = document.createElement('span'); label.className = 'room-name'; label.textContent = entry.displayName; const meta = document.createElement('div'); meta.className = 'room-meta'; const category = document.createElement('span'); category.className = 'room-category'; category.textContent = translateCategory(entry.category); const size = document.createElement('span'); size.textContent = `${entry.width} × ${entry.height} 格`; const id = document.createElement('span'); id.className = 'room-id'; id.textContent = entry.id; meta.append(category, size, id); main.append(label, meta);
  const actions = document.createElement('div'); actions.className = 'room-actions'; const create = document.createElement('ui-button'); create.textContent = '创建'; if (!canCreate) create.setAttribute('disabled', 'true'); create.addEventListener('confirm', (event) => { event.stopPropagation?.(); void onCreate(); }); actions.append(create); row.append(main, actions); list.append(row);
}

function translateCategory(category: string): string { return ({ ENERGY: '能源', WEAPON: '武器', DEFENSE: '防御', MOBILITY: '机动', SUPPORT: '支援', MOVEMENT: '移动', TACTICAL: '战术', DRONE: '无人机', ECONOMY: '经济', SPECIAL: '特殊' } as Record<string, string>)[category] ?? category; }
