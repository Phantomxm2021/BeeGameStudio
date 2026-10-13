// Only for isolated regression browsers. The production client never imports it.
export async function answerDebugConfirmation(page, accepted = true) {
  await page.locator('#action-confirm').waitFor({ state: 'visible' });
  await page.locator(accepted ? '#action-confirm-accept' : '#action-confirm-cancel').click();
}
