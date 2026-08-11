import { DEFAULT_PREFAB_DIRECTORY, DEFAULT_TEMPLATE_URL, PACKAGE_NAME } from '../constants';
import type { RoomCreationRequest, RoomCreationResult } from '../rooms/create-room-content';

interface RoomCreatePanelContext {
  readonly targetDirectory?: string;
  readonly templateUrl?: string;
}

const template = `
<form id="form">
  <h2>新建房间建筑</h2>
  <div class="grid">
    <label>稳定房间标识<input id="id" value="room-new" required></label>
    <label>中文名称<input id="displayName" value="新房间" required></label>
    <label>房间分类<select id="category">
      <option value="ENERGY">能源</option><option value="WEAPON">武器</option><option value="DEFENSE">防御</option>
      <option value="MOBILITY">机动</option><option value="SUPPORT">支援</option><option value="MOVEMENT">移动</option>
      <option value="TACTICAL">战术</option><option value="DRONE">无人机</option><option value="ECONOMY">经济</option><option value="SPECIAL">特殊</option>
    </select></label>
    <label>预制体名称<input id="prefabName" value="NewRoom" required></label>
    <label>宽度（格）<input id="width" type="number" min="1" step="1" value="2" required></label>
    <label>高度（格）<input id="height" type="number" min="1" step="1" value="2" required></label>
    <label>最高等级<input id="maxLevel" type="number" min="1" step="1" value="1" required></label>
    <label>最大耐久<input id="maxHp" type="number" min="1" step="1" value="100" required></label>
    <label>最低能源<input id="minPower" type="number" min="0" step="1" value="0" required></label>
    <label>最高能源<input id="maxPower" type="number" min="0" step="1" value="0" required></label>
    <label>能源产能<input id="powerGeneration" type="number" min="0" step="1" value="0" required></label>
    <label>船员容量<input id="crewCapacity" type="number" min="0" step="1" value="0" required></label>
  </div>
  <label>模板预制体路径<input id="templateUrl" required></label>
  <label>目标预制体目录<input id="targetDirectory" required></label>
  <div class="actions">
    <ui-button id="submit" class="blue">创建资源</ui-button>
    <ui-button id="openPrefab" hidden>打开新预制体</ui-button>
    <ui-button id="validatePrefab">校验当前 Prefab</ui-button>
  </div>
  <pre id="status" aria-live="polite"></pre>
</form>`;

const style = `
:host { color: var(--color-normal-contrast-weakest); font: 13px sans-serif; }
form { box-sizing: border-box; min-width: 0; padding: 18px; }
h2 { margin: 0 0 8px; color: var(--color-normal-contrast); }
.grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 220px), 1fr)); gap: 10px 12px; }
label { display: flex; flex-direction: column; gap: 5px; margin: 9px 0; }
input, select { box-sizing: border-box; width: 100%; height: 28px; padding: 4px 7px; color: inherit; background: var(--color-normal-fill); border: 1px solid var(--color-normal-border); border-radius: 3px; }
.actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 14px; }
#status { min-height: 54px; white-space: pre-wrap; line-height: 1.5; }
#status.ok { color: #7bd88f; }
#status.error { color: #ff7777; }
`;

module.exports = Editor.Panel.define({
  template,
  style,
  $: {
    form: '#form',
    submit: '#submit',
    openPrefab: '#openPrefab',
    validatePrefab: '#validatePrefab',
    status: '#status',
    id: '#id',
    displayName: '#displayName',
    category: '#category',
    prefabName: '#prefabName',
    width: '#width',
    height: '#height',
    maxLevel: '#maxLevel',
    maxHp: '#maxHp',
    minPower: '#minPower',
    maxPower: '#maxPower',
    powerGeneration: '#powerGeneration',
    crewCapacity: '#crewCapacity',
    templateUrl: '#templateUrl',
    targetDirectory: '#targetDirectory',
  },
  ready(context?: RoomCreatePanelContext) {
    const getInput = (key: keyof typeof this.$): HTMLInputElement | HTMLSelectElement =>
      this.$[key] as HTMLInputElement | HTMLSelectElement;
    getInput('templateUrl').value = context?.templateUrl ?? DEFAULT_TEMPLATE_URL;
    getInput('targetDirectory').value = context?.targetDirectory ?? DEFAULT_PREFAB_DIRECTORY;

    const status = this.$.status as HTMLElement;
    const submit = this.$.submit as HTMLButtonElement;
    const openPrefab = this.$.openPrefab as HTMLButtonElement;
    const validatePrefab = this.$.validatePrefab as HTMLButtonElement;
    let createdPrefabUrl = '';

    submit.addEventListener('confirm', async () => {
      const request: RoomCreationRequest = {
        id: getInput('id').value.trim(),
        displayName: getInput('displayName').value.trim(),
        category: getInput('category').value,
        prefabName: getInput('prefabName').value.trim(),
        width: Number(getInput('width').value),
        height: Number(getInput('height').value),
        maxLevel: Number(getInput('maxLevel').value),
        maxHp: Number(getInput('maxHp').value),
        minPower: Number(getInput('minPower').value),
        maxPower: Number(getInput('maxPower').value),
        powerGeneration: Number(getInput('powerGeneration').value),
        crewCapacity: Number(getInput('crewCapacity').value),
        templateUrl: getInput('templateUrl').value.trim(),
        targetDirectory: getInput('targetDirectory').value.trim(),
      };
      submit.setAttribute('disabled', 'true');
      status.className = '';
      status.textContent = '正在创建…';
      try {
        const result = await Editor.Message.request(
          PACKAGE_NAME,
          'create-room-content',
          request,
        ) as RoomCreationResult;
        status.className = result.ok ? 'ok' : 'error';
        status.textContent = result.message;
        if (result.ok) {
          createdPrefabUrl = result.prefabUrl;
          openPrefab.hidden = false;
        }
      } catch (cause) {
        status.className = 'error';
        status.textContent = cause instanceof Error ? cause.message : String(cause);
      } finally {
        submit.removeAttribute('disabled');
      }
    });

    openPrefab.addEventListener('confirm', () => {
      if (createdPrefabUrl !== '') {
        Editor.Message.send(PACKAGE_NAME, 'open-created-prefab', createdPrefabUrl);
      }
    });

    validatePrefab.addEventListener('confirm', async () => {
      status.className = '';
      status.textContent = '正在校验当前预制体…';
      try {
        const result = await Editor.Message.request(
          PACKAGE_NAME,
          'validate-open-room-prefab',
        ) as { readonly ok: boolean; readonly message: string };
        status.className = result.ok ? 'ok' : 'error';
        status.textContent = result.message;
      } catch (cause) {
        status.className = 'error';
        status.textContent = cause instanceof Error ? cause.message : String(cause);
      }
    });
  },
});
