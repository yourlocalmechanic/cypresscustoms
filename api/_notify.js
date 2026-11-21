// Small helper: posts a short message to the Discord channel (same webhook as the bookings).
// Never throws; if the webhook is not set it does nothing.
module.exports = async function notify(title, text, color) {
  const hook = process.env.DISCORD_WEBHOOK_URL;
  if (!hook) return;
  try {
    await fetch(hook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'Cypress Customs Website',
        allowed_mentions: { parse: [] },
        embeds: [{ title: String(title).slice(0, 200), description: String(text).slice(0, 1000), color: color || 0xe0a526, timestamp: new Date().toISOString() }]
      })
    });
  } catch (e) {}
};
