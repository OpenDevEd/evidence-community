export default function GapMap({ src }: { src: string }) {
	return (
		<div className="w-full flex-1 min-h-0 overflow-hidden rounded-2xl">
			<iframe
				src={src}
				className="w-full h-full border-none"
				title="Evidence Gap Map"
			/>
		</div>
	);
}
