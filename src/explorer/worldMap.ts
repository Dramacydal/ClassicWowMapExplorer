import type { CascStorage } from '../casc/storage';
import { DB2_FILES, loadTable } from './clientDb';
import { FIELDS } from './db2Layouts.generated';

/** Overlay pieces are cut into tiles this big. */
const OVERLAY_TILE = 256;

export interface MapTile {
	row: number;
	col: number;
	fdid: number;
}

/** A piece of a zone's map that's filled in once one of its areas has been explored. */
export interface MapOverlay {
	areas: number[];
	x: number;
	y: number;
	width: number;
	height: number;
	tiles: MapTile[];
	tileSize: number;
}

/** Where a stretch of a map's world lies on its picture: WoW x/y in region maps to u/v (0-1) in ui. */
export interface MapAssignment {
	mapId: number;
	area: number;
	/** WoW coordinates: [min x, min y], [max x, max y]. */
	min: [number, number];
	max: [number, number];
	uiMin: [number, number];
	uiMax: [number, number];
}

export interface WorldMapInfo {
	id: number;
	name: string;
	parent: number;
	/** 1 world, 2 continent, 3 zone. */
	type: number;
	width: number;
	height: number;
	tileWidth: number;
	tileHeight: number;
	tiles: MapTile[];
	overlays: MapOverlay[];
	assignments: MapAssignment[];
}

/**
 * The world map's continents and zones (UiMap) on the continents: their pictures (UiMapArt
 * tiles, the bottom layer), the pieces revealed by exploring (WorldMapOverlay) and where the
 * world lies on them (UiMapAssignment).
 */
export async function loadWorldMaps(storage: CascStorage, mapIds: number[]): Promise<WorldMapInfo[]> {
	const [uiMaps, assignments, xArt, arts, styles, artTiles, overlays, overlayTiles] = await Promise.all([
		loadTable(storage, DB2_FILES.UiMap),
		loadTable(storage, DB2_FILES.UiMapAssignment),
		loadTable(storage, DB2_FILES.UiMapXMapArt),
		loadTable(storage, DB2_FILES.UiMapArt),
		loadTable(storage, DB2_FILES.UiMapArtStyleLayer),
		loadTable(storage, DB2_FILES.UiMapArtTile),
		loadTable(storage, DB2_FILES.WorldMapOverlay),
		loadTable(storage, DB2_FILES.WorldMapOverlayTile),
	]);
	const wanted = new Set(mapIds);
	const byMap = new Map<number, MapAssignment[]>();
	for (const id of assignments.ids()) {
		const mapId = assignments.getInt(id, FIELDS.UiMapAssignment.MapID) ?? -1;
		if (!wanted.has(mapId)) continue;
		const uiMap = assignments.getInt(id, FIELDS.UiMapAssignment.UiMapID) ?? 0;
		const f = (field: number, i: number) => assignments.getFloat(id, field, i) ?? 0;
		const list = byMap.get(uiMap) ?? [];
		list.push({
			mapId,
			area: assignments.getInt(id, FIELDS.UiMapAssignment.AreaID) ?? 0,
			min: [f(FIELDS.UiMapAssignment.Region, 0), f(FIELDS.UiMapAssignment.Region, 1)],
			max: [f(FIELDS.UiMapAssignment.Region, 3), f(FIELDS.UiMapAssignment.Region, 4)],
			uiMin: [f(FIELDS.UiMapAssignment.UiMin, 0), f(FIELDS.UiMapAssignment.UiMin, 1)],
			uiMax: [f(FIELDS.UiMapAssignment.UiMax, 0), f(FIELDS.UiMapAssignment.UiMax, 1)],
		});
		byMap.set(uiMap, list);
	}
	// Children of each art, style and overlay, by their parent ID.
	const group = (table: typeof artTiles) => {
		const out = new Map<number, number[]>();
		for (const id of table.ids()) {
			const parent = table.getParent(id);
			if (parent === null) continue;
			const list = out.get(parent) ?? [];
			list.push(id);
			out.set(parent, list);
		}
		return out;
	};
	const artOf = new Map<number, number>();
	for (const id of xArt.ids()) {
		const uiMap = xArt.getParent(id);
		if (uiMap !== null && !artOf.has(uiMap)) artOf.set(uiMap, xArt.getInt(id, FIELDS.UiMapXMapArt.UiMapArtID) ?? 0);
	}
	const styleLayers = group(styles);
	const tilesOfArt = group(artTiles);
	const overlaysOfArt = group(overlays);
	const tilesOfOverlay = group(overlayTiles);
	const tilesOf = (table: typeof artTiles, ids: number[] | undefined): MapTile[] => (ids ?? [])
		.filter((t) => (table.getInt(t, FIELDS.UiMapArtTile.LayerIndex) ?? 0) === 0)
		.map((t) => ({ row: table.getInt(t, FIELDS.UiMapArtTile.RowIndex) ?? 0, col: table.getInt(t, FIELDS.UiMapArtTile.ColIndex) ?? 0, fdid: table.getInt(t, FIELDS.UiMapArtTile.FileDataID) ?? 0 }))
		.filter((t) => t.fdid && storage.status(t.fdid) === 'ok');

	const out: WorldMapInfo[] = [];
	for (const [id, list] of byMap) {
		const name = uiMaps.getString(id, FIELDS.UiMap.Name_lang);
		const type = uiMaps.getInt(id, FIELDS.UiMap.Type) ?? 0;
		const art = artOf.get(id);
		if (!name || !art || type < 1 || type > 3) continue;
		const style = arts.getInt(art, FIELDS.UiMapArt.UiMapArtStyleID) ?? 0;
		const layer = (styleLayers.get(style) ?? []).find((l) => (styles.getInt(l, FIELDS.UiMapArtStyleLayer.LayerIndex) ?? 0) === 0);
		if (layer === undefined) continue;
		const tiles = tilesOf(artTiles, tilesOfArt.get(art));
		if (!tiles.length) continue;
		out.push({
			id,
			name,
			parent: uiMaps.getInt(id, FIELDS.UiMap.ParentUiMapID) ?? 0,
			type,
			width: styles.getInt(layer, FIELDS.UiMapArtStyleLayer.LayerWidth) ?? 1002,
			height: styles.getInt(layer, FIELDS.UiMapArtStyleLayer.LayerHeight) ?? 668,
			tileWidth: styles.getInt(layer, FIELDS.UiMapArtStyleLayer.TileWidth) ?? 256,
			tileHeight: styles.getInt(layer, FIELDS.UiMapArtStyleLayer.TileHeight) ?? 256,
			tiles,
			overlays: (overlaysOfArt.get(art) ?? []).map((o) => ({
				areas: [0, 1, 2, 3].map((i) => overlays.getInt(o, FIELDS.WorldMapOverlay.AreaID, i) ?? 0).filter((a) => a),
				x: overlays.getInt(o, FIELDS.WorldMapOverlay.OffsetX) ?? 0,
				y: overlays.getInt(o, FIELDS.WorldMapOverlay.OffsetY) ?? 0,
				width: overlays.getInt(o, FIELDS.WorldMapOverlay.TextureWidth) ?? 0,
				height: overlays.getInt(o, FIELDS.WorldMapOverlay.TextureHeight) ?? 0,
				tiles: tilesOf(overlayTiles, tilesOfOverlay.get(o)),
				tileSize: OVERLAY_TILE,
			})).filter((o) => o.tiles.length && o.areas.length),
			assignments: list,
		});
	}
	return out;
}
