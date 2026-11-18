/** Where a removed record's published file waits, out of public view, until the record is restored (withdrawn-files). */
export const hiddenPath = (publicPath: string) => `withdrawn/${publicPath}`;
