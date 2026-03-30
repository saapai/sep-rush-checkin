# Friday Bot — Full Functionality Reference

## Overview
Friday is SEP's iMessage rush bot powered by GPT-4o-mini via SendBlue. It helps members manage rush by looking up applicants, collecting notes/ratings, and providing rush logistics.

## Architecture
```
User (iMessage) → SendBlue Webhook → /api/webhook.js → GPT-4o-mini → SendBlue Reply
                                          ↕
                                     Airtable (Rush Spring '26)
                                          ↕
                                     Supabase (photos)
```

## Tag System
GPT outputs structured tags in its replies. The backend parses and executes them before sending the cleaned message.

| Tag | Purpose | Example |
|-----|---------|---------|
| `[SAVE_NOTES:Full Name]content[/SAVE_NOTES]` | Save notes to Airtable | `[SAVE_NOTES:Buddy Heild]super chill[/SAVE_NOTES]` |
| `[SAVE_SCORES:Full Name:social:prof]` | Save 1-5 ratings (per-member) | `[SAVE_SCORES:Buddy Heild:4:5]` |
| `[EDIT_MY_NOTES:Full Name]new content[/EDIT_MY_NOTES]` | Replace own notes | `[EDIT_MY_NOTES:Buddy Heild]actually he was great[/EDIT_MY_NOTES]` |
| `[DELETE_MY_NOTES:Full Name]` | Delete own notes | `[DELETE_MY_NOTES:Buddy Heild]` |
| `[DELETE_MY_SCORES:Full Name]` | Delete own scores | `[DELETE_MY_SCORES:Buddy Heild]` |
| `[PHOTO:Full Name]` | Attach applicant photo | `[PHOTO:Buddy Heild]` |
| `[CLARIFY_PHOTOS:Name1\|Name2]` | Send multiple photos for disambiguation | `[CLARIFY_PHOTOS:Buddy Heild\|Glizz Heild]` |
| `[REACT:type]` | React to incoming message | `[REACT:love]` |

## Note-Taking Flow
1. Member texts notes about a rushee (e.g., "buddy heild was super chill")
2. GPT outputs `[SAVE_NOTES:Buddy Heild]super chill[/SAVE_NOTES]`
3. Backend: `fuzzyMatch` finds the applicant → `appendNotes` saves to Airtable
4. Notes format in Airtable: `[MemberName — Day N]: notes content`
5. AI summary auto-generated and saved to `notes_summary` field
6. GPT confirms and asks for social + prof ratings (1-5)
7. User gives ratings → GPT outputs `[SAVE_SCORES:Buddy Heild:4:5]`
8. Backend: `updateScores` calculates weighted average and saves
9. Backend appends real tally to reply: `buddy — you: 4s/5p, composite: 4.0 elo (2 ratings)`

## Scoring System
- **Social (1-5)**: 1=red flag, 2=bad, 3=okay/need more info, 4=good, 5=amazing
- **Professional (1-5)**: same scale
- **Elo**: average of social and prof averages across all raters
- **Weight**: number of unique members who have rated
- **Per-member tracking**: stored in `scores_raw` field as JSON: `{"Saathvik":{"s":4,"p":5},"Quinn":{"s":3,"p":4}}`
- If a member re-rates, their old score is REPLACED (not stacked)
- Averages recomputed from all individual entries each time
- Score confirmation is generated SERVER-SIDE with real Airtable data

## Permissions
- **Read**: ALL members can query ANY applicant data (full transparency)
- **Write notes**: Members can only ADD, EDIT, or DELETE their own notes (enforced by member attribution)
- **Write scores**: Members can only set/change/delete their own ratings (tracked per-member in `scores_raw`)
- A member CANNOT modify another member's notes or scores

## Disambiguation (Server-Side Enforced)
When `fuzzyMatch` returns multiple applicants for a name:
- Notes/scores are NOT saved
- Server appends: "hold on — which heild? buddy heild or glizz heild?"
- Photos of all matches are sent
- User must specify full name before proceeding

## Contact Card
- Sent on TRUE first message only (checks SendBlue history for any prior outbound messages)
- vCard file at `/public/friday.vcf` with Iron Man chibi profile pic
- Message: "save my contact so you don't lose me"

## Member Identification
- Hardcoded `MEMBER_DIRECTORY` maps phone numbers to names
- `getMemberName()` normalizes phone formats and does last-10-digit matching
- Member name used for: greeting, note attribution, system prompt context

## Deduplication
1. **In-memory Map**: tracks processed `message_handle` IDs, expires after 60s
2. **Pre-send check**: before sending reply, checks last 3 SendBlue messages — if latest is outbound, skips

## Message Flow
1. Webhook receives POST from SendBlue
2. Skip if: outbound, no content, same as FROM_NUMBER, duplicate
3. `processMessage`:
   a. Mark read + send typing indicator (fire and forget)
   b. Fetch message history + all applicants (parallel)
   c. Build system prompt with: rush context, current time/day, member name, applicant data
   d. Call GPT-4o-mini with system prompt + last 15 messages + current message
   e. Parse all tags from GPT reply
   f. Execute: reactions, notes, scores
   g. Server-side: score tally replacement, disambiguation
   h. Strip markdown, dedup check, send reply with photo if applicable
   i. Send contact card if first message

## Airtable Fields
| Field | Type | Description |
|-------|------|-------------|
| `applicant_name` | Text | Full name |
| `email` | Email | Contact email |
| `year` | Number | Graduation year |
| `status` | Select | Not Applied, Applied, Rejected |
| `photo` | URL | Supabase photo URL |
| `day_1` - `day_5` | Checkbox | Attendance per day |
| `notes` | Long text | Raw notes with attribution |
| `notes_summary` | Long text | AI-generated summary |
| `elo` | Number | Composite score (avg of social + prof) |
| `social` | Number | Weighted average social score |
| `prof` | Number | Weighted average professional score |
| `weight` | Number | Number of raters |

## Blast System (`/api/blast.js`)
- Cron-triggered reminders 45min before each rush event
- Sends to all non-opted-out SendBlue contacts
- Manual trigger: `/api/blast?day=N`
- 200ms delay between sends to avoid rate limiting

## Known Behaviors
- Temperature 0.7 for conversational variety
- Max 2500 tokens per GPT response
- Last 15 messages used for context window
- Notes use "Day N" labels instead of timestamps
- Easter egg: typing SEP member name on check-in page → dashboard access
- GPT reminded to mention easter egg whenever check-in link is shared
