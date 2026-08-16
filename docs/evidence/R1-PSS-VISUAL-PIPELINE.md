# R1 PSS 首批视觉素材导入证据

> 记录日期：2026-08-13
> 范围：P7 首批房间与船员外观素材的只读复制、切片索引和哈希核对。
> 规则来源：`I:/WebProjects/pss_full` 只读候选素材库；本项目不把该库作为运行时依赖。

## 复制范围

使用标准 `cp` 从 `I:/WebProjects/pss_full/sprites/<id>.png` 复制到
`assets/textures/pss/source/<id>.png`，本批共 14 个原始 PNG：

- 房间：83、808、8285、8041、1107。
- 船员部件：335、190、191、3815、3779、3786、1644、1645、1646。

没有复制 `pss_full` 其他目录或全量素材，也没有修改源文件；没有手写或生成 `.meta`。
分类目录 `sorted/room/<id>.png`、`sorted/crew/<id>.png` 与对应 `sprites/<id>.png`
在只读核对中字节一致，manifest 保留两类相对路径以便追溯。

## 稳定视觉 ID 与切片

完整的逐条记录（源相对路径、目标路径、尺寸、字节数、SHA-256、rect、帧模式和 fps）在
[`assets/textures/pss/manifest.json`](../../assets/textures/pss/manifest.json)。

| 视觉 ID | 源图 | 尺寸 | 模式 / fps | 说明 |
| --- | --- | ---: | --- | --- |
| `visual-pss-room-elevator-83` | `sprites/83.png` | 104×104 | STATIC / 0 | rect `(0,40,25,25)` |
| `visual-pss-room-reactor-808` | `sprites/808.png` | 202×202 | ALWAYS_LOOP / 6 | 5 个非空帧，均为 100×50；第三行右侧及第四行透明格不导入 |
| `visual-pss-room-laser-8285` | `sprites/8285.png` | 350×50 | POWERED_LOOP / 6 | 7 帧，x=0,50,…,300，50×50 |
| `visual-pss-room-shield-8041` | `sprites/8041.png` | 300×100 | POWERED_LOOP / 6 | 6 帧，50×50，2 行 |
| `visual-pss-room-medbay-1107` | `sprites/1107.png` | 50×50 | STATIC / 0 | 全图帧 |

下表保留 2026-08-13 首批三套部件索引的来源记录；2026-08-14 已由创作工具生成四职业持久外观，新增士兵使用项目内派生图与视觉 CSV 记录：

| 外观 ID | head | body | leg | 偏移 |
| --- | --- | --- | --- | --- |
| `appearance-pss-engineer-bob-8` | 335 | 190 | 191 | `(0,0)` 占位，`requiresManualAnchor=true` |
| `appearance-pss-gunner-bobby-240` | 3815 | 3779 | 3786 | `(0,0)` 占位，`requiresManualAnchor=true` |
| `appearance-pss-medic-doctor-dong-153` | 1644 | 1645 | 1646 | `(0,0)` 占位，`requiresManualAnchor=true` |

上述船员源图均按原图宽度一分为二建立两个水平帧 rect。2026-08-14 Creator 全新重建后，四个 Crew Prefab 均保存 idle/moving/task 两帧 SpriteFrame 与三条 AnimationClip；正式 Web 画面确认名称、精灵和脚底锚点可见且移动不镜像。

注：反应堆原计划末帧为 `(0,153,100,50)`，但源图高度为 202，若使用 50px 会越界
一像素；manifest 采用 `(0,153,100,49)` 保留源图内完整合法区域。

## 规则与代号接入

PSS 索引会读取 `data/_sprite_mapping.json` 的中文别名，并把别名作为只读搜索字段；
稳定的 `assetId`、`visualId` 和游戏实体 ID 不使用中文名称。船员实例默认使用
`GENERATED` 稳定中文代号，也可在 `CrewView` Inspector 或创作面板选择 `FIXED` 并填写
指定名称；代号写入 Crew/Ship schema 4 快照，刷新和更换外观不会重新生成。

## 哈希核对

核对命令（只读）：

```text
node -e "const fs=require('fs'),c=require('crypto'),p=require('path'),m=JSON.parse(fs.readFileSync('assets/textures/pss/manifest.json')); const ok=m.entries.every(e=>{const a=fs.readFileSync(p.join('I:/WebProjects/pss_full',e.source)),b=fs.readFileSync(e.targetPath),ah=c.createHash('sha256').update(a).digest('hex'),bh=c.createHash('sha256').update(b).digest('hex');return ah===bh&&ah===e.sourceSha256&&bh===e.targetSha256&&a.length===e.byteLength}); console.log(ok?m.entries.length+'/'+m.entries.length+' OK':'FAIL'); if(!ok) process.exit(1)"
```

输出：`14/14 OK`。每个复制文件的 `targetSha256` 与素材库源文件的
`sourceSha256` 相同，且字节数与 manifest 一致；未发现复制过程改变源图字节的证据。

## 权利与后续边界

manifest 的 `rightsStatus` 使用 `USER_CONFIRMED_FOR_PROJECT`，并保留
`https://pixyship.wiki/` 参考来源说明。该状态只表示当前项目内采用已获用户确认，
不等于公开发布授权；正式发布前必须再次复核版权与授权。

## 2026-08-14 持久资源与正式 Web 复验

- Creator 通过 P8.3 全新重建完成五个房间和四个 Crew Prefab 的 Sprite、SpriteFrame、Animation 与 AnimationClip 持久绑定。
- 自动测试直接解析 Creator 序列化资产：五个房间的静态/常驻/供电帧与对应 Clip 均非空；四个 Crew Prefab 各有 idle/moving/task 两帧和三条持久 Clip。
- 最终 `build/web-desktop` 于 17:23 生成；独立 `localhost:7458` 实测船员名称清晰、移动不镜像、选框跟随、下层到上层地板到达后恢复空闲，Main/Battle 往返及刷新无新增 warning/error。
- 证据：`R1-P8-web-final-cold-start.jpg`、`R1-P8-web-final-cross-level-start.jpg`、`R1-P8-web-final-cross-level-mid.jpg`、`R1-P8-web-final-cross-level-arrival.jpg`、`R1-P8-web-final-zoom-out-labels.jpg`、`R1-P8-web-final-1920x1080.jpg`、`R1-P8-web-final-letterbox-1280x900.jpg`。
- 2026-08-15 Codex 内置浏览器已补供电循环、断电首帧、工程师维修中和病员治疗中截图：`R1-P7-web-final6-powered-loop.png`、`R1-P7-web-final6-unpowered-first-frame.png`、`R1-P7-web-final6-repairing.png`、`R1-P7-web-final6-healing.png`。
- 2026-08-15 Codex 内置浏览器补齐士兵巡逻连续画面与施工进度中的 CrewAppearance 画面：`R1-P7-web-final8-patrol-animation-frame-a.png`、`R1-P7-web-final8-patrol-animation-frame-b.png`、`R1-P8-web-final8-construction-start.png`、`R1-P8-web-final8-construction-mid-1.png`、`R1-P8-web-final8-construction-mid-2.png`、`R1-P8-web-final8-construction-73pct.png`。
- P7 视觉动画项已关闭；三名工程师同时到场、施工抢占/返工仍属于 P8 行为验收，不能由这些画面替代。
