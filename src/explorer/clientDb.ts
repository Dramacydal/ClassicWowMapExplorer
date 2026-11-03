import type { CascStorage } from '../casc/storage';
import { Db2 } from '../formats/db2';
import { fieldMap } from './db2Layouts';
import type { LiquidKind } from '../formats/mh2o';
import { DB2_FILES } from './db2Files';
import { FIELDS } from './db2Layouts.generated';

export { DB2_FILES };

const tables = new WeakMap<CascStorage, Map<number, Promise<Db2>>>();

/**
 * Loads a table once per storage, its fields numbered as Forever's are (see db2Layouts.ts).
 * Encrypted sections are skipped rather than failing.
 */
export function loadTable(storage: CascStorage, fdid: number): Promise<Db2> {
	let cache = tables.get(storage);
	if (!cache) {
		cache = new Map();
		tables.set(storage, cache);
	}
	let table = cache.get(fdid);
	if (!table) {
		table = storage.readFileWithStatus(fdid, true).then(({ data }) => {
			const db = new Db2(data);
			// Another game version's layout, read with Forever's field numbers.
			const map = fieldMap(fdid, db.layoutHash);
			if (map) db.mapFields(map);
			return db;
		});
		cache.set(fdid, table);
	}
	return table;
}

/** How a liquid looks from inside it (LiquidType.db2). */
export interface LiquidLook {
	/** The deep colour the view fades to, 0xRRGGBB; 0 when the type has none (older liquids). */
	color: number;
	/** The surface's colours from the shore to deep water, 0xRRGGBB; 0 where the type has none. */
	colors: [number, number, number];
	/** Foam along the shore, 0xRRGGBB; 0 where the type has none. */
	foam: number;
	/** Yards below the surface at which darkening is complete, and how much it darkens fog, ambient and sun light (0-1). */
	darkenDepth: number;
	fogDarken: number;
	ambientDarken: number;
	sunDarken: number;
}

export interface LiquidLooks {
	types: Record<number, LiquidLook>;
	/** The type of the open sea (drawn as one plane, so it has no type of its own). */
	ocean: number;
}


/** Underwater looks of every liquid type. */
export async function liquidLooks(storage: CascStorage): Promise<LiquidLooks> {
	const table = await loadTable(storage, DB2_FILES.LiquidType);
	const types: Record<number, LiquidLook> = {};
	let ocean = 2;
	for (const id of table.ids()) {
		const name = table.getString(id, FIELDS.LiquidType.Name) ?? '';
		if (name === 'PBRWater - Generic - Ocean') ocean = id;
		// Three colours, lightest to deepest; the view fades to the deepest. Only the newer
		// (PBRWater) types have them, and only those have a foam colour too.
		const colors = [0, 1, 2].map((k) => (table.getInt(id, FIELDS.LiquidType.Color, k) ?? 0) & 0xffffff) as [number, number, number];
		types[id] = {
			color: colors[2],
			colors,
			// The foam colour is kept in the field named MinimapStaticCol.
			foam: colors[2] ? (table.getInt(id, FIELDS.LiquidType.MinimapStaticCol) ?? 0) & 0xffffff : 0,
			darkenDepth: table.getFloat(id, FIELDS.LiquidType.MaxDarkenDepth) ?? 0,
			fogDarken: table.getFloat(id, FIELDS.LiquidType.FogDarkenIntensity) ?? 0,
			ambientDarken: table.getFloat(id, FIELDS.LiquidType.AmbDarkenIntensity) ?? 0,
			sunDarken: table.getFloat(id, FIELDS.LiquidType.DirDarkenIntensity) ?? 0,
		};
	}
	return { types, ocean };
}

/** What opening a lock takes: a gathering skill, or picking it. */
export type LockKind = 'herb' | 'ore' | 'lockbox';

/** Lock.Index, Skill and Type are arrays of 8. Key type 2 is a lock type (LockType.db2), whose ID is in the index field. */
const KEY_LOCK_TYPE = 2;
const LOCK_KINDS: Record<number, LockKind> = { 1: 'lockbox', 2: 'herb', 3: 'ore' };

/**
 * Locks that take Herbalism, Mining or Lockpicking, by Lock ID (game object data0 for chests,
 * which is what herbs and ore veins are). Quest objects gathered without the skill need none.
 */
export async function lockKinds(storage: CascStorage): Promise<Record<number, LockKind>> {
	const table = await loadTable(storage, DB2_FILES.Lock);
	const kinds: Record<number, LockKind> = {};
	for (const id of table.ids()) {
		for (let k = 0; k < 8; k++) {
			const kind = LOCK_KINDS[table.getInt(id, FIELDS.Lock.Index, k) ?? 0];
			if (kind && table.getInt(id, FIELDS.Lock.Type, k) === KEY_LOCK_TYPE && (table.getInt(id, FIELDS.Lock.Skill, k) ?? 0) > 0) {
				kinds[id] = kind;
				break;
			}
		}
	}
	return kinds;
}

/** Classifies liquid types by name ("Ocean", "Magma", "PBRWater - Generic - Lake", ...). */
export async function liquidKinds(storage: CascStorage): Promise<(type: number) => LiquidKind> {
	let table: Db2 | null = null;
	try {
		table = await loadTable(storage, DB2_FILES.LiquidType);
	} catch (e) {
		console.warn('LiquidType.db2 unavailable, treating all liquids as water', e);
	}
	const cache = new Map<number, LiquidKind>();
	return (type) => {
		let kind = cache.get(type);
		if (!kind) {
			const name = (table?.getString(type, FIELDS.LiquidType.Name) ?? '').toLowerCase();
			kind = /ocean|sea/.test(name) ? 'ocean' : /magma|lava/.test(name) ? 'magma' : /slime/.test(name) ? 'slime' : 'water';
			cache.set(type, kind);
		}
		return kind;
	};
}

/** What footsteps sound like, for every kind of creature on every kind of ground. */
export interface FootstepSounds {
	/** `creature footstep kind:ground sound group` -> [step files, splash files for shallow water]. */
	kits: Record<string, [number[], number[]]>;
	/** TerrainType ID -> ground sound group, for buildings' materials (terrain cells come grouped already). */
	groups: Record<number, number>;
}

/** FootstepTerrainLookup's ground column: the TerrainType sound group, counted from here. */
const FOOTSTEP_GROUND_BASE = 512;

/**
 * FootstepTerrainLookup (creature footstep kind, ground as 512 + TerrainType sound group, step
 * sound kit and splash kit), with each kit's files (SoundKitEntry).
 */
export async function footstepSounds(storage: CascStorage): Promise<FootstepSounds> {
	const [lookup, entries, terrainTypes] = await Promise.all([
		loadTable(storage, DB2_FILES.FootstepTerrainLookup),
		loadTable(storage, DB2_FILES.SoundKitEntry),
		loadTable(storage, DB2_FILES.TerrainType),
	]);
	const files = new Map<number, number[]>();
	for (const id of entries.ids()) {
		const file = entries.getInt(id, FIELDS.SoundKitEntry.FileDataID) ?? 0;
		if (!file || storage.status(file) !== 'ok') continue;
		const kit = entries.getInt(id, FIELDS.SoundKitEntry.SoundKitID) ?? 0;
		const list = files.get(kit) ?? [];
		list.push(file);
		files.set(kit, list);
	}
	const kits: FootstepSounds['kits'] = {};
	for (const id of lookup.ids()) {
		const step = files.get(lookup.getInt(id, FIELDS.FootstepTerrainLookup.SoundID) ?? 0) ?? [];
		const splash = files.get(lookup.getInt(id, FIELDS.FootstepTerrainLookup.SoundIDSplash) ?? 0) ?? [];
		if (!step.length && !splash.length) continue;
		kits[`${lookup.getInt(id, FIELDS.FootstepTerrainLookup.CreatureFootstepID) ?? 0}:${(lookup.getInt(id, FIELDS.FootstepTerrainLookup.TerrainSoundID) ?? 0) - FOOTSTEP_GROUND_BASE}`] = [step, splash];
	}
	const groups: FootstepSounds['groups'] = {};
	// TerrainType.SoundID is its sound group.
	for (const id of terrainTypes.ids()) groups[id] = terrainTypes.getInt(id, FIELDS.TerrainType.SoundID) ?? 0;
	return { kits, groups };
}
