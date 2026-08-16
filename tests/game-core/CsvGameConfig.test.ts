import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { parseCsv, parseGameConfigCsvBundle } from '../../assets/scripts/game-core/CsvGameConfig.ts';

const CONFIG_ROOT = new URL('../../assets/config/csv/', import.meta.url);

function read(name: string): string {
  return readFileSync(new URL(name, CONFIG_ROOT), 'utf8');
}

test('CSV 支持 BOM、CRLF 和 RFC4180 引号', () => {
  assert.deepEqual(parseCsv('\uFEFFid,displayName,value\r\na,"中文,名称","a""b"\r\n'), [
    ['id', 'displayName', 'value'],
    ['a', '中文,名称', 'a"b'],
  ]);
});

test('权威 CSV 全量解析并校验跨表引用', () => {
  const result = parseGameConfigCsvBundle({
    game: read('game.csv'),
    hulls: read('hulls.csv'),
    rooms: read('rooms.csv'),
    connectorPorts: read('connector-ports.csv'),
    floors: read('floors.csv'),
    crews: read('crews.csv'),
    crewTraits: read('crew-traits.csv'),
  });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.config.configVersion, 'r1-p8-close-1');
    assert.equal(result.config.initialMetal, 1000);
    const starter = result.config.hulls.find((hull) => hull.id === 'hull-starter');
    assert.equal(starter?.cellTypes.length, 200);
    assert.equal(starter?.cellTypes.filter((cell) => cell === 'FIXED_WALL').length, 56);
    assert.equal(starter?.cellTypes[0], 'FIXED_WALL');
    assert.equal(starter?.cellTypes[21], 'BUILDABLE');
    assert.equal(starter?.cellTypes[199], 'FIXED_WALL');
    assert.equal(result.config.rooms.some((room) => room.verticalConnectorKind === 'STAIRS'), true);
    assert.equal(result.config.crews.find((crew) => crew.role === 'SOLDIER')?.appearanceId, 'appearance-pss-soldier-government-45');
  }
});

test('任一表头或跨表引用无效时整批拒绝', () => {
  const base = {
    game: read('game.csv'), hulls: read('hulls.csv'), rooms: read('rooms.csv'),
    connectorPorts: read('connector-ports.csv'), floors: read('floors.csv'), crews: read('crews.csv'), crewTraits: read('crew-traits.csv'),
  };
  const badHeader = parseGameConfigCsvBundle({ ...base, floors: base.floors.replace('id,displayName', 'displayName,id') });
  assert.equal(badHeader.ok, false);
  const badReference = parseGameConfigCsvBundle({ ...base, crews: base.crews.replace('trait-construction-slot-1', 'trait-missing') });
  assert.equal(badReference.ok, false);
  const badMask = parseGameConfigCsvBundle({ ...base, hulls: base.hulls.replace('/WBBBB', '/XBBBB') });
  assert.equal(badMask.ok, false);
});
