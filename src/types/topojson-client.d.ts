declare module "topojson-client" {
	/** Converts one object of a topology to GeoJSON. Only the call the About map makes is declared. */
	export function feature(topology: unknown, object: unknown): import("geojson").FeatureCollection;
}
