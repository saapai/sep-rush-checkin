#!/usr/bin/env node
import fs from 'fs';
import Airtable from 'airtable';

const envPath = fs.existsSync('/tmp/sep-prod-env') ? '/tmp/sep-prod-env' : new URL('.env', import.meta.url).pathname;
const envLines = fs.readFileSync(envPath, 'utf-8').split('\n');
for (const line of envLines) {
  const t = line.trim();
  if (!t || t.startsWith('#')) continue;
  const eq = t.indexOf('=');
  if (eq === -1) continue;
  const key = t.slice(0, eq).trim();
  let val = t.slice(eq + 1).trim();
  if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
  process.env[key] = val;
}

const TABLE = "Rush Spring '26";
const APPLY = process.argv.includes('--apply');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const base = new Airtable({ apiKey: process.env.VITE_AIRTABLE_API_KEY }).base(process.env.VITE_AIRTABLE_BASE_ID);

// Names to KEEP (everyone else gets rejected)
const KEEP_LIST = [
  "Htun Win",
  "Avyay Toprani",
  "Nhi Thanh",
  "Carine Suherman",
  "Omer Faran",
  "Alex Cismaru",
  "Jack Featherston",
  "Hayden Samala",
  "Sofia Llabres",
  "Amy Ganatra",
  "Suvan Yerramilli",
  "Ethan Donnelly",
  "Owen Pritchard",
  "Nikhil Sakthirajan",
  "Kavin Ramesh",
  "Kayla Tjenalooi",
  "Nancy Rios",
  "Christopher Tam",
  "Nams Doan",
  "Varsha Meda",
  "Sofia Valdez",
  "Jasmin Jabara",
  "Anna Tamayo",
  "Kim Vinh (Jerry) Vo",
  "Ariana Moolchandani",
  "Jason Yu",
  "Krishna Dhaneep",
  "Meg Villareal",
  "Aiera Mohsin",
  "Rocco Apostol",
  "Pinky Benson",
  "Jason Quach",
  "Ariya Ahmed",
  "Tyler Rose",
  "Rena Kim",
  "Sukrit Birmani",
  "Caroline Song",
  "Frank (Shuai) Liu",
  "Cecilia Liang",
  "Alyssa Rocha",
  "Aaron Zhang",
  "Pedro Hollanda",
  "Yvonna Schuckman",
  "Grace Chen",
  "Meher Talreja",
  "Hubert Tan",
  "Daniel Kim",
  "Colin Sohn",
  "Nerissa Yuan",
  "Hannah Nguyen",
  "Navya Rawal",
  "Farouk Zurayk",
  "Fatimah Almubarak",
  "Rehan Nagabandi",
  "Sai Marapareddy",
  "Sam Sadeghi",
  "Oliver van der Kouwe",
  "Iren Lam",
  "Sage Kodama",
  "Petr Fabian",
  "Baker Book",
  "Aurelia Bernier",
  "Angie Wang",
  "Caroline Gin",
  "Leah Ho",
  "Vera Liu",
  "Anaya McKail",
  "Neel Vyas",
  "Sophia Tan",
  "Noor Shamieh",
];

// Normalize a name for comparison: lowercase, collapse spaces
function normalize(name) {
  return name.toLowerCase().trim().replace(/\s+/g, ' ');
}

// Extract all name variants from a name (handles parentheticals like "Kim Vinh (Jerry) Vo")
function nameVariants(name) {
  const variants = [normalize(name)];
  // Strip parenthetical: "Kim Vinh (Jerry) Vo" -> "Kim Vinh Vo"
  const stripped = normalize(name.replace(/\s*\(.*?\)\s*/g, ' ').replace(/\s+/g, ' ').trim());
  if (stripped !== variants[0]) variants.push(stripped);
  // Extract parenthetical alias: "(Jerry)" -> "Jerry"
  const aliasMatch = name.match(/\(([^)]+)\)/);
  if (aliasMatch) {
    variants.push(normalize(aliasMatch[1]));
  }
  return variants;
}

// Build a normalized set from the keep list (all variants)
const keepVariants = new Set();
for (const name of KEEP_LIST) {
  for (const v of nameVariants(name)) {
    keepVariants.add(v);
  }
}

function isOnKeepList(recordName) {
  for (const v of nameVariants(recordName)) {
    if (keepVariants.has(v)) return true;
  }
  return false;
}

async function main() {
  console.log(`Mode: ${APPLY ? 'APPLY (will make changes)' : 'DRY RUN (no changes)'}\n`);

  const records = await base(TABLE).select({ maxRecords: 1000 }).all();
  const named = records.filter(r => (r.get('applicant_name') || '').trim() !== '');

  console.log(`Total named applicants: ${named.length}`);

  const toReject = named.filter(r => {
    const name = r.get('applicant_name') || '';
    const status = (r.get('status') || '').toLowerCase();
    if (status === 'rejected') return false; // already rejected, skip
    return !isOnKeepList(name);
  });

  const alreadyRejected = named.filter(r => (r.get('status') || '').toLowerCase() === 'rejected');
  const kept = named.filter(r => isOnKeepList(r.get('applicant_name') || ''));

  console.log(`Keep list matches: ${kept.length}`);
  console.log(`Already rejected (skipping): ${alreadyRejected.length}`);
  console.log(`To reject: ${toReject.length}\n`);

  if (toReject.length > 0) {
    console.log('--- Applicants to be rejected ---');
    toReject.forEach(r => {
      const name = r.get('applicant_name');
      const status = r.get('status') || 'no status';
      console.log(`  ${name} (${status})`);
    });
    console.log('');
  }

  // Sanity check: show any keep list names that didn't match a record
  const unmatchedKeep = KEEP_LIST.filter(keepName =>
    !named.some(r => isOnKeepList(r.get('applicant_name') || '') && nameVariants(r.get('applicant_name') || '').some(v => nameVariants(keepName).includes(v)))
  );
  if (unmatchedKeep.length > 0) {
    console.log('--- Keep list names with NO matching record (check spelling!) ---');
    unmatchedKeep.forEach(n => console.log(`  ${n}`));
    console.log('');
  }

  if (!APPLY) {
    console.log('Dry run complete. Run with --apply to make changes.');
    return;
  }

  // Batch update in groups of 10 (Airtable limit)
  for (let i = 0; i < toReject.length; i += 10) {
    const batch = toReject.slice(i, i + 10).map(r => ({
      id: r.id,
      fields: { status: 'Rejected' },
    }));
    await base(TABLE).update(batch);
    console.log(`Updated batch ${Math.floor(i / 10) + 1}/${Math.ceil(toReject.length / 10)}`);
    await sleep(200); // be gentle with the API
  }

  console.log(`\nDone. Rejected ${toReject.length} applicants.`);
}

main().catch(console.error);
