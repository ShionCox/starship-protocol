"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const constants_1 = require("../constants");
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
                powerGeneration: Number(getInput('powerGeneration').value),
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
            status.textContent = '正在校验当前预制体…';
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicm9vbS1jcmVhdGUuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi9zcmMvcGFuZWxzL3Jvb20tY3JlYXRlLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7O0FBQUEsNENBQTRGO0FBUTVGLE1BQU0sUUFBUSxHQUFHOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7OztRQTZCVCxDQUFDO0FBRVQsTUFBTSxLQUFLLEdBQUc7Ozs7Ozs7Ozs7O0NBV2IsQ0FBQztBQUVGLE1BQU0sQ0FBQyxPQUFPLEdBQUcsTUFBTSxDQUFDLEtBQUssQ0FBQyxNQUFNLENBQUM7SUFDbkMsUUFBUTtJQUNSLEtBQUs7SUFDTCxDQUFDLEVBQUU7UUFDRCxJQUFJLEVBQUUsT0FBTztRQUNiLE1BQU0sRUFBRSxTQUFTO1FBQ2pCLFVBQVUsRUFBRSxhQUFhO1FBQ3pCLGNBQWMsRUFBRSxpQkFBaUI7UUFDakMsTUFBTSxFQUFFLFNBQVM7UUFDakIsRUFBRSxFQUFFLEtBQUs7UUFDVCxXQUFXLEVBQUUsY0FBYztRQUMzQixRQUFRLEVBQUUsV0FBVztRQUNyQixVQUFVLEVBQUUsYUFBYTtRQUN6QixLQUFLLEVBQUUsUUFBUTtRQUNmLE1BQU0sRUFBRSxTQUFTO1FBQ2pCLFFBQVEsRUFBRSxXQUFXO1FBQ3JCLEtBQUssRUFBRSxRQUFRO1FBQ2YsUUFBUSxFQUFFLFdBQVc7UUFDckIsUUFBUSxFQUFFLFdBQVc7UUFDckIsZUFBZSxFQUFFLGtCQUFrQjtRQUNuQyxZQUFZLEVBQUUsZUFBZTtRQUM3QixXQUFXLEVBQUUsY0FBYztRQUMzQixlQUFlLEVBQUUsa0JBQWtCO0tBQ3BDO0lBQ0QsS0FBSyxDQUFDLE9BQWdDOztRQUNwQyxNQUFNLFFBQVEsR0FBRyxDQUFDLEdBQXdCLEVBQXdDLEVBQUUsQ0FDbEYsSUFBSSxDQUFDLENBQUMsQ0FBQyxHQUFHLENBQXlDLENBQUM7UUFDdEQsUUFBUSxDQUFDLGFBQWEsQ0FBQyxDQUFDLEtBQUssR0FBRyxNQUFBLE9BQU8sYUFBUCxPQUFP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U0FBUyxHQUFHLE9BQU8sQ0FBQztnQkFDM0IsTUFBTSxDQUFDLFdBQVcsR0FBRyxLQUFLLFlBQVksS0FBSyxDQUFDLENBQUMsQ0FBQyxLQUFLLENBQUMsT0FBTyxDQUFDLENBQUMsQ0FBQyxNQUFNLENBQUMsS0FBSyxDQUFDLENBQUM7WUFDOUUsQ0FBQztRQUNILENBQUMsQ0FBQyxDQUFDO0lBQ0wsQ0FBQztDQUNGLENBQUMsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IERFRkFVTFRfUFJFRkFCX0RJUkVDVE9SWSwgREVGQVVMVF9URU1QTEFURV9VUkwsIFBBQ0tBR0VfTkFNRSB9IGZyb20gJy4uL2NvbnN0YW50cyc7XG5pbXBvcnQgdHlwZSB7IFJvb21DcmVhdGlvblJlcXVlc3QsIFJvb21DcmVhdGlvblJlc3VsdCB9IGZyb20gJy4uL3Jvb21zL2NyZWF0ZS1yb29tLWNvbnRlbnQnO1xuXG5pbnRlcmZhY2UgUm9vbUNyZWF0ZVBhbmVsQ29udGV4dCB7XG4gIHJlYWRvbmx5IHRhcmdldERpcmVjdG9yeT86IHN0cmluZztcbiAgcmVhZG9ubHkgdGVtcGxhdGVVcmw/OiBzdHJpbmc7XG59XG5cbmNvbnN0IHRlbXBsYXRlID0gYFxuPGZvcm0gaWQ9XCJmb3JtXCI+XG4gIDxoMj7mlrDlu7rmiL/pl7Tlu7rnrZE8L2gyPlxuICA8ZGl2IGNsYXNzPVwiZ3JpZFwiPlxuICAgIDxsYWJlbD7nqLPlrprmiL/pl7TmoIfor4Y8aW5wdXQgaWQ9XCJpZFwiIHZhbHVlPVwicm9vbS1uZXdcIiByZXF1aXJlZD48L2xhYmVsPlxuICAgIDxsYWJlbD7kuK3mloflkI3np7A8aW5wdXQgaWQ9XCJkaXNwbGF5TmFtZVwiIHZhbHVlPVwi5paw5oi/6Ze0XCIgcmVxdWlyZWQ+PC9sYWJlbD5cbiAgICA8bGFiZWw+5oi/6Ze05YiG57G7PHNlbGVjdCBpZD1cImNhdGVnb3J5XCI+XG4gICAgICA8b3B0aW9uIHZhbHVlPVwiRU5FUkdZXCI+6IO95rqQPC9vcHRpb24+PG9wdGlvbiB2YWx1ZT1cIldFQVBPTlwiPuatpuWZqDwvb3B0aW9uPjxvcHRpb24gdmFsdWU9XCJERUZFTlNFXCI+6Ziy5b6hPC9vcHRpb24+XG4gICAgICA8b3B0aW9uIHZhbHVlPVwiTU9CSUxJVFlcIj7mnLrliqg8L29wdGlvbj48b3B0aW9uIHZhbHVlPVwiU1VQUE9SVFwiPuaUr+aPtDwvb3B0aW9uPjxvcHRpb24gdmFsdWU9XCJNT1ZFTUVOVFwiPuenu+WKqDwvb3B0aW9uPlxuICAgICAgPG9wdGlvbiB2YWx1ZT1cIlRBQ1RJQ0FMXCI+5oiY5pyvPC9vcHRpb24+PG9wdGlvbiB2YWx1ZT1cIkRST05FXCI+5peg5Lq65py6PC9vcHRpb24+PG9wdGlvbiB2YWx1ZT1cIkVDT05PTVlcIj7nu4/mtY48L29wdGlvbj48b3B0aW9uIHZhbHVlPVwiU1BFQ0lBTFwiPueJueauijwvb3B0aW9uPlxuICAgIDwvc2VsZWN0PjwvbGFiZWw+XG4gICAgPGxhYmVsPumihOWItuS9k+WQjeensDxpbnB1dCBpZD1cInByZWZhYk5hbWVcIiB2YWx1ZT1cIk5ld1Jvb21cIiByZXF1aXJlZD48L2xhYmVsPlxuICAgIDxsYWJlbD7lrr3luqbvvIjmoLzvvIk8aW5wdXQgaWQ9XCJ3aWR0aFwiIHR5cGU9XCJudW1iZXJcIiBtaW49XCIxXCIgc3RlcD1cIjFcIiB2YWx1ZT1cIjJcIiByZXF1aXJlZD48L2xhYmVsPlxuICAgIDxsYWJlbD7pq5jluqbvvIjmoLzvvIk8aW5wdXQgaWQ9XCJoZWlnaHRcIiB0eXBlPVwibnVtYmVyXCIgbWluPVwiMVwiIHN0ZXA9XCIxXCIgdmFsdWU9XCIyXCIgcmVxdWlyZWQ+PC9sYWJlbD5cbiAgICA8bGFiZWw+5pyA6auY562J57qnPGlucHV0IGlkPVwibWF4TGV2ZWxcIiB0eXBlPVwibnVtYmVyXCIgbWluPVwiMVwiIHN0ZXA9XCIxXCIgdmFsdWU9XCIxXCIgcmVxdWlyZWQ+PC9sYWJlbD5cbiAgICA8bGFiZWw+5pyA5aSn6ICQ5LmFPGlucHV0IGlkPVwibWF4SHBcIiB0eXBlPVwibnVtYmVyXCIgbWluPVwiMVwiIHN0ZXA9XCIxXCIgdmFsdWU9XCIxMDBcIiByZXF1aXJlZD48L2xhYmVsPlxuICAgIDxsYWJlbD7mnIDkvY7og73mupA8aW5wdXQgaWQ9XCJtaW5Qb3dlclwiIHR5cGU9XCJudW1iZXJcIiBtaW49XCIwXCIgc3RlcD1cIjFcIiB2YWx1ZT1cIjBcIiByZXF1aXJlZD48L2xhYmVsPlxuICAgIDxsYWJlbD7mnIDpq5jog73mupA8aW5wdXQgaWQ9XCJtYXhQb3dlclwiIHR5cGU9XCJudW1iZXJcIiBtaW49XCIwXCIgc3RlcD1cIjFcIiB2YWx1ZT1cIjBcIiByZXF1aXJlZD48L2xhYmVsPlxuICAgIDxsYWJlbD7og73mupDkuqfog708aW5wdXQgaWQ9XCJwb3dlckdlbmVyYXRpb25cIiB0eXBlPVwibnVtYmVyXCIgbWluPVwiMFwiIHN0ZXA9XCIxXCIgdmFsdWU9XCIwXCIgcmVxdWlyZWQ+PC9sYWJlbD5cbiAgICA8bGFiZWw+6Ii55ZGY5a656YePPGlucHV0IGlkPVwiY3Jld0NhcGFjaXR5XCIgdHlwZT1cIm51bWJlclwiIG1pbj1cIjBcIiBzdGVwPVwiMVwiIHZhbHVlPVwiMFwiIHJlcXVpcmVkPjwvbGFiZWw+XG4gIDwvZGl2PlxuICA8bGFiZWw+5qih5p2/6aKE5Yi25L2T6Lev5b6EPGlucHV0IGlkPVwidGVtcGxhdGVVcmxcIiByZXF1aXJlZD48L2xhYmVsPlxuICA8bGFiZWw+55uu5qCH6aKE5Yi25L2T55uu5b2VPGlucHV0IGlkPVwidGFyZ2V0RGlyZWN0b3J5XCIgcmVxdWlyZWQ+PC9sYWJlbD5cbiAgPGRpdiBjbGFzcz1cImFjdGlvbnNcIj5cbiAgICA8dWktYnV0dG9uIGlkPVwic3VibWl0XCIgY2xhc3M9XCJibHVlXCI+5Yib5bu66LWE5rqQPC91aS1idXR0b24+XG4gICAgPHVpLWJ1dHRvbiBpZD1cIm9wZW5QcmVmYWJcIiBoaWRkZW4+5omT5byA5paw6aKE5Yi25L2TPC91aS1idXR0b24+XG4gICAgPHVpLWJ1dHRvbiBpZD1cInZhbGlkYXRlUHJlZmFiXCI+5qCh6aqM5b2T5YmNIFByZWZhYjwvdWktYnV0dG9uPlxuICA8L2Rpdj5cbiAgPHByZSBpZD1cInN0YXR1c1wiIGFyaWEtbGl2ZT1cInBvbGl0ZVwiPjwvcHJlPlxuPC9mb3JtPmA7XG5cbmNvbnN0IHN0eWxlID0gYFxuOmhvc3QgeyBjb2xvcjogdmFyKC0tY29sb3Itbm9ybWFsLWNvbnRyYXN0LXdlYWtlc3QpOyBmb250OiAxM3B4IHNhbnMtc2VyaWY7IH1cbmZvcm0geyBib3gtc2l6aW5nOiBib3JkZXItYm94OyBtaW4td2lkdGg6IDA7IHBhZGRpbmc6IDE4cHg7IH1cbmgyIHsgbWFyZ2luOiAwIDAgOHB4OyBjb2xvcjogdmFyKC0tY29sb3Itbm9ybWFsLWNvbnRyYXN0KTsgfVxuLmdyaWQgeyBkaXNwbGF5OiBncmlkOyBncmlkLXRlbXBsYXRlLWNvbHVtbnM6IHJlcGVhdChhdXRvLWZpdCwgbWlubWF4KG1pbigxMDAlLCAyMjBweCksIDFmcikpOyBnYXA6IDEwcHggMTJweDsgfVxubGFiZWwgeyBkaXNwbGF5OiBmbGV4OyBmbGV4LWRpcmVjdGlvbjogY29sdW1uOyBnYXA6IDVweDsgbWFyZ2luOiA5cHggMDsgfVxuaW5wdXQsIHNlbGVjdCB7IGJveC1zaXppbmc6IGJvcmRlci1ib3g7IHdpZHRoOiAxMDAlOyBoZWlnaHQ6IDI4cHg7IHBhZGRpbmc6IDRweCA3cHg7IGNvbG9yOiBpbmhlcml0OyBiYWNrZ3JvdW5kOiB2YXIoLS1jb2xvci1ub3JtYWwtZmlsbCk7IGJvcmRlcjogMXB4IHNvbGlkIHZhcigtLWNvbG9yLW5vcm1hbC1ib3JkZXIpOyBib3JkZXItcmFkaXVzOiAzcHg7IH1cbi5hY3Rpb25zIHsgZGlzcGxheTogZmxleDsgZmxleC13cmFwOiB3cmFwOyBnYXA6IDhweDsgbWFyZ2luLXRvcDogMTRweDsgfVxuI3N0YXR1cyB7IG1pbi1oZWlnaHQ6IDU0cHg7IHdoaXRlLXNwYWNlOiBwcmUtd3JhcDsgbGluZS1oZWlnaHQ6IDEuNTsgfVxuI3N0YXR1cy5vayB7IGNvbG9yOiAjN2JkODhmOyB9XG4jc3RhdHVzLmVycm9yIHsgY29sb3I6ICNmZjc3Nzc7IH1cbmA7XG5cbm1vZHVsZS5leHBvcnRzID0gRWRpdG9yLlBhbmVsLmRlZmluZSh7XG4gIHRlbXBsYXRlLFxuICBzdHlsZSxcbiAgJDoge1xuICAgIGZvcm06ICcjZm9ybScsXG4gICAgc3VibWl0OiAnI3N1Ym1pdCcsXG4gICAgb3BlblByZWZhYjogJyNvcGVuUHJlZmFiJyxcbiAgICB2YWxpZGF0ZVByZWZhYjogJyN2YWxpZGF0ZVByZWZhYicsXG4gICAgc3RhdHVzOiAnI3N0YXR1cycsXG4gICAgaWQ6ICcjaWQnLFxuICAgIGRpc3BsYXlOYW1lOiAnI2Rpc3BsYXlOYW1lJyxcbiAgICBjYXRlZ29yeTogJyNjYXRlZ29yeScsXG4gICAgcHJlZmFiTmFtZTogJyNwcmVmYWJOYW1lJyxcbiAgICB3aWR0aDogJyN3aWR0aCcsXG4gICAgaGVpZ2h0OiAnI2hlaWdodCcsXG4gICAgbWF4TGV2ZWw6ICcjbWF4TGV2ZWwnLFxuICAgIG1heEhwOiAnI21heEhwJyxcbiAgICBtaW5Qb3dlcjogJyNtaW5Qb3dlcicsXG4gICAgbWF4UG93ZXI6ICcjbWF4UG93ZXInLFxuICAgIHBvd2VyR2VuZXJhdGlvbjogJyNwb3dlckdlbmVyYXRpb24nLFxuICAgIGNyZXdDYXBhY2l0eTogJyNjcmV3Q2FwYWNpdHknLFxuICAgIHRlbXBsYXRlVXJsOiAnI3RlbXBsYXRlVXJsJyxcbiAgICB0YXJnZXREaXJlY3Rvcnk6ICcjdGFyZ2V0RGlyZWN0b3J5JyxcbiAgfSxcbiAgcmVhZHkoY29udGV4dD86IFJvb21DcmVhdGVQYW5lbENvbnRleHQpIHtcbiAgICBjb25zdCBnZXRJbnB1dCA9IChrZXk6IGtleW9mIHR5cGVvZiB0aGlzLiQpOiBIVE1MSW5wdXRFbGVtZW50IHwgSFRNTFNlbGVjdEVsZW1lbnQgPT5cbiAgICAgIHRoaXMuJFtrZXldIGFzIEhUTUxJbnB1dEVsZW1lbnQgfCBIVE1MU2VsZWN0RWxlbWVudDtcbiAgICBnZXRJbnB1dCgndGVtcGxhdGVVcmwnKS52YWx1ZSA9IGNvbnRleHQ/LnRlbXBsYXRlVXJsID8/IERFRkFVTFRfVEVNUExBVEVfVVJMO1xuICAgIGdldElucHV0KCd0YXJnZXREaXJlY3RvcnknKS52YWx1ZSA9IGNvbnRleHQ/LnRhcmdldERpcmVjdG9yeSA/PyBERUZBVUxUX1BSRUZBQl9ESVJFQ1RPUlk7XG5cbiAgICBjb25zdCBzdGF0dXMgPSB0aGlzLiQuc3RhdHVzIGFzIEhUTUxFbGVtZW50O1xuICAgIGNvbnN0IHN1Ym1pdCA9IHRoaXMuJC5zdWJtaXQgYXMgSFRNTEJ1dHRvbkVsZW1lbnQ7XG4gICAgY29uc3Qgb3BlblByZWZhYiA9IHRoaXMuJC5vcGVuUHJlZmFiIGFzIEhUTUxCdXR0b25FbGVtZW50O1xuICAgIGNvbnN0IHZhbGlkYXRlUHJlZmFiID0gdGhpcy4kLnZhbGlkYXRlUHJlZmFiIGFzIEhUTUxCdXR0b25FbGVtZW50O1xuICAgIGxldCBjcmVhdGVkUHJlZmFiVXJsID0gJyc7XG5cbiAgICBzdWJtaXQuYWRkRXZlbnRMaXN0ZW5lcignY29uZmlybScsIGFzeW5jICgpID0+IHtcbiAgICAgIGNvbnN0IHJlcXVlc3Q6IFJvb21DcmVhdGlvblJlcXVlc3QgPSB7XG4gICAgICAgIGlkOiBnZXRJbnB1dCgnaWQnKS52YWx1ZS50cmltKCksXG4gICAgICAgIGRpc3BsYXlOYW1lOiBnZXRJbnB1dCgnZGlzcGxheU5hbWUnKS52YWx1ZS50cmltKCksXG4gICAgICAgIGNhdGVnb3J5OiBnZXRJbnB1dCgnY2F0ZWdvcnknKS52YWx1ZSxcbiAgICAgICAgcHJlZmFiTmFtZTogZ2V0SW5wdXQoJ3ByZWZhYk5hbWUnKS52YWx1ZS50cmltKCksXG4gICAgICAgIHdpZHRoOiBOdW1iZXIoZ2V0SW5wdXQoJ3dpZHRoJykudmFsdWUpLFxuICAgICAgICBoZWlnaHQ6IE51bWJlcihnZXRJbnB1dCgnaGVpZ2h0JykudmFsdWUpLFxuICAgICAgICBtYXhMZXZlbDogTnVtYmVyKGdldElucHV0KCdtYXhMZXZlbCcpLnZhbHVlKSxcbiAgICAgICAgbWF4SHA6IE51bWJlcihnZXRJbnB1dCgnbWF4SHAnKS52YWx1ZSksXG4gICAgICAgIG1pblBvd2VyOiBOdW1iZXIoZ2V0SW5wdXQoJ21pblBvd2VyJykudmFsdWUpLFxuICAgICAgICBtYXhQb3dlcjogTnVtYmVyKGdldElucHV0KCdtYXhQb3dlcicpLnZhbHVlKSxcbiAgICAgICAgcG93ZXJHZW5lcmF0aW9uOiBOdW1iZXIoZ2V0SW5wdXQoJ3Bvd2VyR2VuZXJhdGlvbicpLnZhbHVlKSxcbiAgICAgICAgY3Jld0NhcGFjaXR5OiBOdW1iZXIoZ2V0SW5wdXQoJ2NyZXdDYXBhY2l0eScpLnZhbHVlKSxcbiAgICAgICAgdGVtcGxhdGVVcmw6IGdldElucHV0KCd0ZW1wbGF0ZVVybCcpLnZhbHVlLnRyaW0oKSxcbiAgICAgICAgdGFyZ2V0RGlyZWN0b3J5OiBnZXRJbnB1dCgndGFyZ2V0RGlyZWN0b3J5JykudmFsdWUudHJpbSgpLFxuICAgICAgfTtcbiAgICAgIHN1Ym1pdC5zZXRBdHRyaWJ1dGUoJ2Rpc2FibGVkJywgJ3RydWUnKTtcbiAgICAgIHN0YXR1cy5jbGFzc05hbWUgPSAnJztcbiAgICAgIHN0YXR1cy50ZXh0Q29udGVudCA9ICfmraPlnKjliJvlu7rigKYnO1xuICAgICAgdHJ5IHtcbiAgICAgICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgRWRpdG9yLk1lc3NhZ2UucmVxdWVzdChcbiAgICAgICAgICBQQUNLQUdFX05BTUUsXG4gICAgICAgICAgJ2NyZWF0ZS1yb29tLWNvbnRlbnQnLFxuICAgICAgICAgIHJlcXVlc3QsXG4gICAgICAgICkgYXMgUm9vbUNyZWF0aW9uUmVzdWx0O1xuICAgICAgICBzdGF0dXMuY2xhc3NOYW1lID0gcmVzdWx0Lm9rID8gJ29rJyA6ICdlcnJvcic7XG4gICAgICAgIHN0YXR1cy50ZXh0Q29udGVudCA9IHJlc3VsdC5tZXNzYWdlO1xuICAgICAgICBpZiAocmVzdWx0Lm9rKSB7XG4gICAgICAgICAgY3JlYXRlZFByZWZhYlVybCA9IHJlc3VsdC5wcmVmYWJVcmw7XG4gICAgICAgICAgb3BlblByZWZhYi5oaWRkZW4gPSBmYWxzZTtcbiAgICAgICAgfVxuICAgICAgfSBjYXRjaCAoY2F1c2UpIHtcbiAgICAgICAgc3RhdHVzLmNsYXNzTmFtZSA9ICdlcnJvcic7XG4gICAgICAgIHN0YXR1cy50ZXh0Q29udGVudCA9IGNhdXNlIGluc3RhbmNlb2YgRXJyb3IgPyBjYXVzZS5tZXNzYWdlIDogU3RyaW5nKGNhdXNlKTtcbiAgICAgIH0gZmluYWxseSB7XG4gICAgICAgIHN1Ym1pdC5yZW1vdmVBdHRyaWJ1dGUoJ2Rpc2FibGVkJyk7XG4gICAgICB9XG4gICAgfSk7XG5cbiAgICBvcGVuUHJlZmFiLmFkZEV2ZW50TGlzdGVuZXIoJ2NvbmZpcm0nLCAoKSA9PiB7XG4gICAgICBpZiAoY3JlYXRlZFByZWZhYlVybCAhPT0gJycpIHtcbiAgICAgICAgRWRpdG9yLk1lc3NhZ2Uuc2VuZChQQUNLQUdFX05BTUUsICdvcGVuLWNyZWF0ZWQtcHJlZmFiJywgY3JlYXRlZFByZWZhYlVybCk7XG4gICAgICB9XG4gICAgfSk7XG5cbiAgICB2YWxpZGF0ZVByZWZhYi5hZGRFdmVudExpc3RlbmVyKCdjb25maXJtJywgYXN5bmMgKCkgPT4ge1xuICAgICAgc3RhdHVzLmNsYXNzTmFtZSA9ICcnO1xuICAgICAgc3RhdHVzLnRleHRDb250ZW50ID0gJ+ato+WcqOagoemqjOW9k+WJjemihOWItuS9k+KApic7XG4gICAgICB0cnkge1xuICAgICAgICBjb25zdCByZXN1bHQgPSBhd2FpdCBFZGl0b3IuTWVzc2FnZS5yZXF1ZXN0KFxuICAgICAgICAgIFBBQ0tBR0VfTkFNRSxcbiAgICAgICAgICAndmFsaWRhdGUtb3Blbi1yb29tLXByZWZhYicsXG4gICAgICAgICkgYXMgeyByZWFkb25seSBvazogYm9vbGVhbjsgcmVhZG9ubHkgbWVzc2FnZTogc3RyaW5nIH07XG4gICAgICAgIHN0YXR1cy5jbGFzc05hbWUgPSByZXN1bHQub2sgPyAnb2snIDogJ2Vycm9yJztcbiAgICAgICAgc3RhdHVzLnRleHRDb250ZW50ID0gcmVzdWx0Lm1lc3NhZ2U7XG4gICAgICB9IGNhdGNoIChjYXVzZSkge1xuICAgICAgICBzdGF0dXMuY2xhc3NOYW1lID0gJ2Vycm9yJztcbiAgICAgICAgc3RhdHVzLnRleHRDb250ZW50ID0gY2F1c2UgaW5zdGFuY2VvZiBFcnJvciA/IGNhdXNlLm1lc3NhZ2UgOiBTdHJpbmcoY2F1c2UpO1xuICAgICAgfVxuICAgIH0pO1xuICB9LFxufSk7XG4iXX0=