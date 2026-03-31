#!/usr/bin/env node
import fs from 'fs';
import Airtable from 'airtable';

const envLines = fs.readFileSync('/tmp/sep-prod-env', 'utf-8').split('\n');
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
const FIX = process.argv.includes('--fix');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const base = new Airtable({ apiKey: process.env.VITE_AIRTABLE_API_KEY }).base(process.env.VITE_AIRTABLE_BASE_ID);

const MEMBER = 'Franco';
const DAY_LABEL = 'Day 1';

const notes = [
  { name: 'Katie Chen', notes: 'Adopted a dog for a day. Recent obsession: EDM, Fred again' },
  { name: 'Avyay', notes: 'Went to Vegas for a day for Travis Scott. Wearing slides. Massive foodie. Recent obsession: pasta spot in LA' },
  { name: 'Mahi', notes: 'At 17yo, matching tattoos. Recent obsession: knitting, does it for her mom who is a little sick, everyday knits a new piece of clothing' },
  { name: 'Jack', notes: 'Went surfing, energetic. Good group dynamic. Recent obsession: playing guitar (inspired by Mac Demarco music)' },
  { name: 'Jian', notes: 'Stress eats. Couldn\'t find cookies and creme. Recent obsession: shopping (been happening for a while)' },
  { name: 'Linda', notes: 'First time driving, almost crashed — questionable social fit. Recent: creating new random accounts on social media' },
  { name: 'Arthur', notes: 'Did a lot of speech in middle school. On last day before application was due. Recent obsession: trying to write a paper about energy sources' },
  { name: 'Anaya', notes: 'Went to retreat the day before a physics final. Failed the final. Recent obsession: Claude code (said "I dont wanna sound nerdy"). Thinks Claude code is the best thing if youre trying to found something' },
  { name: 'Cecilia', notes: '1st year biz Econ, maybe pub aff, SF. Publicly sneak out of the house to go to beach with friend at midnight. Picked up playing the guitar, sister randomly bought it, learned via tiktok' },
  { name: 'Sofia Valdez', notes: 'First year Econ & cog sci, SF. Recurring impulsive behavior, books flights without telling parents, e.g. forgot to tell parents about a trip to Hawaii. Recent obsession: loos cafe, got free stuff, basically repeats food. Good social fit' },
  { name: 'Sukrit', notes: '1st year MECH-e & DSE, Jakarta. Parents used to work long hours, had a 5 day business trip away from Jakarta, home alone, booked a flight to Singapore then to universal. They never found out (strict Indian parents). Recent obsession: beli, wasn\'t on the app until 2 weeks ago. Good social fit' },
  { name: 'Natalie', notes: '1st year biz Econ & DSE, born in AUS grew up in China. Parents also in china, first time coming to USA she got 12 piercings in one day. Recent obsession: tarot reading, not religious but believes it a lot and its super fun. Great social fit' },
  { name: 'Nina', notes: '1st year stats & ds, Beijing. In high school, had an idea to open a cultural shop that charges ~$1k/year. Asked friends for money, built the online shop. Recent obsession: performing, loves that side of herself, also loves watching ai generated video' },
  { name: 'Simone', notes: '1st year Econ, Long Beach. Most impulsive thing: sophomore year of HS did a San Diego college trip, snuck out at midnight and was caught. Didn\'t answer last question, seemed very distracted/disinterested' },
  { name: 'Meher', notes: '1st year biz Econ, Dallas. Binged 5 seasons of selling sunset. Nose piercing: mystery metal, kept getting infected' },
  { name: 'Kim', notes: 'Third year mech e, Taiwan. Really into conspiracy theory. Went to Japan in the middle of the quarter' },
  { name: 'Elle', notes: '2nd year mech e, Sacramento. Recent obsession: f1 racing, got into it after cousin got into drive to survive. Very social but questionable social fit, keeps talking just because she\'s relating to everyone. Impulsive: cut hair at 2am' },
  { name: 'Atri', notes: 'San Diego. Recently obsessed with legos, was into them younger and now back into it. Last quarter very impulsive, every weekend tried doing something new, went skiing in mammoth, etc' },
  { name: 'Nams', notes: 'Singapore 2nd year. Recent obsession: ring collection. Had a health scare, got an aura ring, now kept expanding. Impulsive: spring break' },
  { name: 'Varsha', notes: '2nd year. Recent obsession: disposable cameras, used to not get them, now uses them for special cherished memories. Impulsive: coming to SEP. Great social fit!!!' },
  { name: 'Ariana', notes: '1st year transfer, Irvine. Baking. Good social fit. Impulsive: went to Australia' },
  { name: 'Amy', notes: 'Recent obsession: short TV shows with subway surfers split screen. Impulsive: taking highways for the first time' },
  { name: 'Aidan', notes: '2nd year Econ, Oakland. Great social fit. Would you rathers. Impulsive: coming here tonight' },
  { name: 'Dev', notes: '2nd year biz Econ, eastville. Recent obsession: game of thrones, that\'s his Roman Empire. Impulsive: 2 weeks ago, went up to big bear' },
  { name: 'Matthew', notes: 'Irvine. Recent obsession: pickleball' },
  { name: 'Spencer', notes: '1st year Toronto. Recently obsessed with openclaw and stuff, not a CS guy tho, building "agents", buzzword soup. Great social fit. Impulsive: sailed length of Lake Ontario because traffic was bad' },
  { name: 'Arhaan', notes: '1st year applied math, Delhi. Recent obsession: f1 racing. Changed his flight on the way to the airport' },
  { name: 'Madhu', notes: 'Seattle. Recent obsession: "youre by yourself maxxing" - clavicular. Drove to Canada' },
  { name: 'Rena', notes: 'Palo Alto. Recent obsession: @democrats on instagram. Super great social fit. Korea over the summer, invited her friends' },
  { name: 'Ryan', notes: '2nd year Oakland. Recent obsession: making different playlists. Solo trip to Puerto Rico 2 days notice' },
  { name: 'Krishna', notes: '1st year aerospace. Recent obsession: motorcycles, fell in love with it last summer, been fixing up a $100 bike trying to get it running. Great social. Partner at exotic car company, usually just does backend, one time had the chance to help deliver a car for DRAKE' },
  { name: 'Chris', notes: '1st year biz econ, west covina. Recent obsession: surfing & raving (went to beyond recently). Energetic. Impulsive: tattoo' },
  { name: 'Anna', notes: '1st year biz econ. Current obsession: google flights. Left/right game driving' },
  { name: 'Aurelia', notes: '2nd year chem & econ, malaysia. Current obsession: geography games. Lived in 5 countries (Thailand, Vietnam, Indonesia, Malaysia, UAE). Great social fit. Went to beyond impulsively' },
  { name: 'Meg', notes: '2nd year, Long Beach. Drove to Dominic Fike without tickets' },
  { name: 'Daniel', notes: 'First year applied math, Hong Kong' },
  { name: 'Elisa', notes: '2nd year cog sci, NJ. NY, boarded the wrong ferry, met a family from Colombia, talked to them and decided to meet up in chinatown. Recent obsession: meal prep' },
  { name: 'Hubert', notes: '1st year. Used to always go skiing, maxxed out on blue, one time was on a random slope and didnt know the difficulty, realized after it was a black diamond (Tahoe). Used to do gymnastics' },
  { name: 'Kavin', notes: 'Poway. Impulsive: skydiving. Recent obsession: vibecoding, Claude, antigravity, etc. Huge interest in making models via vibecoding' },
  { name: 'Shreyes', notes: 'Bay Area. Fidget spinners. Recent obsession: trying to be more into current news & events' },
  { name: 'Koda', notes: 'LA. Won a giveaway for a switch, thought it was a scam. Running. Questionable social fit' },
  { name: 'Neel', notes: '1st year Pennsylvania. End of sr year, booked an Airbnb last minute ocean city NJ. Spike ball' },
  { name: 'Kenneth', notes: '1st year. Zip lining in costa rica. Great vibes. Music production R&B' },
  { name: 'Farouk', notes: 'Middle East. Cancelled doing something with his friends to play Fortnite and got $200. Recent obsession: getting back into soccer' },
];

async function main() {
  const records = await base(TABLE).select({ maxRecords: 1000 }).all();
  const applicants = records
    .map(r => ({ id: r.id, name: (r.get('applicant_name') || ''), notes: (r.get('notes') || '') }))
    .filter(a => a.name.trim() !== '');

  console.log(`${applicants.length} applicants in Airtable\n`);

  let saved = 0, skipped = 0, noMatch = 0;

  for (const note of notes) {
    const q = note.name.toLowerCase();

    // Exact match
    let match = applicants.find(a => a.name.toLowerCase() === q);

    // First name match
    if (!match) {
      const firstName = q.split(/\s+/)[0];
      const firstMatches = applicants.filter(a => a.name.toLowerCase().split(/\s+/)[0] === firstName);
      if (firstMatches.length === 1) match = firstMatches[0];
      else if (firstMatches.length > 1) {
        // Try last name too
        const lastName = q.split(/\s+/).slice(1).join(' ');
        if (lastName) {
          const fullMatch = firstMatches.find(a => a.name.toLowerCase().includes(lastName));
          if (fullMatch) match = fullMatch;
        }
        if (!match) {
          console.log(`AMBIGUOUS (${firstMatches.length} matches): "${note.name}" → ${firstMatches.map(a => a.name).join(', ')}`);
          noMatch++;
          continue;
        }
      }
    }

    // Partial/contains match
    if (!match) {
      const contains = applicants.filter(a => a.name.toLowerCase().includes(q) || q.includes(a.name.toLowerCase()));
      if (contains.length === 1) match = contains[0];
    }

    if (!match) {
      console.log(`NO MATCH: "${note.name}"`);
      noMatch++;
      continue;
    }

    // Check if already saved
    const short = note.notes.substring(0, 25).toLowerCase().replace(/\s+/g, ' ');
    const existing = (match.notes || '').toLowerCase().replace(/\s+/g, ' ');
    if (short.length > 8 && existing.includes(short)) {
      console.log(`SKIP (already saved): ${match.name}`);
      skipped++;
      continue;
    }

    if (FIX) {
      const entry = `[${MEMBER} — ${DAY_LABEL}]: ${note.notes}`;
      const updated = match.notes ? match.notes + '\n' + entry : entry;
      try {
        await base(TABLE).update(match.id, { notes: updated });
        match.notes = updated;
        saved++;
        console.log(`SAVED: ${MEMBER} → ${match.name}`);
      } catch (e) {
        console.error(`ERROR: ${match.name}: ${e.message}`);
      }
      await sleep(200);
    } else {
      console.log(`WOULD SAVE: ${MEMBER} → ${match.name}: "${note.notes.substring(0, 60)}..."`);
    }
  }

  console.log(`\nTotal: ${notes.length} | Saved: ${saved} | Skipped: ${skipped} | No match: ${noMatch}`);
  if (!FIX) console.log('Run with --fix to actually save.');
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
