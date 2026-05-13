export function parseIncoming(body) {
  return {
    from: body.From,
    to: body.To,
    body: (body.Body || '').trim(),
    messageSid: body.MessageSid,
    numMedia: parseInt(body.NumMedia || '0', 10)
  };
}
