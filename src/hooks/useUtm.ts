import { STORAGE_KEY, StoredUtm } from "@/components/features/UtmProvider";
import { useLocalStorage } from "usehooks-ts";

export function useUtm() {
	const [stored] = useLocalStorage<StoredUtm | null>(
		STORAGE_KEY,
		null
	);

	return stored;
}