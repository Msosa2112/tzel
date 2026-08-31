import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://ddwyutisxymuvofkjhpz.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { to, message, leadId, clientName } = req.body || {};

  if (!to || !message) {
    return res.status(400).json({ error: 'Faltan parámetros requeridos (to, message)' });
  }

  // Twilio credentials from env
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const fromNumber = process.env.TWILIO_PHONE_NUMBER || '+15025470644';

  if (!accountSid || !authToken) {
    return res.status(500).json({ error: 'Twilio no está configurado en el servidor' });
  }

  // Limpiar y formatear número de teléfono (E.164)
  const cleanDigits = to.replace(/[^\d]/g, '');
  const formattedTo = cleanDigits.length === 10 ? `+1${cleanDigits}` : cleanDigits.startsWith('1') ? `+${cleanDigits}` : `+${cleanDigits}`;

  try {
    const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;
    const authHeader = 'Basic ' + Buffer.from(`${accountSid}:${authToken}`).toString('base64');

    const params = new URLSearchParams();
    params.append('From', fromNumber);
    params.append('To', formattedTo);
    params.append('Body', message);

    const twilioRes = await fetch(twilioUrl, {
      method: 'POST',
      headers: {
        'Authorization': authHeader,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: params.toString()
    });

    const data = await twilioRes.json();

    if (!twilioRes.ok) {
      throw new Error(data.message || 'Error enviando SMS con Twilio');
    }

    // Actualizar estado del lead a 'contacted' en Supabase si se proporcionó leadId
    if (leadId) {
      await supabase
        .from('contacts')
        .update({ pipeline_status: 'contacted' })
        .eq('id', leadId);
    }

    return res.status(200).json({
      success: true,
      sid: data.sid,
      status: data.status,
      to: formattedTo,
      message: 'SMS enviado con éxito al cliente.'
    });
  } catch (err) {
    console.error('Error enviando SMS:', err);
    return res.status(500).json({ error: err.message });
  }
}
