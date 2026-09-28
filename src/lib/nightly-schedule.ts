/** Today's run time for a nightly job, from an `HH:mm` UTC time. */
export function nightlyScheduleForDate(time: string, now: Date) {
	const match = /^([01]\d|2[0-3]):([0-5]\d)$/u.exec(time);
	if (!match) throw new Error("nightlyUtcTime must use HH:mm");
	return new Date(
		Date.UTC(
			now.getUTCFullYear(),
			now.getUTCMonth(),
			now.getUTCDate(),
			Number(match[1]),
			Number(match[2]),
		),
	);
}
