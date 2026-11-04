import type { CascStorage } from '../casc/storage';
import type { Db2 } from '../formats/db2';
import { DB2_FILES, loadTable } from './clientDb';
import { FIELDS } from './fields';
import type { KnownMap } from './maps';

/** UiMap types and systems. */
const UI_MAP_CONTINENT = 2;
const UI_MAP_ZONE = 3;
const UI_MAP_SYSTEM_WORLD = 0;
/** A continent is made of several zones; a map with only one, though the world map names it, is a pocket (Mogu Island Daily Area). */
const MIN_ZONES = 2;

/** A map's WDT file (0 if none): from Map.db2, or where that hasn't the field (Classic), by its path, world/maps/<directory>/<directory>.wdt. */
export function mapWdt(storage: CascStorage, table: Db2, mapId: number): number {
	const listed = table.getInt(mapId, FIELDS.Map.WdtFileDataID);
	if (listed !== null) return listed;
	const directory = table.getString(mapId, FIELDS.Map.Directory)?.toLowerCase();
	return directory ? storage.lookupPath(`world/maps/${directory}/${directory}.wdt`) ?? 0 : 0;
}

export interface ContinentCandidate {
	id: number;
	directory: string;
	name: string;
	instanceType: number;
	/** 0 if the map has no WDT in the install. */
	wdt: number;
	/** Zones the world map gives it (UiMapAssignment rows of a zone map, with an area). */
	zones: number;
	/** Whether the world map has a map of the whole of it: a continent map in the world system, with no area. */
	root: boolean;
}

/**
 * The maps that are continents, in Map.db2's order: open-world maps (not dungeons, raids or battlegrounds)
 * that the world map shows whole, with several zones in them. As the world map's own tables say it, and
 * so each version has its own: Outland from the first expansion, Northrend, Pandaria.
 */
export function pickContinents(candidates: ContinentCandidate[]): ContinentCandidate[] {
	return candidates.filter((m) => m.instanceType === 0 && m.wdt > 0 && m.root && m.zones >= MIN_ZONES).sort((a, b) => a.id - b.id);
}

/** The continents of an install, with their WDT and WDL files, drawn as one world. */
export async function findContinents(storage: CascStorage): Promise<KnownMap[]> {
	const [maps, uiMaps, assignments] = await Promise.all([
		loadTable(storage, DB2_FILES.Map),
		loadTable(storage, DB2_FILES.UiMap),
		loadTable(storage, DB2_FILES.UiMapAssignment),
	]);
	const zones = new Map<number, number>();
	const roots = new Set<number>();
	for (const id of assignments.ids()) {
		const map = assignments.getInt(id, FIELDS.UiMapAssignment.MapID) ?? -1;
		const uiMap = assignments.getInt(id, FIELDS.UiMapAssignment.UiMapID) ?? 0;
		const type = uiMaps.getInt(uiMap, FIELDS.UiMap.Type);
		const area = assignments.getInt(id, FIELDS.UiMapAssignment.AreaID);
		if (type === UI_MAP_ZONE && area) zones.set(map, (zones.get(map) ?? 0) + 1);
		else if (type === UI_MAP_CONTINENT && !area && uiMaps.getInt(uiMap, FIELDS.UiMap.System) === UI_MAP_SYSTEM_WORLD) roots.add(map);
	}
	const candidates = maps.ids().map((id): ContinentCandidate => {
		const wdt = mapWdt(storage, maps, id);
		return {
			id,
			directory: maps.getString(id, FIELDS.Map.Directory) ?? '',
			name: maps.getString(id, FIELDS.Map.MapName_lang) ?? `Map ${id}`,
			instanceType: maps.getInt(id, FIELDS.Map.InstanceType) ?? -1,
			wdt: wdt && storage.status(wdt) === 'ok' ? wdt : 0,
			zones: zones.get(id) ?? 0,
			root: roots.has(id),
		};
	});
	return pickContinents(candidates).flatMap((m): KnownMap[] => {
		const directory = m.directory.toLowerCase();
		// The far terrain's file: by its path, or the file number before the WDT's, where the maps keep it.
		const wdl = storage.lookupPath(`world/maps/${directory}/${directory}.wdl`) ?? m.wdt - 1;
		return storage.status(wdl) === 'ok' ? [{ name: m.name, directory: m.directory, mapId: m.id, wdt: m.wdt, wdl }] : [];
	});
}
