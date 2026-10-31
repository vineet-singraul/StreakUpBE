// Rotating notification lines used between the few Gemini slots per day (zero AI cost).
// {name} {task} {done} {total} {left} are filled in; the pick rotates every 30 minutes.

const T = {
  pending: {
    en: [
      ['⏰ {task} is waiting', '{done}/{total} done, {name}. Knock out "{task}" next!'],
      ['💪 Quick win: {task}', 'Just {left} left today. Start "{task}" for 10 minutes now.'],
      ['🔥 Keep the streak alive', '"{task}" is still pending. You have got this, {name}!'],
      ['🎯 Next up: {task}', 'Small step now beats a big plan later. Go!'],
    ],
    hi: [
      ['⏰ {task} बाकी है', '{name}, {done}/{total} हो गए। अब "{task}" निपटा दो!'],
      ['💪 छोटी जीत: {task}', 'आज सिर्फ़ {left} काम बचे हैं। "{task}" अभी 10 मिनट के लिए शुरू करो।'],
      ['🔥 स्ट्रीक बनाए रखो', '"{task}" अभी बाकी है। तुम कर सकते हो, {name}!'],
      ['🎯 अगला काम: {task}', 'अभी एक छोटा कदम, बाद के बड़े प्लान से बेहतर है।'],
    ],
    hinglish: [
      ['⏰ {task} wait kar raha hai', '{name}, {done}/{total} ho gaye. Ab "{task}" khatam karo!'],
      ['💪 Quick win: {task}', 'Aaj sirf {left} bache hain. "{task}" abhi 10 minute ke liye shuru karo.'],
      ['🔥 Streak mat todna', '"{task}" abhi pending hai. Tum kar loge, {name}!'],
      ['🎯 Next: {task}', 'Abhi ek chhota step, baad ke bade plan se behtar hai. Chalo!'],
    ],
  },
  none: {
    en: [['📝 Plan your day, {name}', 'No tasks yet today. Add 3 quick ones in a minute!'], ['🗓️ Empty list?', 'Write today\'s top 3 tasks now and start ticking.']],
    hi: [['📝 आज का प्लान बनाओ, {name}', 'आज अभी तक कोई काम नहीं। 1 मिनट में 3 काम जोड़ दो!'], ['🗓️ लिस्ट खाली है?', 'आज के 3 सबसे ज़रूरी काम अभी लिखो।']],
    hinglish: [['📝 Aaj ka plan banao, {name}', 'Abhi tak koi task nahi. 1 minute me 3 tasks add kar lo!'], ['🗓️ List khaali hai?', 'Aaj ke top 3 tasks abhi likho aur tick karna shuru karo.']],
  },
  done: {
    en: [['🎉 {done}/{total} done!', 'Brilliant, {name}! Rest well or plan tomorrow in 2 minutes.']],
    hi: [['🎉 {done}/{total} पूरे!', 'शानदार, {name}! आराम करो या 2 मिनट में कल का प्लान बना लो।']],
    hinglish: [['🎉 {done}/{total} done!', 'Shabash {name}! Aaram karo ya 2 minute me kal ka plan bana lo.']],
  },
};

export function templateLine({ state, language, name, task = '', done = 0, total = 0 }) {
  const set = T[state][language] || T[state].hinglish;
  const [title, body] = set[Math.floor(Date.now() / (30 * 60 * 1000)) % set.length];
  const fill = (s) => s
    .replaceAll('{name}', name).replaceAll('{task}', task)
    .replaceAll('{done}', done).replaceAll('{total}', total).replaceAll('{left}', total - done);
  return { title: fill(title), body: fill(body) };
}
