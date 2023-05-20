import "dotenv/config";

import { chromium } from "playwright";
import { readFile, writeFile } from "node:fs/promises";

const previousAvailabilities = JSON.parse(
  await readFile(new URL("./availabilities.json", import.meta.url), "utf-8")
);

const browser = await chromium.launch();
const context = await browser.newContext();
const page = await context.newPage();
await page.goto("https://rdv.grandbesancon.fr/eAppointment/");
await page.getByRole("button", { name: "Suivant" }).click();
await page.getByRole("checkbox", { name: "CNI", exact: true }).check();
await page.getByRole("button", { name: "Suivant" }).click();
// List options
const select = page.getByRole("combobox", { name: "Choix d'un site" }).first();
await select.waitFor();
const optionsLocator = await select.locator("option").all();
const options = (
  await Promise.all(
    (
      await select.locator("option").all()
    ).map(async (option) => [
      await option.getAttribute("value"),
      await option.textContent(),
    ])
  )
).slice(1);
const availabilities = {};
// Iterate over options
for (const [option, label] of options) {
  await select.selectOption(option);
  await page.getByRole("link", { name: "Ouvrir le calendrier" }).click();
  await page.waitForTimeout(1500);
  const nodes = await page
    .getByRole("row")
    .locator('[data-event="click"]')
    .all();
  const texts = await Promise.all(
    nodes.map(async (node) => {
      const dayNumber = await node.textContent();
      const monthName = await page
        .locator(".ui-datepicker-group")
        .filter({ has: node })
        .locator(".ui-datepicker-title")
        .textContent();
      return `${dayNumber} ${monthName}`;
    })
  );
  availabilities[label] = texts;
}

await context.close();
await browser.close();

const sites = new Set([
  ...Object.keys(availabilities),
  ...Object.keys(previousAvailabilities),
]);

const newAvailabilities = {};

for (const site of sites) {
  const previous = previousAvailabilities[site] || [];
  const current = availabilities[site] || [];
  const diffAvailabilities = current.filter(
    (availability) => !previous.includes(availability)
  );
  if (diffAvailabilities.length > 0) {
    console.log(`New availabilities for ${site}: ${diffAvailabilities}`);
    newAvailabilities[site] = diffAvailabilities;
  }
}

if (Object.keys(newAvailabilities).length) {
  console.log("New availabilities found!");
  const url = new URL("https://smsapi.free-mobile.fr/sendmsg");
  const msg = [
    "Nouvelles disponibilités pour CNI !",
    ...Object.entries(newAvailabilities).map(
      ([site, availabilities]) => `${site}: ${availabilities.join(", ")}`
    ),
  ].join("\n");
  url.searchParams.set("user", process.env.FREE_USER);
  url.searchParams.set("pass", process.env.FREE_PASSWORD);
  url.searchParams.set("msg", msg);
  const res = await fetch(url);
  console.log(res.status);
  console.log(await res.text());
}

console.log(availabilities);

await writeFile(
  new URL("./availabilities.json", import.meta.url),
  JSON.stringify(availabilities, null, 2),
  "utf-8"
);
