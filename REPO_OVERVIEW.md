# SEP Rush ATS — Repo Overview

## Project Summary
Rush Check-In & Management System for Sigma Eta Pi (SEP) Spring 2026 rush at UCLA. Features an iMessage bot ("Friday") powered by GPT-4o-mini via SendBlue, a React dashboard for applicant tracking, and Airtable as the data backend. Supabase handles photo storage.

**Tech Stack:** Vite + React (TypeScript), Node.js (Vercel Serverless), Airtable, SendBlue, Supabase, OpenAI

## Architecture Diagram
```
User (iMessage) → SendBlue Webhook → /api/webhook.js (Vercel)
                                         ↓
                                    GPT-4o-mini (reasoning + tags)
                                         ↓
                                    Tag Parser → Airtable (CRUD)
                                         ↓
                                    SendBlue Reply → User (iMessage)

Dashboard (React) → Airtable API → Display applicants/scores/notes
                  → Supabase → Photos
                  → tRPC → Deliberation votes
```

## File/Directory Map
```
api/
  webhook.js         — Main iMessage bot handler (1150+ lines)
  blast.js           — Cron-triggered event reminders
src/
  pages/
    Dashboard.tsx    — Main dashboard with filtering/sorting
    ApplicantDetail.tsx — Detailed view + admin notes
    Photo.tsx        — Check-in photo capture
  components/
    Slideshow.tsx    — Photo gallery + scores display
    AppRouter.tsx    — Main navigation
    candidateList/   — Dashboard table components
    recentScroller/  — Recent activity scroller
    ui/              — Shadcn/ui components
  server/api/
    routers/
      candidates.ts  — Candidate data, Airtable sync
      post.ts        — Deliberation posts/votes
*.js (root)          — One-off data fix/import scripts
```

## Feature Logic & Flows

### iMessage Bot (Friday)
1. Receives webhook POST from SendBlue
2. Deduplicates + queues per-sender
3. Fetches cached applicant data (5min rush / 30min normal sync)
4. Builds system prompt with applicant data + pre-sorted rankings
5. Calls GPT-4o-mini → parses structured tags
6. Executes actions: save notes (parallel batches of 5), save scores, edit/delete
7. Server-side score tally overrides GPT output
8. Sends reply via SendBlue (max 2 messages per inbound)

### Scoring System
- Scale 1-5 (social + professional)
- ELO = (social + prof) / 2
- Per-member tracking via scores_raw JSON
- Bot does NOT proactively ask for ratings
- Scores accepted only when user voluntarily provides them
- Pre-sorted rankings computed server-side for accurate ranking queries

### Caching
- In-memory cache for Airtable data
- 5-minute refresh during rush hours (5 PM - 1 AM PT)
- 30-minute refresh otherwise
- Cache invalidated after any write operation

## Branching & Git Strategy
- **main**: Production branch, auto-deploys to Vercel
- HEAD currently on main

## Recent Changes Log

| Date | What | Why | Impact |
|------|------|-----|--------|
| 2026-04-01 | Filter note/score saves to Applied-status applicants only | Rejected applicants (e.g., Nikhil Vijay) caused false disambiguation with active applicants sharing first name | GPT nameList, buildApplicantSummary, mentionedNames, ambiguousFirstNames, fuzzyMatch for notes/scores all use activeApplicants (status=Applied). Full list still used for GPT query context and edit/delete operations. Tested: 1,3,5,10,20,40 person dumps all pass. Nikhil resolves directly, Sofia asks which one, Sofia V resolves to Valdez. |
| 2026-04-01 | GPT-based name matching, parallel saves, disambiguation | Notes silently dropped: regex name-splitting failed, no parallel saves, GPT truncation, no disambiguation for duplicate first names | Replaced regex splitNotesByPerson with chunkRawText (GPT matches names). Parallel batch saves (5). max_tokens on all GPT calls. Truncation→re-chunk fallback. Word-boundary name detection. [AMBIGUOUS:] tag for same-first-name conflicts (Sofia V vs Sofia L). Live tested 30 people — 30/30 saved. Cleaned up. |
| 2026-03-31 | Deduplicate check-in records by email | Multiple check-ins creating duplicate Airtable records | Photo.tsx: added email-based lookup fallback in checkApplicant + email check before creating new records in savePhoto. Dashboard dedup score now includes all 5 day fields. |
| 2026-03-31 | Remove proactive ELO prompting from iMessage | Users found rating prompts after notes annoying; scores should be opt-in | Bot no longer asks "rate em 1-5" after notes. Scores still save if user includes them. All query/read/delete score flows verified safe. |
| 2026-03-31 | Add Airtable caching with rush-hour sync | Bot was fetching all applicants on every message (slow, expensive) | 5-min cache during rush hours, 30-min otherwise. Cache invalidated after writes. |
| 2026-03-31 | Add server-side pre-sorted rankings | GPT hallucinated rankings with duplicates and wrong ordering | Rankings computed server-side, GPT instructed to copy them exactly. |
| 2026-03-31 | Parallelize note saves (batches of 5) | 30-person note dumps were timing out at 60s | Batch parallel writes + maxDuration increased to 300s. |
| 2026-03-31 | Anti-hallucination: NEVER infer scores from notes | GPT was generating LOCKEDSCORES and guessing ratings | Prompt explicitly forbids score inference; only saves user-provided numbers. |
