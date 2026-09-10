import { expect, type Page } from "@playwright/test";

/** Publish the frozen submission through the same controls an editor uses. */
export async function publishWorkingDraft(page: Page) {
  const inspector = page.locator("#admin-inspector-pane");
  const key = new URL(page.url()).searchParams.get("item");
  if (!key) throw new Error("The inspector has no selected item");
  const edit = inspector.getByRole("button", {name: "Edit", exact: true});
  if (await edit.isVisible()) await edit.click();
  await inspector.getByRole("button", {name: "Submit for review", exact: true}).click();
  const submit = page.getByRole("dialog", {name: "Submit snapshot for review?"});
  await submit.getByRole("button", {name: "Submit snapshot", exact: true}).click();
  await expect(submit).toBeHidden();
  await inspector.getByRole("button", {name: "Submitted version", exact: true}).click();
  await inspector.getByRole("button", {name: "Publish version", exact: true}).click();
  const publish = page.getByRole("dialog", {name: "Publish submitted version"});
  await publish.getByRole("button", {name: "Publish version", exact: true}).click();
  await expect(publish).toBeHidden({timeout: 60_000});
  await expect.poll(async () => {
    const response = await page.request.get(new URL(`/api/admin/items/${key}/review`, page.url()).toString());
    return (await response.json()).reviews[0]?.state;
  }).toBe("published");
  const workingDraft = inspector.getByRole("button", {name: "Working draft", exact: true});
  await workingDraft.click();
  await expect(workingDraft).toHaveAttribute("aria-pressed", "true");
  return key;
}
