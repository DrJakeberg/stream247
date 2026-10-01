#!/usr/bin/env node
import { writeFileSync } from "node:fs";
import { parseDeclaredSchema, renderManifest } from "./lib/schema-manifest.mjs";

const schema = parseDeclaredSchema("packages/db/src/index.ts");
writeFileSync("packages/db/src/schema-manifest.ts", renderManifest(schema));
const columns = Object.values(schema).reduce((total, list) => total + list.length, 0);
console.log(`schema-manifest.ts: ${String(Object.keys(schema).length)} Tabellen, ${String(columns)} Spalten`);
