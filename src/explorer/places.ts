import type { CascStorage } from '../casc/storage';
import { DB2_FILES, loadTable } from './clientDb';
import { FIELDS } from './db2Layouts.generated';

/** A place to go to by name: a zone with its extent, or a town or landmark on the world map. */
export interface Place {
	name: string;
	kind: 'zone' | 'place';
	mapId: number;
	/** WoW world coordinates (x north, y west) of the middle of a zone, or of the place. */
	x: number;
	y: number;
	/** Yards across a zone at its widest; 0 for a place, and for a city, which is gone to at its gate. */
	size: number;
	/** The zone a place lies in, when known. */
	zone: string | null;
}

/** UiMap types. */
const UI_MAP_ZONE = 3;
const UI_MAP_BATTLEGROUND = 6;
/** Shown on the world map at all times (towns and landmarks, not battleground objectives). */
const POI_SHOWN = 0x4;

/** Zones from the world map's layout (UiMapAssignment) and towns and landmarks from AreaPOI. */
export async function loadPlaces(storage: CascStorage): Promise<Place[]> {
	const [uiMaps, assignments, pois] = await Promise.all([
		loadTable(storage, DB2_FILES.UiMap),
		loadTable(storage, DB2_FILES.UiMapAssignment),
		loadTable(storage, DB2_FILES.AreaPOI),
	]);
	const zones: (Place & { min: [number, number]; max: [number, number] })[] = [];
	const seen = new Set<string>();
	for (const id of assignments.ids()) {
		const uiMap = assignments.getInt(id, FIELDS.UiMapAssignment.UiMapID) ?? 0;
		const type = uiMaps.getInt(uiMap, FIELDS.UiMap.Type);
		const name = uiMaps.getString(uiMap, FIELDS.UiMap.Name_lang);
		if (!name || !assignments.getInt(id, FIELDS.UiMapAssignment.AreaID) || (type !== UI_MAP_ZONE && type !== UI_MAP_BATTLEGROUND)) continue;
		const mapId = assignments.getInt(id, FIELDS.UiMapAssignment.MapID) ?? 0;
		if (seen.has(`${mapId}:${name}`)) continue;
		seen.add(`${mapId}:${name}`);
		const r = (k: number) => assignments.getFloat(id, FIELDS.UiMapAssignment.Region, k) ?? 0;
		const min: [number, number] = [r(0), r(1)];
		const max: [number, number] = [r(3), r(4)];
		const size = Math.max(max[0] - min[0], max[1] - min[1]);
		zones.push({ name, kind: 'zone', mapId, x: (min[0] + max[0]) / 2, y: (min[1] + max[1]) / 2, size, zone: null, min, max });
	}
	/** The smallest zone around a point: a city before the zone it's in. */
	const zoneAt = (mapId: number, x: number, y: number) => {
		let best: (typeof zones)[number] | null = null;
		for (const z of zones) {
			if (z.mapId !== mapId || x < z.min[0] || x > z.max[0] || y < z.min[1] || y > z.max[1]) continue;
			if (!best || z.size < best.size) best = z;
		}
		return best?.name ?? null;
	};
	/** "The Undercity" and "Undercity", "Stormwind" and "Stormwind City". */
	const sameName = (a: string, b: string) => {
		const plain = (n: string) => n.toLowerCase().replace(/^the /, '').replace(/ city$/, '');
		return plain(a) === plain(b);
	};

	const places: Place[] = zones.map(({ min: _min, max: _max, ...zone }) => zone);
	for (const id of pois.ids()) {
		const name = pois.getString(id, FIELDS.AreaPOI.Name_lang)?.trim();
		const flags = pois.getInt(id, FIELDS.AreaPOI.Flags) ?? 0;
		// A description or a player condition marks event points, battleground objectives and pet tamers.
		// The code once called these fields (1 and 5) "player condition" and "world state"; WoWDBDefs names
		// them Description_lang and PlayerConditionID, and WorldStateID is field 15.
		if (!name || !(flags & POI_SHOWN) || pois.getInt(id, FIELDS.AreaPOI.Description_lang) || pois.getInt(id, FIELDS.AreaPOI.PlayerConditionID)) continue;
		const mapId = pois.getInt(id, FIELDS.AreaPOI.ContinentID) ?? 0;
		const x = pois.getFloat(id, FIELDS.AreaPOI.Pos, 0) ?? 0;
		const y = pois.getFloat(id, FIELDS.AreaPOI.Pos, 1) ?? 0;
		// A city's own marker is at its gate (the middle of Ironforge's zone is the mountain it's in).
		const city = places.find((z) => z.kind === 'zone' && z.size && z.mapId === mapId && sameName(z.name, name));
		if (city) {
			Object.assign(city, { x, y, size: 0 });
			continue;
		}
		if (seen.has(`${mapId}:${name}`)) continue;
		seen.add(`${mapId}:${name}`);
		places.push({ name, kind: 'place', mapId, x, y, size: 0, zone: zoneAt(mapId, x, y) });
	}
	return places;
}
