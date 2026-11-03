import type { CascStorage } from '../casc/storage';
import type { Db2 } from '../formats/db2';
import { DB2_FILES, loadTable } from './clientDb';
import { FIELDS } from './db2Layouts.generated';

/** A zone's music (ZoneMusic.db2): tracks by day and night, and the quiet between them. */
export interface MusicSet {
	name: string;
	day: number[];
	night: number[];
	/** Silence between tracks, ms. */
	silence: [number, number];
}

/** A fanfare played on arriving somewhere (ZoneIntroMusicTable.db2), at most once per minDelay minutes. */
export interface MusicIntro {
	name: string;
	files: number[];
	minDelay: number;
}

export interface MusicData {
	sets: Record<number, MusicSet>;
	intros: Record<number, MusicIntro>;
	/** AreaTable ID -> ZoneMusic ID and intro ID, for areas that have either. */
	areas: Record<number, { music: number; intro: number }>;
	/** AreaTable ID -> its underwater ambience (SoundAmbience ID), where it differs from the usual one. */
	underwater: Record<number, number>;
	/** The underwater ambience most areas use. */
	underwaterDefault: number;
	/** Sounds of the underwater ambiences: a loop, and one-offs on going under and coming up. */
	ambiences: Record<number, { loop: number[]; enter: number[]; exit: number[] }>;
	/** AreaTable ID -> its background ambience (SoundAmbience ID), for areas that set one. */
	areaAmbience: Record<number, number>;
	/** Background loops of every ambience (birds, wind, city bustle), by day and night. */
	backgrounds: Record<number, { day: number[]; night: number[] }>;
}

/** A room of a building (WMOAreaTable.db2): its own name, music and intro, and the area it belongs to. */
export interface WmoArea {
	name: string | null;
	music: number;
	intro: number;
	/** SoundAmbience ID, 0 for none. */
	ambience: number;
	area: number;
}

// SoundAmbience.SoundKitID is another [day, night] pair, but one kit for nearly every ambience (Ironforge and
// Undercity too): steady wind noise far louder than the loops, so it isn't played.

/** Music tables, read once. Sound kits are resolved to their files (MP3s) here. */
export class MusicTables {
	private data: Promise<MusicData> | null = null;
	private wmoRows: Promise<Map<string, number>> | null = null;

	constructor(private readonly storage: CascStorage) {}

	load(): Promise<MusicData> {
		this.data ??= this.read();
		return this.data;
	}

	private async read(): Promise<MusicData> {
		const [areaTable, music, intro, kits, ambience] = await Promise.all([
			loadTable(this.storage, DB2_FILES.AreaTable),
			loadTable(this.storage, DB2_FILES.ZoneMusic),
			loadTable(this.storage, DB2_FILES.ZoneIntroMusicTable),
			loadTable(this.storage, DB2_FILES.SoundKitEntry),
			loadTable(this.storage, DB2_FILES.SoundAmbience),
		]);
		const files = new Map<number, number[]>();
		for (const id of kits.ids()) {
			const kit = kits.getInt(id, FIELDS.SoundKitEntry.SoundKitID) ?? 0;
			const file = kits.getInt(id, FIELDS.SoundKitEntry.FileDataID) ?? 0;
			if (!kit || !file) continue;
			const list = files.get(kit);
			if (list) list.push(file);
			else files.set(kit, [file]);
		}
		const filesOf = (kit: number | null) => (kit ? files.get(kit) ?? [] : []);

		const sets: MusicData['sets'] = {};
		for (const id of music.ids()) {
			sets[id] = {
				name: music.getString(id, FIELDS.ZoneMusic.SetName) ?? `Music ${id}`,
				day: filesOf(music.getInt(id, FIELDS.ZoneMusic.Sounds, 0)),
				night: filesOf(music.getInt(id, FIELDS.ZoneMusic.Sounds, 1)),
				silence: [music.getInt(id, FIELDS.ZoneMusic.SilenceIntervalMin, 0) ?? 0, music.getInt(id, FIELDS.ZoneMusic.SilenceIntervalMax, 0) ?? 0],
			};
		}
		const intros: MusicData['intros'] = {};
		for (const id of intro.ids()) {
			const list = filesOf(intro.getInt(id, FIELDS.ZoneIntroMusicTable.SoundID));
			if (list.length) intros[id] = { name: intro.getString(id, FIELDS.ZoneIntroMusicTable.Name) ?? `Intro ${id}`, files: list, minDelay: intro.getInt(id, FIELDS.ZoneIntroMusicTable.MinDelayMinutes) ?? 0 };
		}
		const areas: MusicData['areas'] = {};
		for (const id of areaTable.ids()) {
			const m = areaTable.getInt(id, FIELDS.AreaTable.ZoneMusic) ?? 0;
			const i = areaTable.getInt(id, FIELDS.AreaTable.IntroSound) ?? 0;
			if (m || i) areas[id] = { music: m, intro: i };
		}

		// Underwater ambience per area; nearly all share one, so only the others are listed.
		const counts = new Map<number, number>();
		for (const id of areaTable.ids()) {
			const a = areaTable.getInt(id, FIELDS.AreaTable.UwAmbience) ?? 0;
			if (a) counts.set(a, (counts.get(a) ?? 0) + 1);
		}
		const underwaterDefault = [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 0;
		const underwater: MusicData['underwater'] = {};
		for (const id of areaTable.ids()) {
			const a = areaTable.getInt(id, FIELDS.AreaTable.UwAmbience) ?? 0;
			if (a && a !== underwaterDefault) underwater[id] = a;
		}
		const ambiences: MusicData['ambiences'] = {};
		for (const id of counts.keys()) {
			if (!ambience.has(id)) continue;
			ambiences[id] = {
				loop: filesOf(ambience.getInt(id, FIELDS.SoundAmbience.AmbienceID, 0)),
				enter: filesOf(ambience.getInt(id, FIELDS.SoundAmbience.AmbienceStartID, 0)),
				exit: filesOf(ambience.getInt(id, FIELDS.SoundAmbience.AmbienceStopID, 0)),
			};
		}

		// Background ambience per area, and the loops of every ambience (rooms of buildings have their own).
		const areaAmbience: MusicData['areaAmbience'] = {};
		for (const id of areaTable.ids()) {
			const a = areaTable.getInt(id, FIELDS.AreaTable.AmbienceID) ?? 0;
			if (a) areaAmbience[id] = a;
		}
		const backgrounds: MusicData['backgrounds'] = {};
		for (const id of ambience.ids()) {
			const day = filesOf(ambience.getInt(id, FIELDS.SoundAmbience.AmbienceID, 0));
			const night = filesOf(ambience.getInt(id, FIELDS.SoundAmbience.AmbienceID, 1));
			if (day.length || night.length) backgrounds[id] = { day, night };
		}
		return { sets, intros, areas, underwater, underwaterDefault, ambiences, areaAmbience, backgrounds };
	}

	/**
	 * The room of a building: its own row, with the building's default row (group -1) filling in
	 * what the room leaves unset. Null when the building has neither.
	 */
	async wmoArea(wmoId: number, nameSet: number, groupId: number): Promise<WmoArea | null> {
		const table = await loadTable(this.storage, DB2_FILES.WMOAreaTable);
		this.wmoRows ??= Promise.resolve(indexWmoRows(table));
		const rows = await this.wmoRows;
		const read = (row: number | undefined): WmoArea | null => row === undefined ? null : {
			name: table.getString(row, FIELDS.WMOAreaTable.AreaName_lang) || null,
			music: table.getInt(row, FIELDS.WMOAreaTable.ZoneMusic) ?? 0,
			intro: table.getInt(row, FIELDS.WMOAreaTable.IntroSound) ?? 0,
			ambience: table.getInt(row, FIELDS.WMOAreaTable.AmbienceID) ?? 0,
			area: table.getInt(row, FIELDS.WMOAreaTable.AreaTableID) ?? 0,
		};
		const room = read(rows.get(`${wmoId}:${nameSet}:${groupId}`));
		const building = read(rows.get(`${wmoId}:${nameSet}:-1`));
		if (!room) return building;
		if (!building) return room;
		return {
			name: room.name ?? building.name,
			music: room.music || building.music,
			intro: room.intro || building.intro,
			ambience: room.ambience || building.ambience,
			area: room.area || building.area,
		};
	}
}

function indexWmoRows(table: Db2): Map<string, number> {
	const rows = new Map<string, number>();
	for (const id of table.ids()) rows.set(`${table.getInt(id, FIELDS.WMOAreaTable.WMOID)}:${table.getInt(id, FIELDS.WMOAreaTable.NameSetID)}:${table.getInt(id, FIELDS.WMOAreaTable.WMOGroupID)}`, id);
	return rows;
}
