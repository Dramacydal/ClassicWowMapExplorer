/**
 * The fields of the client database tables that the code reads, by table. A field's number is its
 * position in its table's list, and the layouts of each game version (db2Layouts.generated.ts, made
 * by `bun run layouts`) say where in that version's table each of them is. A field is named as in
 * WoWDBDefs, or [the name here, the name there] where the code's name says more.
 */
type FieldSpec = string | readonly [name: string, dbdName: string];
type NameOf<S> = S extends readonly [infer N extends string, string] ? N : S extends string ? S : never;
type Spec = Record<string, readonly FieldSpec[]>;

const SPEC = {
	AreaPOI: ['Name_lang', 'Description_lang', 'Pos', 'PlayerConditionID', 'Flags', 'ContinentID'],
	AreaTable: ['AreaName_lang', 'ParentAreaID', 'AmbienceID', 'UwAmbience', 'ZoneMusic', 'IntroSound'],
	ChrCustomizationChoice: ['OrderIndex'],
	ChrCustomizationElement: [
		'ChrCustomizationChoiceID', 'RelatedChrCustomizationChoiceID', 'ChrCustomizationGeosetID',
		'ChrCustomizationMaterialID',
	],
	ChrCustomizationGeoset: ['GeosetType', 'GeosetID'],
	ChrCustomizationMaterial: ['MaterialResourcesID'],
	ChrCustomizationOption: ['Name_lang'],
	ComponentModelFileData: ['GenderIndex', 'RaceID', 'PositionIndex'],
	CreatureDisplayInfo: ['ModelID', 'SoundID', 'CreatureModelScale', 'ExtendedDisplayInfoID', 'TextureVariationFileDataID'],
	CreatureDisplayInfoExtra: ['DisplayRaceID', 'DisplaySexID', 'BakeMaterialResourcesID', 'HDBakeMaterialResourcesID'],
	CreatureDisplayInfoOption: ['ChrCustomizationOptionID', 'ChrCustomizationChoiceID'],
	CreatureModelData: ['FileDataID', 'SoundID'],
	CreatureSoundData: ['SoundFootstepID'],
	FactionTemplate: ['FactionGroup', 'FriendGroup', 'EnemyGroup'],
	FootstepTerrainLookup: ['CreatureFootstepID', 'TerrainSoundID', 'SoundID', 'SoundIDSplash'],
	GameObjectDisplayInfo: ['FileDataID'],
	GroundEffectDoodad: ['ModelFileID', 'Animscale', 'Size_variation_min', 'Size_variation_max', 'Rotation_variation_max'],
	GroundEffectTexture: ['Density', ['TerrainType', 'Sound'], 'DoodadID', 'DoodadWeight'],
	HelmetGeosetData: ['RaceID', 'HideGeosetGroup'],
	ItemDisplayInfo: ['ModelResourcesID', 'ModelMaterialResourcesID', 'GeosetGroup', 'HelmetGeosetVis'],
	Light: ['GameCoords', 'GameFalloffStart', 'GameFalloffEnd', 'ContinentID', 'LightParamsID'],
	// The colours from DirectColor to RiverFarColor are in a row: lighting.ts reads them by their distance from the first.
	LightData: [
		'LightParamID', 'Time', 'DirectColor', 'AmbientColor', 'SkyTopColor', 'SkyMiddleColor', 'SkyBand1Color',
		'SkyBand2Color', 'SkySmogColor', 'SkyFogColor', 'SunColor', 'CloudSunColor', 'CloudEmissiveColor',
		'CloudLayer1AmbientColor', 'CloudLayer2AmbientColor', 'OceanCloseColor', 'OceanFarColor', 'RiverCloseColor',
		'RiverFarColor', 'FogEnd', 'FogScaler', 'ColorGradingFileDataID',
		['FogDensity', 'Field_1_60_1_69876_051'],
	],
	LiquidType: [
		'Name', 'MaxDarkenDepth', 'FogDarkenIntensity', 'AmbDarkenIntensity', 'DirDarkenIntensity',
		['FoamColor', 'MinimapStaticCol'], 'Color',
	],
	Lock: ['Index', 'Skill', 'Type'],
	Map: ['Directory', 'MapName_lang', 'InstanceType', 'WdtFileDataID'],
	ModelFileData: ['ModelResourcesID'],
	NPCModelItemSlotDisplayInfo: ['ItemDisplayInfoID', 'ItemSlot'],
	SoundAmbience: ['AmbienceID', 'AmbienceStartID', 'AmbienceStopID'],
	SoundKitEntry: ['SoundKitID', 'FileDataID'],
	TaxiNodes: ['Name_lang', 'Pos', 'ContinentID', 'CharacterBitNumber', 'Flags'],
	TaxiPath: ['FromTaxiNode', 'ToTaxiNode', 'Cost'],
	TaxiPathNode: ['Loc', 'PathID', 'NodeIndex', 'ContinentID', 'Flags', 'Delay'],
	TerrainType: ['SoundID'],
	TextureFileData: ['MaterialResourcesID'],
	UiMap: ['Name_lang', 'ParentUiMapID', 'System', 'Type'],
	UiMapArt: ['UiMapArtStyleID'],
	UiMapArtStyleLayer: ['LayerIndex', 'LayerWidth', 'LayerHeight', 'TileWidth', 'TileHeight'],
	UiMapArtTile: ['RowIndex', 'ColIndex', 'LayerIndex', 'FileDataID'],
	UiMapAssignment: ['UiMin', 'UiMax', 'Region', 'UiMapID', 'MapID', 'AreaID'],
	UiMapXMapArt: ['UiMapArtID'],
	WMOAreaTable: ['AreaName_lang', 'WMOID', 'NameSetID', 'WMOGroupID', 'AmbienceID', 'ZoneMusic', 'IntroSound', 'AreaTableID'],
	WorldMapOverlay: ['TextureWidth', 'TextureHeight', 'OffsetX', 'OffsetY', 'AreaID'],
	WorldMapOverlayTile: ['RowIndex', 'ColIndex', 'LayerIndex', 'FileDataID'],
	ZoneIntroMusicTable: ['Name', 'SoundID', 'MinDelayMinutes'],
	// Regions of the world with a light of their own, as polygons of points (the zone a point belongs to is its parent).
	ZoneLight: ['Name', 'MapID', 'LightID', 'Flags', 'Zmin', 'Zmax'],
	ZoneLightPoint: ['Pos', 'PointOrder'],
	ZoneMusic: ['SetName', 'SilenceIntervalMin', 'SilenceIntervalMax', 'Sounds'],
} as const satisfies Spec;

const nameOf = (field: FieldSpec) => (typeof field === 'string' ? field : field[0]);
const sourceOf = (field: FieldSpec) => (typeof field === 'string' ? field : field[1]);

/** Field numbers by table and field name. */
export const FIELDS = Object.fromEntries(
	Object.entries(SPEC).map(([table, fields]) => [table, Object.fromEntries(fields.map((field, i) => [nameOf(field), i]))]),
) as { [T in keyof typeof SPEC]: { readonly [N in NameOf<(typeof SPEC)[T][number]>]: number } };

/** The WoWDBDefs name of each field, in field order, by table. */
export const FIELD_SOURCES: Record<string, string[]> = Object.fromEntries(
	Object.entries(SPEC).map(([table, fields]) => [table, fields.map(sourceOf)]),
);
