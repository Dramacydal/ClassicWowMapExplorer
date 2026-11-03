import { GENERATED_LAYOUTS } from './db2Layouts.generated';

type FieldMap = (number | null)[];

const warned = new Set<string>();

/**
 * Where a table's fields, numbered as fields.ts lists them, are in a file with this layout hash:
 * map[i] is where its field i is, or null where the file's layout hasn't it. A hash the
 * definitions don't know is read as the newest layout of Forever, with a warning. Null for a table
 * that fields.ts lists no fields of. The maps come from WoWDBDefs (`bun run layouts`).
 */
export function fieldMap(fdid: number, layoutHash: number): FieldMap | null {
	const table = GENERATED_LAYOUTS[fdid];
	if (!table) return null;
	const known = table.layouts[layoutHash];
	if (known) return known;
	const key = `${fdid}:${layoutHash}`;
	if (!warned.has(key)) {
		warned.add(key);
		console.warn(`Table ${fdid} has the layout 0x${layoutHash.toString(16)}, which is not known; reading it as Forever's`);
	}
	return table.fallback;
}
