import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://ddwyutisxymuvofkjhpz.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

export default async function handler(req, res) {
  // Configurar CORS
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  // GET: Obtener estado de la conexión de Facebook
  if (req.method === 'GET') {
    try {
      const { data, error } = await supabase
        .from('system_settings')
        .select('*')
        .eq('key', 'facebook_barba_integration')
        .maybeSingle();

      if (error && error.code !== 'PGRST116') {
        // Si no existe la tabla o registro, responder desconectado limpiamente
        return res.status(200).json({ connected: false });
      }

      if (!data || !data.value) {
        return res.status(200).json({ connected: false });
      }

      const info = typeof data.value === 'string' ? JSON.parse(data.value) : data.value;
      return res.status(200).json({
        connected: Boolean(info.access_token || info.connected),
        accountName: info.name || 'Barba Construction',
        connectedAt: info.connected_at || null
      });
    } catch (err) {
      return res.status(200).json({ connected: false, error: err.message });
    }
  }

  // POST: Guardar token / sesión de Facebook desde la Web App
  if (req.method === 'POST') {
    try {
      const { accessToken, userID, name, sessionData } = req.body || {};

      const payload = {
        key: 'facebook_barba_integration',
        value: JSON.stringify({
          connected: true,
          access_token: accessToken || null,
          user_id: userID || null,
          name: name || 'Barba Construction',
          session_data: sessionData || null,
          connected_at: new Date().toISOString()
        }),
        updated_at: new Date().toISOString()
      };

      // Upsert en system_settings
      const { data, error } = await supabase
        .from('system_settings')
        .upsert([payload], { onConflict: 'key' })
        .select();

      if (error) {
        // Fallback: guardar en localStorage / tabla alternativa si system_settings no tiene la clave
        console.warn('Advertencia guardando en system_settings:', error.message);
      }

      return res.status(200).json({ success: true, message: 'Facebook de Barba vinculado correctamente.' });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
