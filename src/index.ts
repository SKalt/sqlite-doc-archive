import { exists as _exists, createWriteStream } from "fs";
import { promisify } from "util";
import { resolve } from "path";
import { get } from "https";
import * as cheerio from "cheerio";

const exists = promisify(_exists);
const getHtml = (url: string): Promise<string> =>
  new Promise((resolve, reject) => {
    get(url, response => {
      let buffer = "";
      response
        .on("data", data => (buffer += data))
        .on("end", () => resolve(buffer))
        .on("error", error => reject(error));
    });
  });

const getZip = (url: string, file: string): Promise<void> =>
  new Promise((resolve, reject) => {
    get(url, response => {
      if (response.statusCode !== 200) return reject(response.statusCode)
      response.pipe(createWriteStream(file));
      response.on("end", resolve).on("error", reject);
    });
  });

async function getAllDownloadLinks() {
  const page = await getHtml("https://www.sqlite.org/chronology.html");
  const $ = cheerio.load(page);
  const rows = $("#chrontab tbody > tr");
  const cells = rows.toArray().map(row => {
    const [dateCell, versionCell] = $(row)
      .find("td")
      .toArray();
    const date = new Date($(dateCell).text());
    const link = $(versionCell)
      .find("a")
      .attr("href");
    const [major, minor, ...patch] = $(versionCell)
      .text()
      .split(".")
      .map(n => Number(n));
    const sort = $(row)
      .find("td:nth-child(2)")
      .data("sortkey");
    return { date, major, minor, patch, link, sort };
  });
  type Cell = typeof cells extends Array<infer U> ? U : never;
  const index = cells.reduce((a, r) => {
    let i = `${r.major}.${r.minor}`;
    a[i] = (a[i] || []).concat(r).sort((a, b) => +b.date - +a.date);
    return a;
  }, {} as { [k: string]: Cell[] });

  let result = Object.entries(index)
    .map(([name, v]) => [name, v[0]] as [string, Cell])
    .filter(([, v]) => typeof v !== "string" && v.major >= 3)
    .map(
      ([n, v]: [string, Cell]) =>
        [
          n,
          `https://sqlite.org/${v.date.getFullYear()}/sqlite-doc-${v.sort}.zip`
        ] as [string, string]
    )
    .reduce((a, [version, url]) => ({ ...a, [version]: url }), {});
  return result;
}

getAllDownloadLinks().then(async (versions: { [version: string]: string }) => {
  const _versions = Object.entries(versions);
  for (let [version, url] of _versions) {
    const target = resolve(__dirname, `./downloaded/${version}.zip`);
    if (!(await exists(target))) {
      console.log(`downloading ${version}...`);
      await getZip(url, target).catch(e =>
        console.error(`failed to download ${version}: ${e}`)
      );
    } else {
      console.log(`${version} already downloaded`)
    }
  }
});
