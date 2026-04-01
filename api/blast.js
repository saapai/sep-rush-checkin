const FROM_NUMBER = '+17139626862';

// SEP Member directory — hardcoded phone numbers for reliable blast delivery
const MEMBER_NUMBERS = [
  '+13853687238', '+19175288704', '+14259790010', '+18588293100', '+13038450766',
  '+18573964806', '+13105717011', '+13235091761', '+14088051435', '+13105008359',
  '+18588374987', '+15083175184', '+19252971911', '+13108737200', '+14244660408',
  '+15102196504', '+14086490769', '+18189299990', '+13105059297', '+14438963819',
  '+13232706359', '+14259791041', '+13105971118', '+15058199928', '+18184398818',
  '+19253369249', '+19259008019', '+14155359656', '+15108993006', '+19132938404',
  '+16573637311', '+13103673514', '+14692741037', '+19734376074', '+14086685541',
  '+14698290081', '+14244075337', '+19967574792', '+16508636891', '+13107808121',
  '+17606930594', '+13609314664', '+14087636262', '+18585275611', '+16505186293',
  '+13104866781', '+16508899373', '+16503461001', '+19494669092', '+16577240606',
  '+15596531293', '+16264786106', '+14152718271', '+16196435215', '+17478888100',
];

async function sbAPI(method, path, body) {
  const opts = {
    method,
    headers: {
      'Content-Type': 'application/json',
      'sb-api-key-id': process.env.SENDBLUE_API_KEY,
      'sb-api-secret-key': process.env.SENDBLUE_API_SECRET,
    },
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`https://api.sendblue.com${path}`, opts);
  return res.json();
}

async function sendMessage(to, content) {
  return sbAPI('POST', '/api/send-message', { number: to, from_number: FROM_NUMBER, content });
}

async function getAllContacts() {
  const data = await sbAPI('GET', '/api/v2/contacts?limit=500');
  if (!data.data) return [];
  return data.data
    .filter(c => c.number && c.number !== FROM_NUMBER && !c.opted_out)
    .map(c => c.number);
}

const EVENTS = [
  {
    date: '2026-03-30',
    name: 'Meet the Chapter',
    time: '6:30 PM',
    place: 'Pauley Pavilion',
    outfit: 'Rush T-Shirt + casual',
    blastHour: 17, blastMin: 45,
    message: `hey! just a reminder — Meet the Chapter kicks off tonight at 6:30 PM at Pauley Pavilion 🤝 wear your rush t-shirt + casual. see you there!`,
  },
  {
    date: '2026-03-31',
    name: 'Social Night',
    time: '6:30 PM',
    place: 'Pauley Pavilion',
    outfit: 'Casual',
    blastHour: 17, blastMin: 45,
    message: `social night tonight! 6:30 PM at Pauley Pavilion, dress casual. come ready to have a good time 🎉`,
  },
  {
    date: '2026-04-01',
    name: 'Professional Night',
    time: '6:30 PM',
    place: 'Kerchoff Grand Salon',
    outfit: 'Business Professional',
    blastHour: 17, blastMin: 45,
    message: `professional night tonight at 6:30 PM! head to Kerchoff Grand Salon, dress business professional 💼 don't be late!`,
  },
  {
    date: '2026-04-02',
    name: 'Coffee Chats',
    time: '6:30 PM',
    place: 'Engineering IV Patio',
    outfit: 'Casual',
    blastHour: 17, blastMin: 45,
    message: `coffee chats tonight! 6:30 PM at Engineering IV Patio, casual dress. excited for some 1-on-1 convos ☕`,
  },
  {
    date: '2026-04-03',
    name: 'Final Interviews',
    time: '11:00 AM',
    place: 'John Wooden Center',
    outfit: 'Business Professional',
    blastHour: 10, blastMin: 15,
    message: `final interviews today starting at 11:00 AM at John Wooden Center! dress business professional. you got this 🙌`,
  },
];

function getPDTNow() {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }));
}

function getDateStr(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export default async function handler(req, res) {
  try {
    const now = getPDTNow();
    const today = getDateStr(now);
    const currentHour = now.getHours();
    const currentMin = now.getMinutes();

    // Check if manual trigger with force parameter
    const forceDay = req.query?.day;

    let eventToBlast = null;

    if (forceDay) {
      // Manual trigger: blast for specific day
      const dayIndex = parseInt(forceDay) - 1;
      if (dayIndex >= 0 && dayIndex < EVENTS.length) {
        eventToBlast = EVENTS[dayIndex];
      }
    } else {
      // Cron trigger: check if any event is 45 mins away
      eventToBlast = EVENTS.find(e => {
        if (e.date !== today) return false;
        // Check if we're within 15 min of the blast time (to handle cron imprecision)
        const blastMinTotal = e.blastHour * 60 + e.blastMin;
        const nowMinTotal = currentHour * 60 + currentMin;
        return Math.abs(nowMinTotal - blastMinTotal) <= 15;
      });
    }

    if (!eventToBlast) {
      console.log(`No blast needed. PDT time: ${now.toLocaleTimeString()}, date: ${today}`);
      return res.status(200).json({ ok: true, message: 'No blast needed right now' });
    }

    console.log(`Blasting for: ${eventToBlast.name}`);

    // Use hardcoded member list (Sendblue contacts API is unreliable)
    const contacts = MEMBER_NUMBERS;
    console.log(`Sending to ${contacts.length} contacts`);

    // Send to all contacts with small delays to avoid rate limiting
    const results = [];
    for (const number of contacts) {
      try {
        const result = await sendMessage(number, eventToBlast.message);
        results.push({ number, status: result.status || 'sent' });
        // Small delay between sends
        await new Promise(r => setTimeout(r, 200));
      } catch (e) {
        results.push({ number, status: 'error', error: e.message });
      }
    }

    console.log(`Blast complete: ${results.length} messages sent`);

    return res.status(200).json({
      ok: true,
      event: eventToBlast.name,
      sent: results.length,
      results,
    });
  } catch (error) {
    console.error('Blast error:', error);
    return res.status(500).json({ ok: false, error: error.message });
  }
}
