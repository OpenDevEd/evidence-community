/** Where a country's marker sits on the world map. Projected on the server by `getWorldMap`, which also serves the outlines. */
export type MapShape = { code: string; x: number; y: number };

/** The outlines, fetched once and cached by the browser; each country's path is under its code. */
const WORLD = "/maps/world.svg";

export const MAP_WIDTH = 800;
export const MAP_HEIGHT = 400;
/** Where the southernmost land ends on the projection (Tierra del Fuego); below it is only ocean. */
const LAND_BOTTOM = 358;

type Props = {
	shapes: MapShape[];
	countries: Record<string, number>;
	className?: string;
	/** Fill the box like a background image (centre-cropped) instead of keeping the map's own height. */
	cover?: boolean;
	/** One circle per country, its area encoding the count, instead of shading the countries. */
	bubbles?: boolean;
	/** Country code to emphasise; `dim` fades the others while a preview is showing. */
	active?: string | null;
	dim?: boolean;
	onHover?: (code: string | null) => void;
	onSelect?: (code: string) => void;
};

/** Longest a staggered entrance may run, however many countries there are. */
const STAGGER_MS = 700;
const entrance = "[transform-box:fill-box] [transform-origin:center] motion-reduce:animate-none";

/** World map of the library's countries in the current text colour (set an accent class on it). The outlines arrive projected from the server; the library's countries then come in one after another, largest first. */
export default function HomeMap({ shapes, countries, className = "text-accent", cover = false, bubbles = false, active = null, dim = false, onHover, onSelect }: Props) {
	const max = Math.max(1, ...Object.values(countries));
	const ranked = shapes
		.flatMap((shape) => (countries[shape.code] ? [{ ...shape, count: countries[shape.code]! }] : []))
		.sort((a, b) => b.count - a.count);
	const delay = (rank: number) => ({ animationDelay: `${Math.round((STAGGER_MS * rank) / Math.max(1, ranked.length))}ms` });
	return (
		<div className={className} aria-hidden>
			{/* Covering a box, the map drops the empty ocean below the southernmost land and is anchored at the bottom:
			    whatever the box's shape costs comes off the Arctic, never the southern coasts. */}
			<svg viewBox={cover ? `0 0 ${MAP_WIDTH} ${LAND_BOTTOM}` : `0 0 ${MAP_WIDTH} ${MAP_HEIGHT}`} preserveAspectRatio={cover ? "xMidYMax slice" : undefined} className={cover ? "h-full w-full" : "h-auto w-full"}>
				{/* As a backdrop (cover) the countries are shapes only, without outlines. */}
				<g fill="currentColor" stroke={cover ? "none" : "currentColor"} strokeWidth={0.4} fillOpacity={bubbles ? 0.12 : 0.1} strokeOpacity={0.18}>
					<use href={`${WORLD}#land`} />
				</g>
				{!bubbles && ranked.map((shape, rank) => <use key={shape.code} href={`${WORLD}#${shape.code}`} fill="currentColor" stroke={cover ? "none" : "currentColor"} strokeWidth={0.4} strokeOpacity={0.7} fillOpacity={0.2 + (0.7 * shape.count) / max} className="animate-fade-in motion-reduce:animate-none" style={delay(rank)} />)}
				{bubbles &&
					ranked
						.map((shape, rank) => ({ ...shape, rank }))
						// Largest first, so a small circle is never buried under a large one; the emphasised one goes on top.
						.sort((a, b) => Number(a.code === active) - Number(b.code === active))
						.map((shape) => {
							const radius = 3 + 13 * Math.sqrt(shape.count / max);
							const current = shape.code === active;
							return (
								<g key={shape.code} transform={`translate(${shape.x} ${shape.y})`} onPointerEnter={() => onHover?.(shape.code)} onPointerLeave={() => onHover?.(null)} onClick={() => onSelect?.(shape.code)} className={onSelect ? "cursor-pointer" : undefined}>
									<g className={`animate-rise-in ${entrance}`} style={delay(shape.rank)}>
										<circle r={current ? Math.max(radius, 13) : radius} fill={current ? "var(--band-fg)" : "currentColor"} fillOpacity={dim && !current ? 0.3 : 0.9} stroke="var(--band-bg)" strokeWidth={1.5} className="transition-[fill-opacity,r] dark:[fill:var(--bubble-dark)] dark:[stroke:var(--band-bg-dark)]" style={{ "--bubble-dark": current ? "var(--band-fg-dark)" : "currentColor" } as React.CSSProperties} />
										{current && <text textAnchor="middle" dominantBaseline="central" fontSize={11} fontWeight={700} fill="var(--band-bg)" className="pointer-events-none dark:[fill:var(--band-bg-dark)]">{shape.count}</text>}
									</g>
								</g>
							);
						})}
			</svg>
		</div>
	);
}
