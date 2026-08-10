"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const constants_1 = require("../constants");
const template = `
<form id="form">
  <h2>新建房间建筑</h2>
  <div class="grid">
    <label>稳定房间 ID<input id="id" value="room-new" required></label>
    <label>中文名称<input id="displayName" value="新房间" required></label>
    <label>房间分类<select id="category">
      <option>ENERGY</option><option>WEAPON</option><option>DEFENSE</option>
      <option>MOBILITY</option><option>SUPPORT</option><option>MOVEMENT</option>
      <option>TACTICAL</option><option>DRONE</option><option>ECONOMY</option><option>SPECIAL</option>
    </select></label>
    <label>Prefab 名称<input id="prefabName" value="NewRoom" required></label>
    <label>宽度（格）<input id="width" type="number" min="1" step="1" value="2" required></label>
    <label>高度（格）<input id="height" type="number" min="1" step="1" value="2" required></label>
    <label>最高等级<input id="maxLevel" type="number" min="1" step="1" value="1" required></label>
    <label>最大耐久<input id="maxHp" type="number" min="1" step="1" value="100" required></label>
    <label>最低能源<input id="minPower" type="number" min="0" step="1" value="0" required></label>
    <label>最高能源<input id="maxPower" type="number" min="0" step="1" value="0" required></label>
    <label>船员容量<input id="crewCapacity" type="number" min="0" step="1" value="0" required></label>
  </div>
  <label>模板 Prefab URL<input id="templateUrl" required></label>
  <label>目标 Prefab 目录<input id="targetDirectory" required></label>
  <div class="actions">
    <ui-button id="submit" class="blue">创建资源</ui-button>
    <ui-button id="openPrefab" hidden>打开新 Prefab</ui-button>
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
        crewCapacity: '#crewCapacity',
        templateUrl: '#templateUrl',
        targetDirectory: '#targetDirectory',
    },
    ready(context) {
        var _a, _b;
        const getInput = (key) => this.$[key];
        getInput('templateUrl').value = (_a = context === null || context === void 0 ? void 0 : context.templateUrl) !== null && _a !== void 0 ? _a : constants_1.DEFAULT_TEMPLATE_URL;
        getInput('targetDirectory').value = (_b = context === null || context === void 0 ? void 0 : context.targetDirectory) !== null && _b !== void 0 ? _b : constants_1.DEFAULT_PREFAB_DIRECTORY;
        const status = this.$.status;
        const submit = this.$.submit;
        const openPrefab = this.$.openPrefab;
        const validatePrefab = this.$.validatePrefab;
        let createdPrefabUrl = '';
        submit.addEventListener('confirm', async () => {
            const request = {
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
                crewCapacity: Number(getInput('crewCapacity').value),
                templateUrl: getInput('templateUrl').value.trim(),
                targetDirectory: getInput('targetDirectory').value.trim(),
            };
            submit.setAttribute('disabled', 'true');
            status.className = '';
            status.textContent = '正在创建…';
            try {
                const result = await Editor.Message.request(constants_1.PACKAGE_NAME, 'create-room-content', request);
                status.className = result.ok ? 'ok' : 'error';
                status.textContent = result.message;
                if (result.ok) {
                    createdPrefabUrl = result.prefabUrl;
                    openPrefab.hidden = false;
                }
            }
            catch (cause) {
                status.className = 'error';
                status.textContent = cause instanceof Error ? cause.message : String(cause);
            }
            finally {
                submit.removeAttribute('disabled');
            }
        });
        openPrefab.addEventListener('confirm', () => {
            if (createdPrefabUrl !== '') {
                Editor.Message.send(constants_1.PACKAGE_NAME, 'open-created-prefab', createdPrefabUrl);
            }
        });
        validatePrefab.addEventListener('confirm', async () => {
            status.className = '';
            status.textContent = '正在校验当前 Prefab…';
            try {
                const result = await Editor.Message.request(constants_1.PACKAGE_NAME, 'validate-open-room-prefab');
                status.className = result.ok ? 'ok' : 'error';
                status.textContent = result.message;
            }
            catch (cause) {
                status.className = 'error';
                status.textContent = cause instanceof Error ? cause.message : String(cause);
            }
        });
    },
});
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicm9vbS1jcmVhdGUuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi9zcmMvcGFuZWxzL3Jvb20tY3JlYXRlLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7O0FBQUEsNENBQTRGO0FBUTVGLE1BQU0sUUFBUSxHQUFHOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O1FBNEJULENBQUM7QUFFVCxNQUFNLEtBQUssR0FBRzs7Ozs7Ozs7Ozs7Q0FXYixDQUFDO0FBRUYsTUFBTSxDQUFDLE9BQU8sR0FBRyxNQUFNLENBQUMsS0FBSyxDQUFDLE1BQU0sQ0FBQztJQUNuQyxRQUFRO0lBQ1IsS0FBSztJQUNMLENBQUMsRUFBRTtRQUNELElBQUksRUFBRSxPQUFPO1FBQ2IsTUFBTSxFQUFFLFNBQVM7UUFDakIsVUFBVSxFQUFFLGFBQWE7UUFDekIsY0FBYyxFQUFFLGlCQUFpQjtRQUNqQyxNQUFNLEVBQUUsU0FBUztRQUNqQixFQUFFLEVBQUUsS0FBSztRQUNULFdBQVcsRUFBRSxjQUFjO1FBQzNCLFFBQVEsRUFBRSxXQUFXO1FBQ3JCLFVBQVUsRUFBRSxhQUFhO1FBQ3pCLEtBQUssRUFBRSxRQUFRO1FBQ2YsTUFBTSxFQUFFLFNBQVM7UUFDakIsUUFBUSxFQUFFLFdBQVc7UUFDckIsS0FBSyxFQUFFLFFBQVE7UUFDZixRQUFRLEVBQUUsV0FBVztRQUNyQixRQUFRLEVBQUUsV0FBVztRQUNyQixZQUFZLEVBQUUsZUFBZTtRQUM3QixXQUFXLEVBQUUsY0FBYztRQUMzQixlQUFlLEVBQUUsa0JBQWtCO0tBQ3BDO0lBQ0QsS0FBSyxDQUFDLE9BQWdDOztRQUNwQyxNQUFNLFFBQVEsR0FBRyxDQUFDLEdBQXdCLEVBQXdDLEVBQUUsQ0FDbEYsSUFBSSxDQUFDLENBQUMsQ0FBQyxHQUFHLENBQXlDLENBQUM7UUFDdEQsUUFBUSxDQUFDLGFBQWEsQ0FBQyxDQUFDLEtBQUssR0FBRyxNQUFBLE9BQU8sYUFBUCxPQUFPLHVCQUFQLE9BQU8sQ0FBRSxXQUFXLG1D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LE9BQU8sQ0FBQyxDQUFDLENBQUMsTUFBTSxDQUFDLEtBQUssQ0FBQyxDQUFDO1lBQzlFLENBQUM7UUFDSCxDQUFDLENBQUMsQ0FBQztJQUNMLENBQUM7Q0FDRixDQUFDLENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgeyBERUZBVUxUX1BSRUZBQl9ESVJFQ1RPUlksIERFRkFVTFRfVEVNUExBVEVfVVJMLCBQQUNLQUdFX05BTUUgfSBmcm9tICcuLi9jb25zdGFudHMnO1xyXG5pbXBvcnQgdHlwZSB7IFJvb21DcmVhdGlvblJlcXVlc3QsIFJvb21DcmVhdGlvblJlc3VsdCB9IGZyb20gJy4uL3Jvb21zL2NyZWF0ZS1yb29tLWNvbnRlbnQnO1xyXG5cclxuaW50ZXJmYWNlIFJvb21DcmVhdGVQYW5lbENvbnRleHQge1xyXG4gIHJlYWRvbmx5IHRhcmdldERpcmVjdG9yeT86IHN0cmluZztcclxuICByZWFkb25seSB0ZW1wbGF0ZVVybD86IHN0cmluZztcclxufVxyXG5cclxuY29uc3QgdGVtcGxhdGUgPSBgXHJcbjxmb3JtIGlkPVwiZm9ybVwiPlxyXG4gIDxoMj7mlrDlu7rmiL/pl7Tlu7rnrZE8L2gyPlxyXG4gIDxkaXYgY2xhc3M9XCJncmlkXCI+XHJcbiAgICA8bGFiZWw+56iz5a6a5oi/6Ze0IElEPGlucHV0IGlkPVwiaWRcIiB2YWx1ZT1cInJvb20tbmV3XCIgcmVxdWlyZWQ+PC9sYWJlbD5cclxuICAgIDxsYWJlbD7kuK3mloflkI3np7A8aW5wdXQgaWQ9XCJkaXNwbGF5TmFtZVwiIHZhbHVlPVwi5paw5oi/6Ze0XCIgcmVxdWlyZWQ+PC9sYWJlbD5cclxuICAgIDxsYWJlbD7miL/pl7TliIbnsbs8c2VsZWN0IGlkPVwiY2F0ZWdvcnlcIj5cclxuICAgICAgPG9wdGlvbj5FTkVSR1k8L29wdGlvbj48b3B0aW9uPldFQVBPTjwvb3B0aW9uPjxvcHRpb24+REVGRU5TRTwvb3B0aW9uPlxyXG4gICAgICA8b3B0aW9uPk1PQklMSVRZPC9vcHRpb24+PG9wdGlvbj5TVVBQT1JUPC9vcHRpb24+PG9wdGlvbj5NT1ZFTUVOVDwvb3B0aW9uPlxyXG4gICAgICA8b3B0aW9uPlRBQ1RJQ0FMPC9vcHRpb24+PG9wdGlvbj5EUk9ORTwvb3B0aW9uPjxvcHRpb24+RUNPTk9NWTwvb3B0aW9uPjxvcHRpb24+U1BFQ0lBTDwvb3B0aW9uPlxyXG4gICAgPC9zZWxlY3Q+PC9sYWJlbD5cclxuICAgIDxsYWJlbD5QcmVmYWIg5ZCN56ewPGlucHV0IGlkPVwicHJlZmFiTmFtZVwiIHZhbHVlPVwiTmV3Um9vbVwiIHJlcXVpcmVkPjwvbGFiZWw+XHJcbiAgICA8bGFiZWw+5a695bqm77yI5qC877yJPGlucHV0IGlkPVwid2lkdGhcIiB0eXBlPVwibnVtYmVyXCIgbWluPVwiMVwiIHN0ZXA9XCIxXCIgdmFsdWU9XCIyXCIgcmVxdWlyZWQ+PC9sYWJlbD5cclxuICAgIDxsYWJlbD7pq5jluqbvvIjmoLzvvIk8aW5wdXQgaWQ9XCJoZWlnaHRcIiB0eXBlPVwibnVtYmVyXCIgbWluPVwiMVwiIHN0ZXA9XCIxXCIgdmFsdWU9XCIyXCIgcmVxdWlyZWQ+PC9sYWJlbD5cclxuICAgIDxsYWJlbD7mnIDpq5jnrYnnuqc8aW5wdXQgaWQ9XCJtYXhMZXZlbFwiIHR5cGU9XCJudW1iZXJcIiBtaW49XCIxXCIgc3RlcD1cIjFcIiB2YWx1ZT1cIjFcIiByZXF1aXJlZD48L2xhYmVsPlxyXG4gICAgPGxhYmVsPuacgOWkp+iAkOS5hTxpbnB1dCBpZD1cIm1heEhwXCIgdHlwZT1cIm51bWJlclwiIG1pbj1cIjFcIiBzdGVwPVwiMVwiIHZhbHVlPVwiMTAwXCIgcmVxdWlyZWQ+PC9sYWJlbD5cclxuICAgIDxsYWJlbD7mnIDkvY7og73mupA8aW5wdXQgaWQ9XCJtaW5Qb3dlclwiIHR5cGU9XCJudW1iZXJcIiBtaW49XCIwXCIgc3RlcD1cIjFcIiB2YWx1ZT1cIjBcIiByZXF1aXJlZD48L2xhYmVsPlxyXG4gICAgPGxhYmVsPuacgOmrmOiDvea6kDxpbnB1dCBpZD1cIm1heFBvd2VyXCIgdHlwZT1cIm51bWJlclwiIG1pbj1cIjBcIiBzdGVwPVwiMVwiIHZhbHVlPVwiMFwiIHJlcXVpcmVkPjwvbGFiZWw+XHJcbiAgICA8bGFiZWw+6Ii55ZGY5a656YePPGlucHV0IGlkPVwiY3Jld0NhcGFjaXR5XCIgdHlwZT1cIm51bWJlclwiIG1pbj1cIjBcIiBzdGVwPVwiMVwiIHZhbHVlPVwiMFwiIHJlcXVpcmVkPjwvbGFiZWw+XHJcbiAgPC9kaXY+XHJcbiAgPGxhYmVsPuaooeadvyBQcmVmYWIgVVJMPGlucHV0IGlkPVwidGVtcGxhdGVVcmxcIiByZXF1aXJlZD48L2xhYmVsPlxyXG4gIDxsYWJlbD7nm67moIcgUHJlZmFiIOebruW9lTxpbnB1dCBpZD1cInRhcmdldERpcmVjdG9yeVwiIHJlcXVpcmVkPjwvbGFiZWw+XHJcbiAgPGRpdiBjbGFzcz1cImFjdGlvbnNcIj5cclxuICAgIDx1aS1idXR0b24gaWQ9XCJzdWJtaXRcIiBjbGFzcz1cImJsdWVcIj7liJvlu7rotYTmupA8L3VpLWJ1dHRvbj5cclxuICAgIDx1aS1idXR0b24gaWQ9XCJvcGVuUHJlZmFiXCIgaGlkZGVuPuaJk+W8gOaWsCBQcmVmYWI8L3VpLWJ1dHRvbj5cclxuICAgIDx1aS1idXR0b24gaWQ9XCJ2YWxpZGF0ZVByZWZhYlwiPuagoemqjOW9k+WJjSBQcmVmYWI8L3VpLWJ1dHRvbj5cclxuICA8L2Rpdj5cclxuICA8cHJlIGlkPVwic3RhdHVzXCIgYXJpYS1saXZlPVwicG9saXRlXCI+PC9wcmU+XHJcbjwvZm9ybT5gO1xyXG5cclxuY29uc3Qgc3R5bGUgPSBgXHJcbjpob3N0IHsgY29sb3I6IHZhcigtLWNvbG9yLW5vcm1hbC1jb250cmFzdC13ZWFrZXN0KTsgZm9udDogMTNweCBzYW5zLXNlcmlmOyB9XHJcbmZvcm0geyBib3gtc2l6aW5nOiBib3JkZXItYm94OyBtaW4td2lkdGg6IDA7IHBhZGRpbmc6IDE4cHg7IH1cclxuaDIgeyBtYXJnaW46IDAgMCA4cHg7IGNvbG9yOiB2YXIoLS1jb2xvci1ub3JtYWwtY29udHJhc3QpOyB9XHJcbi5ncmlkIHsgZGlzcGxheTogZ3JpZDsgZ3JpZC10ZW1wbGF0ZS1jb2x1bW5zOiByZXBlYXQoYXV0by1maXQsIG1pbm1heChtaW4oMTAwJSwgMjIwcHgpLCAxZnIpKTsgZ2FwOiAxMHB4IDEycHg7IH1cclxubGFiZWwgeyBkaXNwbGF5OiBmbGV4OyBmbGV4LWRpcmVjdGlvbjogY29sdW1uOyBnYXA6IDVweDsgbWFyZ2luOiA5cHggMDsgfVxyXG5pbnB1dCwgc2VsZWN0IHsgYm94LXNpemluZzogYm9yZGVyLWJveDsgd2lkdGg6IDEwMCU7IGhlaWdodDogMjhweDsgcGFkZGluZzogNHB4IDdweDsgY29sb3I6IGluaGVyaXQ7IGJhY2tncm91bmQ6IHZhcigtLWNvbG9yLW5vcm1hbC1maWxsKTsgYm9yZGVyOiAxcHggc29saWQgdmFyKC0tY29sb3Itbm9ybWFsLWJvcmRlcik7IGJvcmRlci1yYWRpdXM6IDNweDsgfVxyXG4uYWN0aW9ucyB7IGRpc3BsYXk6IGZsZXg7IGZsZXgtd3JhcDogd3JhcDsgZ2FwOiA4cHg7IG1hcmdpbi10b3A6IDE0cHg7IH1cclxuI3N0YXR1cyB7IG1pbi1oZWlnaHQ6IDU0cHg7IHdoaXRlLXNwYWNlOiBwcmUtd3JhcDsgbGluZS1oZWlnaHQ6IDEuNTsgfVxyXG4jc3RhdHVzLm9rIHsgY29sb3I6ICM3YmQ4OGY7IH1cclxuI3N0YXR1cy5lcnJvciB7IGNvbG9yOiAjZmY3Nzc3OyB9XHJcbmA7XHJcblxyXG5tb2R1bGUuZXhwb3J0cyA9IEVkaXRvci5QYW5lbC5kZWZpbmUoe1xyXG4gIHRlbXBsYXRlLFxyXG4gIHN0eWxlLFxyXG4gICQ6IHtcclxuICAgIGZvcm06ICcjZm9ybScsXHJcbiAgICBzdWJtaXQ6ICcjc3VibWl0JyxcclxuICAgIG9wZW5QcmVmYWI6ICcjb3BlblByZWZhYicsXHJcbiAgICB2YWxpZGF0ZVByZWZhYjogJyN2YWxpZGF0ZVByZWZhYicsXHJcbiAgICBzdGF0dXM6ICcjc3RhdHVzJyxcclxuICAgIGlkOiAnI2lkJyxcclxuICAgIGRpc3BsYXlOYW1lOiAnI2Rpc3BsYXlOYW1lJyxcclxuICAgIGNhdGVnb3J5OiAnI2NhdGVnb3J5JyxcclxuICAgIHByZWZhYk5hbWU6ICcjcHJlZmFiTmFtZScsXHJcbiAgICB3aWR0aDogJyN3aWR0aCcsXHJcbiAgICBoZWlnaHQ6ICcjaGVpZ2h0JyxcclxuICAgIG1heExldmVsOiAnI21heExldmVsJyxcclxuICAgIG1heEhwOiAnI21heEhwJyxcclxuICAgIG1pblBvd2VyOiAnI21pblBvd2VyJyxcclxuICAgIG1heFBvd2VyOiAnI21heFBvd2VyJyxcclxuICAgIGNyZXdDYXBhY2l0eTogJyNjcmV3Q2FwYWNpdHknLFxyXG4gICAgdGVtcGxhdGVVcmw6ICcjdGVtcGxhdGVVcmwnLFxyXG4gICAgdGFyZ2V0RGlyZWN0b3J5OiAnI3RhcmdldERpcmVjdG9yeScsXHJcbiAgfSxcclxuICByZWFkeShjb250ZXh0PzogUm9vbUNyZWF0ZVBhbmVsQ29udGV4dCkge1xyXG4gICAgY29uc3QgZ2V0SW5wdXQgPSAoa2V5OiBrZXlvZiB0eXBlb2YgdGhpcy4kKTogSFRNTElucHV0RWxlbWVudCB8IEhUTUxTZWxlY3RFbGVtZW50ID0+XHJcbiAgICAgIHRoaXMuJFtrZXldIGFzIEhUTUxJbnB1dEVsZW1lbnQgfCBIVE1MU2VsZWN0RWxlbWVudDtcclxuICAgIGdldElucHV0KCd0ZW1wbGF0ZVVybCcpLnZhbHVlID0gY29udGV4dD8udGVtcGxhdGVVcmwgPz8gREVGQVVMVF9URU1QTEFURV9VUkw7XHJcbiAgICBnZXRJbnB1dCgndGFyZ2V0RGlyZWN0b3J5JykudmFsdWUgPSBjb250ZXh0Py50YXJnZXREaXJlY3RvcnkgPz8gREVGQVVMVF9QUkVGQUJfRElSRUNUT1JZO1xyXG5cclxuICAgIGNvbnN0IHN0YXR1cyA9IHRoaXMuJC5zdGF0dXMgYXMgSFRNTEVsZW1lbnQ7XHJcbiAgICBjb25zdCBzdWJtaXQgPSB0aGlzLiQuc3VibWl0IGFzIEhUTUxCdXR0b25FbGVtZW50O1xyXG4gICAgY29uc3Qgb3BlblByZWZhYiA9IHRoaXMuJC5vcGVuUHJlZmFiIGFzIEhUTUxCdXR0b25FbGVtZW50O1xyXG4gICAgY29uc3QgdmFsaWRhdGVQcmVmYWIgPSB0aGlzLiQudmFsaWRhdGVQcmVmYWIgYXMgSFRNTEJ1dHRvbkVsZW1lbnQ7XHJcbiAgICBsZXQgY3JlYXRlZFByZWZhYlVybCA9ICcnO1xyXG5cclxuICAgIHN1Ym1pdC5hZGRFdmVudExpc3RlbmVyKCdjb25maXJtJywgYXN5bmMgKCkgPT4ge1xyXG4gICAgICBjb25zdCByZXF1ZXN0OiBSb29tQ3JlYXRpb25SZXF1ZXN0ID0ge1xyXG4gICAgICAgIGlkOiBnZXRJbnB1dCgnaWQnKS52YWx1ZS50cmltKCksXHJcbiAgICAgICAgZGlzcGxheU5hbWU6IGdldElucHV0KCdkaXNwbGF5TmFtZScpLnZhbHVlLnRyaW0oKSxcclxuICAgICAgICBjYXRlZ29yeTogZ2V0SW5wdXQoJ2NhdGVnb3J5JykudmFsdWUsXHJcbiAgICAgICAgcHJlZmFiTmFtZTogZ2V0SW5wdXQoJ3ByZWZhYk5hbWUnKS52YWx1ZS50cmltKCksXHJcbiAgICAgICAgd2lkdGg6IE51bWJlcihnZXRJbnB1dCgnd2lkdGgnKS52YWx1ZSksXHJcbiAgICAgICAgaGVpZ2h0OiBOdW1iZXIoZ2V0SW5wdXQoJ2hlaWdodCcpLnZhbHVlKSxcclxuICAgICAgICBtYXhMZXZlbDogTnVtYmVyKGdldElucHV0KCdtYXhMZXZlbCcpLnZhbHVlKSxcclxuICAgICAgICBtYXhIcDogTnVtYmVyKGdldElucHV0KCdtYXhIcCcpLnZhbHVlKSxcclxuICAgICAgICBtaW5Qb3dlcjogTnVtYmVyKGdldElucHV0KCdtaW5Qb3dlcicpLnZhbHVlKSxcclxuICAgICAgICBtYXhQb3dlcjogTnVtYmVyKGdldElucHV0KCdtYXhQb3dlcicpLnZhbHVlKSxcclxuICAgICAgICBjcmV3Q2FwYWNpdHk6IE51bWJlcihnZXRJbnB1dCgnY3Jld0NhcGFjaXR5JykudmFsdWUpLFxyXG4gICAgICAgIHRlbXBsYXRlVXJsOiBnZXRJbnB1dCgndGVtcGxhdGVVcmwnKS52YWx1ZS50cmltKCksXHJcbiAgICAgICAgdGFyZ2V0RGlyZWN0b3J5OiBnZXRJbnB1dCgndGFyZ2V0RGlyZWN0b3J5JykudmFsdWUudHJpbSgpLFxyXG4gICAgICB9O1xyXG4gICAgICBzdWJtaXQuc2V0QXR0cmlidXRlKCdkaXNhYmxlZCcsICd0cnVlJyk7XHJcbiAgICAgIHN0YXR1cy5jbGFzc05hbWUgPSAnJztcclxuICAgICAgc3RhdHVzLnRleHRDb250ZW50ID0gJ+ato+WcqOWIm+W7uuKApic7XHJcbiAgICAgIHRyeSB7XHJcbiAgICAgICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgRWRpdG9yLk1lc3NhZ2UucmVxdWVzdChcclxuICAgICAgICAgIFBBQ0tBR0VfTkFNRSxcclxuICAgICAgICAgICdjcmVhdGUtcm9vbS1jb250ZW50JyxcclxuICAgICAgICAgIHJlcXVlc3QsXHJcbiAgICAgICAgKSBhcyBSb29tQ3JlYXRpb25SZXN1bHQ7XHJcbiAgICAgICAgc3RhdHVzLmNsYXNzTmFtZSA9IHJlc3VsdC5vayA/ICdvaycgOiAnZXJyb3InO1xyXG4gICAgICAgIHN0YXR1cy50ZXh0Q29udGVudCA9IHJlc3VsdC5tZXNzYWdlO1xyXG4gICAgICAgIGlmIChyZXN1bHQub2spIHtcclxuICAgICAgICAgIGNyZWF0ZWRQcmVmYWJVcmwgPSByZXN1bHQucHJlZmFiVXJsO1xyXG4gICAgICAgICAgb3BlblByZWZhYi5oaWRkZW4gPSBmYWxzZTtcclxuICAgICAgICB9XHJcbiAgICAgIH0gY2F0Y2ggKGNhdXNlKSB7XHJcbiAgICAgICAgc3RhdHVzLmNsYXNzTmFtZSA9ICdlcnJvcic7XHJcbiAgICAgICAgc3RhdHVzLnRleHRDb250ZW50ID0gY2F1c2UgaW5zdGFuY2VvZiBFcnJvciA/IGNhdXNlLm1lc3NhZ2UgOiBTdHJpbmcoY2F1c2UpO1xyXG4gICAgICB9IGZpbmFsbHkge1xyXG4gICAgICAgIHN1Ym1pdC5yZW1vdmVBdHRyaWJ1dGUoJ2Rpc2FibGVkJyk7XHJcbiAgICAgIH1cclxuICAgIH0pO1xyXG5cclxuICAgIG9wZW5QcmVmYWIuYWRkRXZlbnRMaXN0ZW5lcignY29uZmlybScsICgpID0+IHtcclxuICAgICAgaWYgKGNyZWF0ZWRQcmVmYWJVcmwgIT09ICcnKSB7XHJcbiAgICAgICAgRWRpdG9yLk1lc3NhZ2Uuc2VuZChQQUNLQUdFX05BTUUsICdvcGVuLWNyZWF0ZWQtcHJlZmFiJywgY3JlYXRlZFByZWZhYlVybCk7XHJcbiAgICAgIH1cclxuICAgIH0pO1xyXG5cclxuICAgIHZhbGlkYXRlUHJlZmFiLmFkZEV2ZW50TGlzdGVuZXIoJ2NvbmZpcm0nLCBhc3luYyAoKSA9PiB7XHJcbiAgICAgIHN0YXR1cy5jbGFzc05hbWUgPSAnJztcclxuICAgICAgc3RhdHVzLnRleHRDb250ZW50ID0gJ+ato+WcqOagoemqjOW9k+WJjSBQcmVmYWLigKYnO1xyXG4gICAgICB0cnkge1xyXG4gICAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IEVkaXRvci5NZXNzYWdlLnJlcXVlc3QoXHJcbiAgICAgICAgICBQQUNLQUdFX05BTUUsXHJcbiAgICAgICAgICAndmFsaWRhdGUtb3Blbi1yb29tLXByZWZhYicsXHJcbiAgICAgICAgKSBhcyB7IHJlYWRvbmx5IG9rOiBib29sZWFuOyByZWFkb25seSBtZXNzYWdlOiBzdHJpbmcgfTtcclxuICAgICAgICBzdGF0dXMuY2xhc3NOYW1lID0gcmVzdWx0Lm9rID8gJ29rJyA6ICdlcnJvcic7XHJcbiAgICAgICAgc3RhdHVzLnRleHRDb250ZW50ID0gcmVzdWx0Lm1lc3NhZ2U7XHJcbiAgICAgIH0gY2F0Y2ggKGNhdXNlKSB7XHJcbiAgICAgICAgc3RhdHVzLmNsYXNzTmFtZSA9ICdlcnJvcic7XHJcbiAgICAgICAgc3RhdHVzLnRleHRDb250ZW50ID0gY2F1c2UgaW5zdGFuY2VvZiBFcnJvciA/IGNhdXNlLm1lc3NhZ2UgOiBTdHJpbmcoY2F1c2UpO1xyXG4gICAgICB9XHJcbiAgICB9KTtcclxuICB9LFxyXG59KTtcclxuIl19