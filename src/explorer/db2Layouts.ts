/**
 * The client database tables the app reads are laid out differently in other game versions:
 * fields added, dropped or moved. The code numbers fields as Forever (wow_classic_beta) has
 * them; for another version's layout of a table, map[i] is where Forever's field i is in it, or
 * null where it hasn't one. The maps come from WoWDBDefs (`bun run layouts`). A layout not
 * listed is read as it is, a field past its end as missing.
 */
import { GENERATED_LAYOUTS } from './db2Layouts.generated';

type FieldMap = (number | null)[];

/** How to read a table's fields as Forever numbers them, or null if this layout needs nothing. */
export function fieldMap(fdid: number, layoutHash: number): FieldMap | null {
	return GENERATED_LAYOUTS[fdid]?.[layoutHash] ?? null;
}
