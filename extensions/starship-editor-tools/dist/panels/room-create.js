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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicm9vbS1jcmVhdGUuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi9zcmMvcGFuZWxzL3Jvb20tY3JlYXRlLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7O0FBQUEsNENBQTRGO0FBUTVGLE1BQU0sUUFBUSxHQUFHOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O1FBNEJULENBQUM7QUFFVCxNQUFNLEtBQUssR0FBRzs7Ozs7Ozs7Ozs7Q0FXYixDQUFDO0FBRUYsTUFBTSxDQUFDLE9BQU8sR0FBRyxNQUFNLENBQUMsS0FBSyxDQUFDLE1BQU0sQ0FBQztJQUNuQyxRQUFRO0lBQ1IsS0FBSztJQUNMLENBQUMsRUFBRTtRQUNELElBQUksRUFBRSxPQUFPO1FBQ2IsTUFBTSxFQUFFLFNBQVM7UUFDakIsVUFBVSxFQUFFLGFBQWE7UUFDekIsY0FBYyxFQUFFLGlCQUFpQjtRQUNqQyxNQUFNLEVBQUUsU0FBUztRQUNqQixFQUFFLEVBQUUsS0FBSztRQUNULFdBQVcsRUFBRSxjQUFjO1FBQzNCLFFBQVEsRUFBRSxXQUFXO1FBQ3JCLFVBQVUsRUFBRSxhQUFhO1FBQ3pCLEtBQUssRUFBRSxRQUFRO1FBQ2YsTUFBTSxFQUFFLFNBQVM7UUFDakIsUUFBUSxFQUFFLFdBQVc7UUFDckIsS0FBSyxFQUFFLFFBQVE7UUFDZixRQUFRLEVBQUUsV0FBVztRQUNyQixRQUFRLEVBQUUsV0FBVztRQUNyQixZQUFZLEVBQUUsZUFBZTtRQUM3QixXQUFXLEVBQUUsY0FBYztRQUMzQixlQUFlLEVBQUUsa0JBQWtCO0tBQ3BDO0lBQ0QsS0FBSyxDQUFDLE9BQWdDOztRQUNwQyxNQUFNLFFBQVEsR0FBRyxDQUFDLEdBQXdCLEVBQXdDLEVBQUUsQ0FDbEYsSUFBSSxDQUFDLENBQUMsQ0FBQyxHQUFHLENBQXlDLENBQUM7UUFDdEQsUUFBUSxDQUFDLGFBQWEsQ0FBQyxDQUFDLEtBQUssR0FBRyxNQUFBLE9BQU8sYUFBUCxPQUFPLHVCQUFQLE9BQU8sQ0FBRSxXQUFXLG1D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LE9BQU8sQ0FBQyxDQUFDLENBQUMsTUFBTSxDQUFDLEtBQUssQ0FBQyxDQUFDO1lBQzlFLENBQUM7UUFDSCxDQUFDLENBQUMsQ0FBQztJQUNMLENBQUM7Q0FDRixDQUFDLENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgeyBERUZBVUxUX1BSRUZBQl9ESVJFQ1RPUlksIERFRkFVTFRfVEVNUExBVEVfVVJMLCBQQUNLQUdFX05BTUUgfSBmcm9tICcuLi9jb25zdGFudHMnO1xuaW1wb3J0IHR5cGUgeyBSb29tQ3JlYXRpb25SZXF1ZXN0LCBSb29tQ3JlYXRpb25SZXN1bHQgfSBmcm9tICcuLi9yb29tcy9jcmVhdGUtcm9vbS1jb250ZW50JztcblxuaW50ZXJmYWNlIFJvb21DcmVhdGVQYW5lbENvbnRleHQge1xuICByZWFkb25seSB0YXJnZXREaXJlY3Rvcnk/OiBzdHJpbmc7XG4gIHJlYWRvbmx5IHRlbXBsYXRlVXJsPzogc3RyaW5nO1xufVxuXG5jb25zdCB0ZW1wbGF0ZSA9IGBcbjxmb3JtIGlkPVwiZm9ybVwiPlxuICA8aDI+5paw5bu65oi/6Ze05bu6562RPC9oMj5cbiAgPGRpdiBjbGFzcz1cImdyaWRcIj5cbiAgICA8bGFiZWw+56iz5a6a5oi/6Ze0IElEPGlucHV0IGlkPVwiaWRcIiB2YWx1ZT1cInJvb20tbmV3XCIgcmVxdWlyZWQ+PC9sYWJlbD5cbiAgICA8bGFiZWw+5Lit5paH5ZCN56ewPGlucHV0IGlkPVwiZGlzcGxheU5hbWVcIiB2YWx1ZT1cIuaWsOaIv+mXtFwiIHJlcXVpcmVkPjwvbGFiZWw+XG4gICAgPGxhYmVsPuaIv+mXtOWIhuexuzxzZWxlY3QgaWQ9XCJjYXRlZ29yeVwiPlxuICAgICAgPG9wdGlvbj5FTkVSR1k8L29wdGlvbj48b3B0aW9uPldFQVBPTjwvb3B0aW9uPjxvcHRpb24+REVGRU5TRTwvb3B0aW9uPlxuICAgICAgPG9wdGlvbj5NT0JJTElUWTwvb3B0aW9uPjxvcHRpb24+U1VQUE9SVDwvb3B0aW9uPjxvcHRpb24+TU9WRU1FTlQ8L29wdGlvbj5cbiAgICAgIDxvcHRpb24+VEFDVElDQUw8L29wdGlvbj48b3B0aW9uPkRST05FPC9vcHRpb24+PG9wdGlvbj5FQ09OT01ZPC9vcHRpb24+PG9wdGlvbj5TUEVDSUFMPC9vcHRpb24+XG4gICAgPC9zZWxlY3Q+PC9sYWJlbD5cbiAgICA8bGFiZWw+UHJlZmFiIOWQjeensDxpbnB1dCBpZD1cInByZWZhYk5hbWVcIiB2YWx1ZT1cIk5ld1Jvb21cIiByZXF1aXJlZD48L2xhYmVsPlxuICAgIDxsYWJlbD7lrr3luqbvvIjmoLzvvIk8aW5wdXQgaWQ9XCJ3aWR0aFwiIHR5cGU9XCJudW1iZXJcIiBtaW49XCIxXCIgc3RlcD1cIjFcIiB2YWx1ZT1cIjJcIiByZXF1aXJlZD48L2xhYmVsPlxuICAgIDxsYWJlbD7pq5jluqbvvIjmoLzvvIk8aW5wdXQgaWQ9XCJoZWlnaHRcIiB0eXBlPVwibnVtYmVyXCIgbWluPVwiMVwiIHN0ZXA9XCIxXCIgdmFsdWU9XCIyXCIgcmVxdWlyZWQ+PC9sYWJlbD5cbiAgICA8bGFiZWw+5pyA6auY562J57qnPGlucHV0IGlkPVwibWF4TGV2ZWxcIiB0eXBlPVwibnVtYmVyXCIgbWluPVwiMVwiIHN0ZXA9XCIxXCIgdmFsdWU9XCIxXCIgcmVxdWlyZWQ+PC9sYWJlbD5cbiAgICA8bGFiZWw+5pyA5aSn6ICQ5LmFPGlucHV0IGlkPVwibWF4SHBcIiB0eXBlPVwibnVtYmVyXCIgbWluPVwiMVwiIHN0ZXA9XCIxXCIgdmFsdWU9XCIxMDBcIiByZXF1aXJlZD48L2xhYmVsPlxuICAgIDxsYWJlbD7mnIDkvY7og73mupA8aW5wdXQgaWQ9XCJtaW5Qb3dlclwiIHR5cGU9XCJudW1iZXJcIiBtaW49XCIwXCIgc3RlcD1cIjFcIiB2YWx1ZT1cIjBcIiByZXF1aXJlZD48L2xhYmVsPlxuICAgIDxsYWJlbD7mnIDpq5jog73mupA8aW5wdXQgaWQ9XCJtYXhQb3dlclwiIHR5cGU9XCJudW1iZXJcIiBtaW49XCIwXCIgc3RlcD1cIjFcIiB2YWx1ZT1cIjBcIiByZXF1aXJlZD48L2xhYmVsPlxuICAgIDxsYWJlbD7oiLnlkZjlrrnph488aW5wdXQgaWQ9XCJjcmV3Q2FwYWNpdHlcIiB0eXBlPVwibnVtYmVyXCIgbWluPVwiMFwiIHN0ZXA9XCIxXCIgdmFsdWU9XCIwXCIgcmVxdWlyZWQ+PC9sYWJlbD5cbiAgPC9kaXY+XG4gIDxsYWJlbD7mqKHmnb8gUHJlZmFiIFVSTDxpbnB1dCBpZD1cInRlbXBsYXRlVXJsXCIgcmVxdWlyZWQ+PC9sYWJlbD5cbiAgPGxhYmVsPuebruaghyBQcmVmYWIg55uu5b2VPGlucHV0IGlkPVwidGFyZ2V0RGlyZWN0b3J5XCIgcmVxdWlyZWQ+PC9sYWJlbD5cbiAgPGRpdiBjbGFzcz1cImFjdGlvbnNcIj5cbiAgICA8dWktYnV0dG9uIGlkPVwic3VibWl0XCIgY2xhc3M9XCJibHVlXCI+5Yib5bu66LWE5rqQPC91aS1idXR0b24+XG4gICAgPHVpLWJ1dHRvbiBpZD1cIm9wZW5QcmVmYWJcIiBoaWRkZW4+5omT5byA5pawIFByZWZhYjwvdWktYnV0dG9uPlxuICAgIDx1aS1idXR0b24gaWQ9XCJ2YWxpZGF0ZVByZWZhYlwiPuagoemqjOW9k+WJjSBQcmVmYWI8L3VpLWJ1dHRvbj5cbiAgPC9kaXY+XG4gIDxwcmUgaWQ9XCJzdGF0dXNcIiBhcmlhLWxpdmU9XCJwb2xpdGVcIj48L3ByZT5cbjwvZm9ybT5gO1xuXG5jb25zdCBzdHlsZSA9IGBcbjpob3N0IHsgY29sb3I6IHZhcigtLWNvbG9yLW5vcm1hbC1jb250cmFzdC13ZWFrZXN0KTsgZm9udDogMTNweCBzYW5zLXNlcmlmOyB9XG5mb3JtIHsgYm94LXNpemluZzogYm9yZGVyLWJveDsgbWluLXdpZHRoOiAwOyBwYWRkaW5nOiAxOHB4OyB9XG5oMiB7IG1hcmdpbjogMCAwIDhweDsgY29sb3I6IHZhcigtLWNvbG9yLW5vcm1hbC1jb250cmFzdCk7IH1cbi5ncmlkIHsgZGlzcGxheTogZ3JpZDsgZ3JpZC10ZW1wbGF0ZS1jb2x1bW5zOiByZXBlYXQoYXV0by1maXQsIG1pbm1heChtaW4oMTAwJSwgMjIwcHgpLCAxZnIpKTsgZ2FwOiAxMHB4IDEycHg7IH1cbmxhYmVsIHsgZGlzcGxheTogZmxleDsgZmxleC1kaXJlY3Rpb246IGNvbHVtbjsgZ2FwOiA1cHg7IG1hcmdpbjogOXB4IDA7IH1cbmlucHV0LCBzZWxlY3QgeyBib3gtc2l6aW5nOiBib3JkZXItYm94OyB3aWR0aDogMTAwJTsgaGVpZ2h0OiAyOHB4OyBwYWRkaW5nOiA0cHggN3B4OyBjb2xvcjogaW5oZXJpdDsgYmFja2dyb3VuZDogdmFyKC0tY29sb3Itbm9ybWFsLWZpbGwpOyBib3JkZXI6IDFweCBzb2xpZCB2YXIoLS1jb2xvci1ub3JtYWwtYm9yZGVyKTsgYm9yZGVyLXJhZGl1czogM3B4OyB9XG4uYWN0aW9ucyB7IGRpc3BsYXk6IGZsZXg7IGZsZXgtd3JhcDogd3JhcDsgZ2FwOiA4cHg7IG1hcmdpbi10b3A6IDE0cHg7IH1cbiNzdGF0dXMgeyBtaW4taGVpZ2h0OiA1NHB4OyB3aGl0ZS1zcGFjZTogcHJlLXdyYXA7IGxpbmUtaGVpZ2h0OiAxLjU7IH1cbiNzdGF0dXMub2sgeyBjb2xvcjogIzdiZDg4ZjsgfVxuI3N0YXR1cy5lcnJvciB7IGNvbG9yOiAjZmY3Nzc3OyB9XG5gO1xuXG5tb2R1bGUuZXhwb3J0cyA9IEVkaXRvci5QYW5lbC5kZWZpbmUoe1xuICB0ZW1wbGF0ZSxcbiAgc3R5bGUsXG4gICQ6IHtcbiAgICBmb3JtOiAnI2Zvcm0nLFxuICAgIHN1Ym1pdDogJyNzdWJtaXQnLFxuICAgIG9wZW5QcmVmYWI6ICcjb3BlblByZWZhYicsXG4gICAgdmFsaWRhdGVQcmVmYWI6ICcjdmFsaWRhdGVQcmVmYWInLFxuICAgIHN0YXR1czogJyNzdGF0dXMnLFxuICAgIGlkOiAnI2lkJyxcbiAgICBkaXNwbGF5TmFtZTogJyNkaXNwbGF5TmFtZScsXG4gICAgY2F0ZWdvcnk6ICcjY2F0ZWdvcnknLFxuICAgIHByZWZhYk5hbWU6ICcjcHJlZmFiTmFtZScsXG4gICAgd2lkdGg6ICcjd2lkdGgnLFxuICAgIGhlaWdodDogJyNoZWlnaHQnLFxuICAgIG1heExldmVsOiAnI21heExldmVsJyxcbiAgICBtYXhIcDogJyNtYXhIcCcsXG4gICAgbWluUG93ZXI6ICcjbWluUG93ZXInLFxuICAgIG1heFBvd2VyOiAnI21heFBvd2VyJyxcbiAgICBjcmV3Q2FwYWNpdHk6ICcjY3Jld0NhcGFjaXR5JyxcbiAgICB0ZW1wbGF0ZVVybDogJyN0ZW1wbGF0ZVVybCcsXG4gICAgdGFyZ2V0RGlyZWN0b3J5OiAnI3RhcmdldERpcmVjdG9yeScsXG4gIH0sXG4gIHJlYWR5KGNvbnRleHQ/OiBSb29tQ3JlYXRlUGFuZWxDb250ZXh0KSB7XG4gICAgY29uc3QgZ2V0SW5wdXQgPSAoa2V5OiBrZXlvZiB0eXBlb2YgdGhpcy4kKTogSFRNTElucHV0RWxlbWVudCB8IEhUTUxTZWxlY3RFbGVtZW50ID0+XG4gICAgICB0aGlzLiRba2V5XSBhcyBIVE1MSW5wdXRFbGVtZW50IHwgSFRNTFNlbGVjdEVsZW1lbnQ7XG4gICAgZ2V0SW5wdXQoJ3RlbXBsYXRlVXJsJykudmFsdWUgPSBjb250ZXh0Py50ZW1wbGF0ZVVybCA/PyBERUZBVUxUX1RFTVBMQVRFX1VSTDtcbiAgICBnZXRJbnB1dCgndGFyZ2V0RGlyZWN0b3J5JykudmFsdWUgPSBjb250ZXh0Py50YXJnZXREaXJlY3RvcnkgPz8gREVGQVVMVF9QUkVGQUJfRElSRUNUT1JZO1xuXG4gICAgY29uc3Qgc3RhdHVzID0gdGhpcy4kLnN0YXR1cyBhcyBIVE1MRWxlbWVudDtcbiAgICBjb25zdCBzdWJtaXQgPSB0aGlzLiQuc3VibWl0IGFzIEhUTUxCdXR0b25FbGVtZW50O1xuICAgIGNvbnN0IG9wZW5QcmVmYWIgPSB0aGlzLiQub3BlblByZWZhYiBhcyBIVE1MQnV0dG9uRWxlbWVudDtcbiAgICBjb25zdCB2YWxpZGF0ZVByZWZhYiA9IHRoaXMuJC52YWxpZGF0ZVByZWZhYiBhcyBIVE1MQnV0dG9uRWxlbWVudDtcbiAgICBsZXQgY3JlYXRlZFByZWZhYlVybCA9ICcnO1xuXG4gICAgc3VibWl0LmFkZEV2ZW50TGlzdGVuZXIoJ2NvbmZpcm0nLCBhc3luYyAoKSA9PiB7XG4gICAgICBjb25zdCByZXF1ZXN0OiBSb29tQ3JlYXRpb25SZXF1ZXN0ID0ge1xuICAgICAgICBpZDogZ2V0SW5wdXQoJ2lkJykudmFsdWUudHJpbSgpLFxuICAgICAgICBkaXNwbGF5TmFtZTogZ2V0SW5wdXQoJ2Rpc3BsYXlOYW1lJykudmFsdWUudHJpbSgpLFxuICAgICAgICBjYXRlZ29yeTogZ2V0SW5wdXQoJ2NhdGVnb3J5JykudmFsdWUsXG4gICAgICAgIHByZWZhYk5hbWU6IGdldElucHV0KCdwcmVmYWJOYW1lJykudmFsdWUudHJpbSgpLFxuICAgICAgICB3aWR0aDogTnVtYmVyKGdldElucHV0KCd3aWR0aCcpLnZhbHVlKSxcbiAgICAgICAgaGVpZ2h0OiBOdW1iZXIoZ2V0SW5wdXQoJ2hlaWdodCcpLnZhbHVlKSxcbiAgICAgICAgbWF4TGV2ZWw6IE51bWJlcihnZXRJbnB1dCgnbWF4TGV2ZWwnKS52YWx1ZSksXG4gICAgICAgIG1heEhwOiBOdW1iZXIoZ2V0SW5wdXQoJ21heEhwJykudmFsdWUpLFxuICAgICAgICBtaW5Qb3dlcjogTnVtYmVyKGdldElucHV0KCdtaW5Qb3dlcicpLnZhbHVlKSxcbiAgICAgICAgbWF4UG93ZXI6IE51bWJlcihnZXRJbnB1dCgnbWF4UG93ZXInKS52YWx1ZSksXG4gICAgICAgIGNyZXdDYXBhY2l0eTogTnVtYmVyKGdldElucHV0KCdjcmV3Q2FwYWNpdHknKS52YWx1ZSksXG4gICAgICAgIHRlbXBsYXRlVXJsOiBnZXRJbnB1dCgndGVtcGxhdGVVcmwnKS52YWx1ZS50cmltKCksXG4gICAgICAgIHRhcmdldERpcmVjdG9yeTogZ2V0SW5wdXQoJ3RhcmdldERpcmVjdG9yeScpLnZhbHVlLnRyaW0oKSxcbiAgICAgIH07XG4gICAgICBzdWJtaXQuc2V0QXR0cmlidXRlKCdkaXNhYmxlZCcsICd0cnVlJyk7XG4gICAgICBzdGF0dXMuY2xhc3NOYW1lID0gJyc7XG4gICAgICBzdGF0dXMudGV4dENvbnRlbnQgPSAn5q2j5Zyo5Yib5bu64oCmJztcbiAgICAgIHRyeSB7XG4gICAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IEVkaXRvci5NZXNzYWdlLnJlcXVlc3QoXG4gICAgICAgICAgUEFDS0FHRV9OQU1FLFxuICAgICAgICAgICdjcmVhdGUtcm9vbS1jb250ZW50JyxcbiAgICAgICAgICByZXF1ZXN0LFxuICAgICAgICApIGFzIFJvb21DcmVhdGlvblJlc3VsdDtcbiAgICAgICAgc3RhdHVzLmNsYXNzTmFtZSA9IHJlc3VsdC5vayA/ICdvaycgOiAnZXJyb3InO1xuICAgICAgICBzdGF0dXMudGV4dENvbnRlbnQgPSByZXN1bHQubWVzc2FnZTtcbiAgICAgICAgaWYgKHJlc3VsdC5vaykge1xuICAgICAgICAgIGNyZWF0ZWRQcmVmYWJVcmwgPSByZXN1bHQucHJlZmFiVXJsO1xuICAgICAgICAgIG9wZW5QcmVmYWIuaGlkZGVuID0gZmFsc2U7XG4gICAgICAgIH1cbiAgICAgIH0gY2F0Y2ggKGNhdXNlKSB7XG4gICAgICAgIHN0YXR1cy5jbGFzc05hbWUgPSAnZXJyb3InO1xuICAgICAgICBzdGF0dXMudGV4dENvbnRlbnQgPSBjYXVzZSBpbnN0YW5jZW9mIEVycm9yID8gY2F1c2UubWVzc2FnZSA6IFN0cmluZyhjYXVzZSk7XG4gICAgICB9IGZpbmFsbHkge1xuICAgICAgICBzdWJtaXQucmVtb3ZlQXR0cmlidXRlKCdkaXNhYmxlZCcpO1xuICAgICAgfVxuICAgIH0pO1xuXG4gICAgb3BlblByZWZhYi5hZGRFdmVudExpc3RlbmVyKCdjb25maXJtJywgKCkgPT4ge1xuICAgICAgaWYgKGNyZWF0ZWRQcmVmYWJVcmwgIT09ICcnKSB7XG4gICAgICAgIEVkaXRvci5NZXNzYWdlLnNlbmQoUEFDS0FHRV9OQU1FLCAnb3Blbi1jcmVhdGVkLXByZWZhYicsIGNyZWF0ZWRQcmVmYWJVcmwpO1xuICAgICAgfVxuICAgIH0pO1xuXG4gICAgdmFsaWRhdGVQcmVmYWIuYWRkRXZlbnRMaXN0ZW5lcignY29uZmlybScsIGFzeW5jICgpID0+IHtcbiAgICAgIHN0YXR1cy5jbGFzc05hbWUgPSAnJztcbiAgICAgIHN0YXR1cy50ZXh0Q29udGVudCA9ICfmraPlnKjmoKHpqozlvZPliY0gUHJlZmFi4oCmJztcbiAgICAgIHRyeSB7XG4gICAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IEVkaXRvci5NZXNzYWdlLnJlcXVlc3QoXG4gICAgICAgICAgUEFDS0FHRV9OQU1FLFxuICAgICAgICAgICd2YWxpZGF0ZS1vcGVuLXJvb20tcHJlZmFiJyxcbiAgICAgICAgKSBhcyB7IHJlYWRvbmx5IG9rOiBib29sZWFuOyByZWFkb25seSBtZXNzYWdlOiBzdHJpbmcgfTtcbiAgICAgICAgc3RhdHVzLmNsYXNzTmFtZSA9IHJlc3VsdC5vayA/ICdvaycgOiAnZXJyb3InO1xuICAgICAgICBzdGF0dXMudGV4dENvbnRlbnQgPSByZXN1bHQubWVzc2FnZTtcbiAgICAgIH0gY2F0Y2ggKGNhdXNlKSB7XG4gICAgICAgIHN0YXR1cy5jbGFzc05hbWUgPSAnZXJyb3InO1xuICAgICAgICBzdGF0dXMudGV4dENvbnRlbnQgPSBjYXVzZSBpbnN0YW5jZW9mIEVycm9yID8gY2F1c2UubWVzc2FnZSA6IFN0cmluZyhjYXVzZSk7XG4gICAgICB9XG4gICAgfSk7XG4gIH0sXG59KTtcbiJdfQ==