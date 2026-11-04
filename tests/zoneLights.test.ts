import { expect, test } from 'bun:test';
import { FIELDS } from '../src/explorer/fields';
import { insidePolygon, zoneLightZones, type LightingData, type Polygon } from '../src/explorer/lighting';
import { Lighting } from '../src/viewer/lighting';

type Row = Record<number, number | string | number[]>;

function table(rows: Record<number, Row>, parents: Record<number, number> = {}) {
	const value = (id: number, field: number, index: number) => {
		const v = rows[id]?.[field];
		return Array.isArray(v) ? v[index] ?? null : v ?? null;
	};
	return {
		ids: () => Object.keys(rows).map(Number),
		getInt: (id: number, field: number, index = 0) => value(id, field, index) as number | null,
		getFloat: (id: number, field: number, index = 0) => value(id, field, index) as number | null,
		getString: (id: number, field: number) => value(id, field, 0) as string | null,
		getParent: (id: number) => parents[id] ?? null,
	};
}

const square = (x0: number, y0: number, x1: number, y1: number): Polygon => ({ points: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]], min: [x0, y0], max: [x1, y1] });

test('a point is inside a polygon when it is within its edges', () => {
	const l: Polygon = { points: [[0, 0], [10, 0], [10, 4], [4, 4], [4, 10], [0, 10]], min: [0, 0], max: [10, 10] };
	expect(insidePolygon(l, 2, 2)).toBe(true);
	expect(insidePolygon(l, 8, 2)).toBe(true);
	// The notch of the L, and past its box.
	expect(insidePolygon(l, 8, 8)).toBe(false);
	expect(insidePolygon(l, 11, 2)).toBe(false);
});

test('the zone lights of the maps asked for are polygons that have the params of their Light, points in their order', () => {
	const zoneLights = table({
		1: { [FIELDS.ZoneLight.MapID]: 530, [FIELDS.ZoneLight.LightID]: 460 },
		// Another map, one with no Light params, and one with too few points.
		2: { [FIELDS.ZoneLight.MapID]: 0, [FIELDS.ZoneLight.LightID]: 460 },
		3: { [FIELDS.ZoneLight.MapID]: 530, [FIELDS.ZoneLight.LightID]: 9 },
		4: { [FIELDS.ZoneLight.MapID]: 530, [FIELDS.ZoneLight.LightID]: 460 },
	});
	const P = FIELDS.ZoneLightPoint;
	const points = table(
		{
			1: { [P.Pos]: [10, 10], [P.PointOrder]: 2 },
			2: { [P.Pos]: [0, 0], [P.PointOrder]: 0 },
			3: { [P.Pos]: [10, 0], [P.PointOrder]: 1 },
			4: { [P.Pos]: [0, 10], [P.PointOrder]: 3 },
			5: { [P.Pos]: [0, 0], [P.PointOrder]: 0 },
			6: { [P.Pos]: [1, 1], [P.PointOrder]: 1 },
		},
		{ 1: 1, 2: 1, 3: 1, 4: 1, 5: 4, 6: 4 },
	);
	const lights = table({ 460: { [FIELDS.Light.LightParamsID]: [432] }, 9: { [FIELDS.Light.LightParamsID]: [0] } });
	const zones = zoneLightZones(zoneLights, points, lights, [530]);
	expect(zones).toHaveLength(1);
	expect(zones[0]).toMatchObject({ mapId: 530, params: 432 });
	expect(zones[0].polygon).toEqual({ points: [[0, 0], [10, 0], [10, 10], [0, 10]], min: [0, 0], max: [10, 10] });
});

test('inside a zone light the light is its own, and outside it the map\'s global light', () => {
	const key = (color: number) => [{ time: 0, colors: new Array(17).fill(color), fogEnd: 0, fogScaler: 0, grading: 0, fogDensity: 1 }];
	const data: LightingData = {
		zones: [
			{ mapId: 530, x: 0, y: 0, z: 0, inner: 0, outer: 0, params: 1 },
			{ mapId: 530, x: 0, y: 0, z: 0, inner: 0, outer: 0, params: 2, polygon: square(0, 0, 10, 10) },
		],
		keys: { 1: key(0xff0000), 2: key(0x0000ff) },
	};
	const lighting = new Lighting(data);
	expect(lighting.sample(530, 5, 5, 0)!.colors.skyTop.getHex()).toBe(0x0000ff);
	expect(lighting.sample(530, 50, 5, 0)!.colors.skyTop.getHex()).toBe(0xff0000);
});
