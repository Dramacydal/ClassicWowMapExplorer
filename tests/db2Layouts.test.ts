import { expect, test } from 'bun:test';
import { DB2_FILES } from '../src/explorer/db2Files';
import { FIELDS } from '../src/explorer/db2Layouts.generated';
import { fieldMap } from '../src/explorer/db2Layouts';
import { fieldMapOf, parseLayouts, referenceLayout } from '../tools/buildLayouts';

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

test('takes the newest build of the reference version as the reference layout', () => {
	const layouts = parseLayouts('LAYOUT AA\nBUILD 1.60.1.100, 1.15.0.5\nA\n\nLAYOUT BB\nBUILD 1.60.1.200\nB\n\nLAYOUT CC\nBUILD 2.0.0.900\nC\n');
	expect(referenceLayout(layouts)?.hash).toBe('BB');
});

test('maps reference fields to their place in another layout', () => {
	expect(fieldMapOf(['A', 'B'], ['A', 'B'])).toBeNull();
	expect(fieldMapOf(['A', 'B', 'C'], ['C', 'A'])).toEqual([1, null, 0]);
});

test('Map.db2 of Classic reads as the hand-made map did', () => {
	// Worked out by hand before the layouts were generated: [reference field, Classic field].
	const hand: [number, number][] = [[0, 0], [1, 1], [2, 2], [3, 3], [4, 4], [5, 5], [7, 6], [8, 7], [9, 8], [10, 9], [11, 10], [12, 11], [16, 15], [20, 20], [25, 22]];
	const map = fieldMap(DB2_FILES.Map, 0xb47c6f05)!;
	for (const [from, to] of hand) expect(map[from]).toBe(to);
	expect(map[6]).toBeNull();
	expect(map[FIELDS.Map.WdtFileDataID]).toBeNull();
});
