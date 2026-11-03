import { expect, test } from 'bun:test';
import { DB2_FILES } from '../src/explorer/db2Files';
import { fieldMap } from '../src/explorer/db2Layouts';
import { GENERATED_LAYOUTS } from '../src/explorer/db2Layouts.generated';
import { FIELD_SOURCES, FIELDS } from '../src/explorer/fields';
import { fieldMapOf, newestLayout, parseLayouts } from '../tools/buildLayouts';

test('parses layouts, leaving out IDs and relations kept apart from the records', () => {
	const layouts = parseLayouts(`COLUMNS
int ID

LAYOUT AB12, cd34
BUILD 1.0.0.1
$noninline,id$ID<32>
Name<u8>
Colors<32>[3]
$noninline,relation$Parent<32>

LAYOUT EF56
BUILD 1.0.0.2
$id$ID<32>
Name
`);
	expect(layouts.get('AB12')?.fields).toEqual(['Name', 'Colors']);
	expect(layouts.get('CD34')?.fields).toEqual(['Name', 'Colors']);
	expect(layouts.get('EF56')?.fields).toEqual(['ID', 'Name']);
	expect(layouts.get('EF56')?.builds).toEqual(['1.0.0.2']);
});

test('takes the newest build of a version as its layout', () => {
	const layouts = parseLayouts('LAYOUT AA\nBUILD 1.60.1.100, 1.15.0.5\nA\n\nLAYOUT BB\nBUILD 1.60.1.200\nB\n\nLAYOUT CC\nBUILD 2.0.0.900\nC\n');
	expect(newestLayout(layouts, '1.60.')?.hash).toBe('BB');
	expect(newestLayout(layouts, '3.')).toBeNull();
});

test('finds where the wanted fields are in a layout', () => {
	expect(fieldMapOf(['A', 'B'], ['A', 'B'])).toEqual([0, 1]);
	expect(fieldMapOf(['A', 'B', 'C'], ['C', 'A'])).toEqual([1, null, 0]);
});

test('numbers each field by its place in its table\'s list, and names it as in the definitions or by its alias', () => {
	expect(FIELDS.Map.Directory).toBe(0);
	expect(FIELDS.Map.WdtFileDataID).toBe(3);
	expect(FIELDS.LiquidType.FoamColor).toBe(5);
	expect(FIELD_SOURCES.LiquidType[FIELDS.LiquidType.FoamColor]).toBe('MinimapStaticCol');
	expect(FIELD_SOURCES.Map).toEqual(['Directory', 'MapName_lang', 'InstanceType', 'WdtFileDataID']);
});

test('Map.db2 of Classic, which has no WDT file, reads as the hand-made map did', () => {
	// Worked out by hand before the layouts were generated: Classic has Directory, name and instance type at 0, 1 and 7.
	const map = fieldMap(DB2_FILES.Map, 0xb47c6f05)!;
	expect(map[FIELDS.Map.Directory]).toBe(0);
	expect(map[FIELDS.Map.MapName_lang]).toBe(1);
	expect(map[FIELDS.Map.InstanceType]).toBe(7);
	expect(map[FIELDS.Map.WdtFileDataID]).toBeNull();
});

test('a layout hash not known is read as the newest of Forever, and a table with no listed fields as it is', () => {
	const forever = fieldMap(DB2_FILES.Map, 0xd43afac3);
	expect(forever).toEqual([0, 1, 8, 21]);
	expect(fieldMap(DB2_FILES.Map, 0x12345678)).toEqual(forever);
	expect(fieldMap(DB2_FILES.LightParams, 0x12345678)).toBeNull();
});

test('the generated layouts match the field lists', () => {
	for (const [table, sources] of Object.entries(FIELD_SOURCES)) {
		const generated = GENERATED_LAYOUTS[DB2_FILES[table as keyof typeof DB2_FILES]];
		expect([table, generated !== undefined]).toEqual([table, true]);
		expect([table, generated.fallback.length]).toEqual([table, sources.length]);
		expect([table, generated.fallback.includes(null)]).toEqual([table, false]);
		for (const map of Object.values(generated.layouts)) expect([table, map.length]).toEqual([table, sources.length]);
	}
});

test('the light colours are listed in a row, since they are read by their distance from the first', () => {
	expect(FIELDS.LightData.RiverFarColor - FIELDS.LightData.DirectColor).toBe(16);
});
