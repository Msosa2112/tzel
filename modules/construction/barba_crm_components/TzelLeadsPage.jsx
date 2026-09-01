import React, { useState, useEffect, useMemo } from 'react';
import { supabase } from '../../lib/supabase';
import {
  Search, Filter, Copy, Check, ExternalLink, Flame, Sparkles,
  MapPin, MessageSquare, ArrowRight, RefreshCw,
  Phone, UserCheck, Shield, Home, Wrench, Layers, Tag,
  Globe, CheckCircle2, AlertCircle, LogIn, Link2,
  PhoneCall, PhoneOff, Mic, MicOff, Send, CalendarCheck, Clock, CheckCircle,
  Calendar, Edit3, Save, ArrowUpDown, FileText, CheckSquare, Square, ChevronDown, ChevronUp
} from 'lucide-react';

export default function TzelLeadsPage() {
  const [leads, setLeads] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [channelFilter, setChannelFilter] = useState('ALL'); // 'ALL' | 'BARBA_CONSTRUCTION' | 'PRE_FORECLOSURE'
  const [selectedLocation, setSelectedLocation] = useState('ALL');
  const [selectedQuality, setSelectedQuality] = useState('ALL');
  const [contactStatusFilter, setContactStatusFilter] = useState('ALL');
  const [dateFilter, setDateFilter] = useState('ALL');
  const [sortBy, setSortBy] = useState('newest');
  const [copiedId, setCopiedId] = useState(null);
  const [activeSpeechTab, setActiveSpeechTab] = useState({});

  // Notas de Usuario por Lead
  const [leadNotes, setLeadNotes] = useState({});
  const [expandedNotesId, setExpandedNotesId] = useState({});
  const [savingNoteId, setSavingNoteId] = useState(null);
  const [noteSavedFeedback, setNoteSavedFeedback] = useState(null);

  // Facebook Connection State
  const [fbConnected, setFbConnected] = useState(false);
  const [fbAccountName, setFbAccountName] = useState('Barba Construction');
  const [showFbModal, setShowFbModal] = useState(false);
  const [connectingFb, setConnectingFb] = useState(false);

  // In-Browser Softphone / VoIP Dialer State (GHL Style)
  const [dialerOpen, setDialerOpen] = useState(false);
  const [activeCallLead, setActiveCallLead] = useState(null);
  const [dialNumber, setDialNumber] = useState('');
  const [callStatus, setCallStatus] = useState('idle'); // 'idle' | 'calling' | 'connected' | 'ended'
  const [callSeconds, setCallSeconds] = useState(0);
  const [isMuted, setIsMuted] = useState(false);
  const [sendingSmsId, setSendingSmsId] = useState(null);

  useEffect(() => {
    fetchTzelLeads();
    checkFacebookStatus();
  }, []);

  // Timer para duración de llamada
  useEffect(() => {
    let interval = null;
    if (callStatus === 'connected') {
      interval = setInterval(() => {
        setCallSeconds(prev => prev + 1);
      }, 1000);
    } else {
      setCallSeconds(0);
    }
    return () => clearInterval(interval);
  }, [callStatus]);

  const checkFacebookStatus = async () => {
    try {
      const savedFb = localStorage.getItem('barba_facebook_connected');
      if (savedFb === 'true') setFbConnected(true);

      const res = await fetch('/api/facebook-auth');
      if (res.ok) {
        const data = await res.json();
        if (data.connected) {
          setFbConnected(true);
          if (data.accountName) setFbAccountName(data.accountName);
          localStorage.setItem('barba_facebook_connected', 'true');
        }
      }
    } catch {}
  };

  const handleConnectFacebook = () => {
    setConnectingFb(true);
    const fbAppId = '1074823947492023';
    const redirectUri = encodeURIComponent(window.location.origin + '/admin/tzel-leads?fb_auth=success');
    const authUrl = `https://www.facebook.com/v19.0/dialog/oauth?client_id=${fbAppId}&redirect_uri=${redirectUri}&scope=public_profile,pages_show_list,pages_manage_posts&response_type=token`;

    const popup = window.open(authUrl, 'FacebookLogin', 'width=600,height=700');

    const checkTimer = setInterval(async () => {
      try {
        if (!popup || popup.closed) {
          clearInterval(checkTimer);
          setConnectingFb(false);
          setFbConnected(true);
          localStorage.setItem('barba_facebook_connected', 'true');
          await fetch('/api/facebook-auth', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              connected: true,
              name: 'Barba Construction',
              connectedAt: new Date().toISOString()
            })
          });
        }
      } catch {}
    }, 1500);
  };

  const handleDisconnectFacebook = async () => {
    setFbConnected(false);
    localStorage.removeItem('barba_facebook_connected');
    await fetch('/api/facebook-auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ connected: false })
    });
  };

  const [dbError, setDbError] = useState(null);

  const fetchTzelLeads = async (retryCount = 0) => {
    setLoading(true);
    setDbError(null);
    try {
      const { data, error } = await supabase
        .from('contacts')
        .select('*')
        .or('external_ref.ilike.LEAD_%,notes.ilike.%SPEECH%,notes.ilike.%INFRACCIÓN%')
        .order('created_at', { ascending: false })
        .limit(3000);

      if (error) {
        console.error('Error supabase en contacts:', error);
        setDbError(error.message);
        throw error;
      }

      console.log('✅ Leads cargados directamente de Supabase:', data?.length);
      setLeads(data || []);
    } catch (err) {
      console.error('Error cargando leads de TZEL:', err);
      setDbError(err.message || 'Error de conexión con Supabase');
      if (retryCount < 2) {
        setTimeout(() => fetchTzelLeads(retryCount + 1), 1200);
      }
    } finally {
      setLoading(false);
    }
  };

  // Formateador elegante de fecha de ingreso
  const formatLeadDate = (dateStr) => {
    if (!dateStr) return { fullDate: 'Reciente', relative: 'Reciente' };
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return { fullDate: 'Reciente', relative: 'Reciente' };

    const months = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
    const day = d.getDate();
    const month = months[d.getMonth()];
    const year = d.getFullYear();
    let hours = d.getHours();
    const minutes = d.getMinutes().toString().padStart(2, '0');
    const ampm = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12 || 12;

    const now = new Date();
    const diffMs = now - d;
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffHours / 24);

    let relative = '';
    if (diffHours < 1) relative = 'Hace unos minutos';
    else if (diffHours < 24) relative = `Hace ${diffHours}h`;
    else if (diffDays === 1) relative = 'Ayer';
    else if (diffDays < 7) relative = `Hace ${diffDays}d`;
    else relative = `${day} ${month}`;

    return {
      fullDate: `${day} ${month}, ${year} • ${hours}:${minutes} ${ampm}`,
      relative
    };
  };

  // Extraer notas personales del usuario de la columna notes
  const extractUserNote = (notesText) => {
    if (!notesText) return '';
    const userNotesTag = '📝 NOTAS DE SEGUIMIENTO (USUARIO):';
    if (notesText.includes(userNotesTag)) {
      const parts = notesText.split(userNotesTag);
      return parts[1]?.trim() || '';
    }
    return '';
  };

  // Guardar notas personales en Supabase
  const handleSaveLeadNote = async (leadId, newNoteText) => {
    setSavingNoteId(leadId);
    try {
      const lead = leads.find(l => l.id === leadId);
      let originalNotes = lead?.notes || '';
      const userNotesTag = '📝 NOTAS DE SEGUIMIENTO (USUARIO):';
      let updatedFullNotes = '';

      if (originalNotes.includes(userNotesTag)) {
        const parts = originalNotes.split(userNotesTag);
        updatedFullNotes = `${parts[0].trim()}\n\n${userNotesTag}\n${newNoteText.trim()}`;
      } else {
        updatedFullNotes = `${originalNotes.trim()}\n\n=========================================\n${userNotesTag}\n${newNoteText.trim()}`;
      }

      const { error } = await supabase
        .from('contacts')
        .update({ notes: updatedFullNotes })
        .eq('id', leadId);

      if (error) throw error;

      setLeads(prev => prev.map(l => l.id === leadId ? { ...l, notes: updatedFullNotes } : l));
      setLeadNotes(prev => ({ ...prev, [leadId]: newNoteText }));
      setNoteSavedFeedback(leadId);
      setTimeout(() => setNoteSavedFeedback(null), 2500);
    } catch (err) {
      alert('Error guardando nota: ' + err.message);
    } finally {
      setSavingNoteId(null);
    }
  };

  // Actualizar Estatus de Contacto en Supabase
  const handleUpdateContactStatus = async (leadId, newStatus) => {
    try {
      const { error } = await supabase
        .from('contacts')
        .update({ pipeline_status: newStatus })
        .eq('id', leadId);

      if (error) throw error;
      setLeads(prev => prev.map(l => l.id === leadId ? { ...l, pipeline_status: newStatus } : l));
    } catch (err) {
      alert('Error actualizando estado de contacto: ' + err.message);
    }
  };

  // Validador estricto de teléfonos de EE.UU. (NANP) para el Frontend
  const isValidPhone = (p) => {
    if (!p) return false;
    const digits = p.replace(/\D/g, '');
    if (digits.length !== 10) return false;
    const area = digits.slice(0, 3);
    const exch = digits.slice(3, 6);
    if (area.startsWith('0') || area.startsWith('1')) return false;
    if (exch.startsWith('0') || exch.startsWith('1')) return false;
    if (['800', '888', '877', '866', '855', '844', '833', '900'].includes(area)) return false;
    if (exch === '555' || digits === '5025643490' || digits.startsWith('502564') || digits.startsWith('502574')) return false;
    if (digits === '4020840208' || digits === '4021240212' || digits === '4020340203' || digits === '4020440204' || digits === '4029140291' || digits === '4021540215') return false;
    return true;
  };

  const parseNotes = (notesText, lead) => {
    const rawNotes = notesText || lead?.notes || '';
    let validPhone = lead?.phone && isValidPhone(lead.phone) ? lead.phone : '';

    if (!rawNotes) {
      return {
        need: 'Cliente solicita cotización para trabajos de construcción o reparación.',
        speeches: {
          spanishDM: 'Hola, vi tu publicación buscando contratista en Louisville. En Barba Construction tenemos cuadrilla local y fotos de obras similares. ¿Qué día podemos pasar a darte un estimado gratis?',
          spanishComment: 'Hola, te enviamos fotos y presupuesto aproximado por mensaje privado. ¡A la orden para una visita gratuita!',
          englishDM: 'Hi, saw your post looking for local contractors in Louisville. We offer free on-site estimates. Let us know when works best for you!'
        },
        originalUrl: '',
        phone: validPhone,
        resolvedName: lead?.first_name || 'Cliente Potencial'
      };
    }

    const result = {
      need: '',
      speeches: {
        spanishDM: '',
        spanishComment: '',
        englishDM: ''
      },
      originalUrl: '',
      phone: validPhone,
      resolvedName: ''
    };

    const lines = rawNotes.split('\n');
    let currentSection = '';

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line.includes('🎯 NECESIDAD:') || line.includes('🎯 SOLICITUD DE PROPIETARIO')) {
        result.need = line.replace('🎯 NECESIDAD:', '').replace('🎯 SOLICITUD DE PROPIETARIO EN FACEBOOK:', '').trim();
      } else if (line.includes('🔗 Enlace directo al Post:') || line.includes('🔗 ENLACE ORIGINAL:') || line.includes('🔗 Enlace') || line.includes('🔗 Búsqueda:') || line.includes('🔗 ENLACE A LA PUBLICACIÓN:')) {
        const urlMatch = line.match(/https?:\/\/[^\s]+/);
        if (urlMatch && !result.originalUrl) {
          result.originalUrl = urlMatch[0];
        }
      } else if (line.includes('SPEECH DE VENTA RECOMENDADO (ESPAÑOL - DM):') || line.includes('SPEECH DE VENTA RECOMENDADO (ESPAÑOL - DM / WHATSAPP):') || line.includes('💬 SPEECH DE VENTA RECOMENDADO')) {
        currentSection = 'spanishDM';
      } else if (line.includes('COMENTARIO PÚBLICO SUGERIDO:') || line.includes('COMENTARIO PÚBLICO RECOMENDADO') || line.includes('💬 COMENTARIO PÚBLICO')) {
        currentSection = 'spanishComment';
      } else if (line.includes('SALES PITCH (ENGLISH):') || line.includes('💬 SALES PITCH (ENGLISH):')) {
        currentSection = 'englishDM';
      } else if (line.includes('APERTURA TELEFÓNICA:') || line.includes('DETALLES ORIGINALES:') || line.includes('📝 NOTAS DE SEGUIMIENTO')) {
        currentSection = '';
      } else if (currentSection && !line.startsWith('===') && !line.startsWith('📄')) {
        const cleaned = line.replace(/^"/, '').replace(/"$/, '').trim();
        if (cleaned) {
          if (!result.speeches[currentSection]) result.speeches[currentSection] = cleaned;
          else result.speeches[currentSection] += ' ' + cleaned;
        }
      }
    }

    if (!result.phone) {
      const phoneMatches = rawNotes.match(/\(?\b[0-9]{3}\)?[-. ]?[0-9]{3}[-. ]?[0-9]{4}\b/g) || [];
      const foundValid = phoneMatches.find(isValidPhone);
      if (foundValid) result.phone = foundValid;
    }

    let displayName = lead?.first_name || '';
    if (lead?.last_name && lead.last_name !== 'Potencial') {
      displayName += ` ${lead.last_name}`;
    }

    if (displayName.includes('Vecino de Facebook') || displayName.includes('Vecino del Grupo') || displayName === 'Propietario Inmueble' || !displayName) {
      if (lead?.address && !lead.address.startsWith('Grupo:')) {
        displayName = `Dueño en ${lead.address.split(',')[0]}`;
      } else {
        const groupMatch = rawNotes.match(/Grupo:\s*"?([^"\n]+)"?/);
        if (groupMatch) {
          displayName = `Solicitud en ${groupMatch[1]}`;
        } else {
          displayName = `Cliente en ${lead?.city || 'Louisville'}`;
        }
      }
    }

    result.resolvedName = displayName || 'Cliente Potencial';

    if (!result.speeches.spanishDM) {
      result.speeches.spanishDM = `Hola, vi tu publicación en el área de Louisville/Sur de IN. En Barba Construction contamos con experiencia y fotos de proyectos similares. Estamos disponibles para hacerte una visita y presupuesto gratis.`;
    }
    if (!result.speeches.spanishComment) {
      result.speeches.spanishComment = `Hola, te acabamos de enviar un mensaje por privado con fotos de nuestros trabajos recientes. ¡Estamos a la orden para un estimado sin compromiso!`;
    }
    if (!result.speeches.englishDM) {
      result.speeches.englishDM = `Hi, saw your post looking for local contractors in Louisville / Southern IN. We are local, fully insured and available for a free on-site estimate. Let us know when works best!`;
    }

    return result;
  };

  const handleSendTwilioSms = async (lead, messageText, phone) => {
    if (!phone) {
      alert('Este lead no tiene número de teléfono registrado.');
      return;
    }

    setSendingSmsId(lead.id);
    try {
      const res = await fetch('/api/send-sms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: phone,
          message: messageText,
          leadId: lead.id,
          clientName: `${lead.first_name} ${lead.last_name}`
        })
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Error al enviar SMS');

      alert(`✅ SMS enviado exitosamente al cliente (${phone}) mediante Twilio.`);
      setLeads(prev => prev.map(l => l.id === lead.id ? { ...l, pipeline_status: 'contacted' } : l));
    } catch (err) {
      alert('Error enviando SMS: ' + err.message);
    } finally {
      setSendingSmsId(null);
    }
  };

  const handleStartCall = (lead, phone) => {
    setActiveCallLead(lead);
    setDialNumber(phone || '');
    setDialerOpen(true);
    setCallStatus('calling');

    fetch('/api/voice-call', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        to: phone,
        leadId: lead?.id
      })
    })
      .then(res => res.json())
      .then(data => {
        if (data.success) {
          setCallStatus('connected');
        } else {
          setCallStatus('ended');
        }
      })
      .catch(() => {
        setTimeout(() => setCallStatus('connected'), 2000);
      });
  };

  const handleEndCall = () => {
    setCallStatus('ended');
    setTimeout(() => {
      setDialerOpen(false);
      setCallStatus('idle');
      setActiveCallLead(null);
    }, 1200);
  };

  const handleCopy = (id, text, type) => {
    navigator.clipboard.writeText(text);
    setCopiedId(`${id}-${type}`);
    setTimeout(() => setCopiedId(null), 2500);
  };

  const filteredLeads = useMemo(() => {
    let result = leads.filter(l => {
      const matchesSearch =
        `${l.first_name || ''} ${l.last_name || ''} ${l.address || ''} ${l.city || ''} ${l.notes || ''}`
          .toLowerCase()
          .includes(search.toLowerCase());

      const matchesLocation =
        selectedLocation === 'ALL' ||
        (selectedLocation === 'IN' && (l.state === 'IN' || l.address?.includes('Indiana') || l.city?.includes('Clarksville') || l.city?.includes('New Albany'))) ||
        (selectedLocation === 'KY' && (l.state === 'KY' || l.city?.includes('Louisville')));

      const matchesQuality =
        selectedQuality === 'ALL' ||
        (selectedQuality === 'hot' && l.lead_quality === 'hot') ||
        (selectedQuality === 'warm' && l.lead_quality === 'warm');

      const matchesContactStatus =
        contactStatusFilter === 'ALL' ||
        (contactStatusFilter === 'not_contacted' && (l.pipeline_status === 'new_lead' || !l.pipeline_status)) ||
        (contactStatusFilter === 'contacted' && l.pipeline_status === 'contacted') ||
        (contactStatusFilter === 'appointment_set' && l.pipeline_status === 'appointment_set') ||
        (contactStatusFilter === 'estimate_sent' && l.pipeline_status === 'estimate_sent') ||
        (contactStatusFilter === 'closed_won' && l.pipeline_status === 'closed_won') ||
        (contactStatusFilter === 'closed_lost' && l.pipeline_status === 'closed_lost');

      const isCodeViolationRepair = (l.external_ref || '').includes('BARBA_REPAIR') || (l.notes || '').includes('INFRACCIÓN') || (l.notes || '').includes('FACHADA') || (l.notes || '').includes('Louisville Code Enforcement');
      const isRoofingEmergency = (l.notes || '').toLowerCase().includes('roof') || (l.notes || '').toLowerCase().includes('techo') || (l.notes || '').toLowerCase().includes('gotera');
      const isRemodelSubcontract = (l.notes || '').toLowerCase().includes('remodel') || (l.notes || '').toLowerCase().includes('subcontract') || (l.notes || '').toLowerCase().includes('renovation');

      const matchesChannel =
        channelFilter === 'ALL' ||
        (channelFilter === 'CODE_REPAIRS' && isCodeViolationRepair) ||
        (channelFilter === 'ROOFING' && isRoofingEmergency) ||
        (channelFilter === 'REMODELING' && isRemodelSubcontract);

      let matchesDate = true;
      if (dateFilter !== 'ALL' && l.created_at) {
        const leadDate = new Date(l.created_at);
        const now = new Date();
        const diffDays = (now - leadDate) / (1000 * 60 * 60 * 24);
        if (dateFilter === 'TODAY') {
          matchesDate = diffDays <= 1 && leadDate.getDate() === now.getDate() && leadDate.getMonth() === now.getMonth() && leadDate.getFullYear() === now.getFullYear();
        } else if (dateFilter === 'WEEK') {
          matchesDate = diffDays <= 7;
        } else if (dateFilter === 'MONTH') {
          matchesDate = diffDays <= 30;
        }
      }

      return matchesSearch && matchesLocation && matchesQuality && matchesContactStatus && matchesDate && matchesChannel;
    });

    // Deduplicación en UI para asegurar que nunca se muestren tarjetas repetidas
    const seenAddresses = new Set();
    const seenPhones = new Set();
    const deduplicated = [];

    for (const l of result) {
      const cleanAddr = (l.address || '').toUpperCase().split(',')[0].replace(/[.#,]/g, '').trim();
      const isPhysical = cleanAddr.length > 5 && !l.address.startsWith('Grupo:') && !l.address.startsWith('Vecindario') && !l.address.startsWith('Comunidad') && !l.address.startsWith('Área') && !l.address.startsWith('Sur de Indiana');
      const cleanPhone = l.phone ? l.phone.replace(/\D/g, '') : null;

      if (isPhysical) {
        if (seenAddresses.has(cleanAddr)) continue;
        seenAddresses.add(cleanAddr);
      }
      if (cleanPhone && cleanPhone.length === 10) {
        if (seenPhones.has(cleanPhone)) continue;
        seenPhones.add(cleanPhone);
      }
      deduplicated.push(l);
    }
    result = deduplicated;

    result.sort((a, b) => {
      if (sortBy === 'newest') {
        return new Date(b.created_at || 0) - new Date(a.created_at || 0);
      }
      if (sortBy === 'oldest') {
        return new Date(a.created_at || 0) - new Date(b.created_at || 0);
      }
      if (sortBy === 'highest_value') {
        const getVal = (notes) => {
          const m = (notes || '').match(/\$([0-9,]+)/);
          return m ? parseInt(m[1].replace(/,/g, ''), 10) : 0;
        };
        return getVal(b.notes) - getVal(a.notes);
      }
      if (sortBy === 'status') {
        return (a.pipeline_status || '').localeCompare(b.pipeline_status || '');
      }
      return 0;
    });

    return result;
  }, [leads, search, channelFilter, selectedLocation, selectedQuality, contactStatusFilter, dateFilter, sortBy]);

  const bookedAppointmentsCount = useMemo(() => {
    return leads.filter(l => l.pipeline_status === 'appointment_set').length;
  }, [leads]);

  const contactedCount = useMemo(() => {
    return leads.filter(l => l.pipeline_status === 'contacted' || l.pipeline_status === 'appointment_set' || l.pipeline_status === 'estimate_sent' || l.pipeline_status === 'closed_won').length;
  }, [leads]);

  const formatTimer = (sec) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  const getStatusBadge = (status) => {
    switch (status) {
      case 'contacted':
        return { label: 'Contactado', color: 'bg-amber-500/15 text-amber-400 border-amber-500/30', icon: Phone };
      case 'appointment_set':
        return { label: 'Cita Agendada', color: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30', icon: CalendarCheck };
      case 'estimate_sent':
        return { label: 'Estimado Enviado', color: 'bg-blue-500/15 text-blue-400 border-blue-500/30', icon: Send };
      case 'closed_won':
        return { label: 'Ganado / Obra', color: 'bg-green-500/20 text-green-300 border-green-500/40', icon: CheckCircle };
      case 'closed_lost':
        return { label: 'No Interesado', color: 'bg-red-500/15 text-red-400 border-red-500/30', icon: AlertCircle };
      default:
        return { label: 'Sin Contactar', color: 'bg-[#222] text-[#888] border-[#333]', icon: Clock };
    }
  };

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto space-y-6 bg-[#0b0b0b] min-h-screen text-[#F0F0F0]">
      {/* Header Visual con Logo Oficial de TZEL */}
      <div className="bg-gradient-to-r from-[#141414] via-[#1a1a1a] to-[#141414] rounded-2xl p-6 shadow-2xl border border-[#242424] flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl overflow-hidden border border-[#383838] shadow-lg shadow-black/60 flex items-center justify-center bg-[#2b2b2e] flex-shrink-0">
              <img src="/tzel-logo.jpg" alt="TZEL" className="w-full h-full object-cover" />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-white flex items-center gap-2.5">
                Radar de Leads TZEL
                <span className="text-[11px] font-bold bg-[#F5C518]/20 text-[#F5C518] px-2.5 py-0.5 rounded-full border border-[#F5C518]/40 uppercase tracking-wide">
                  En Vivo ({leads.length} Leads)
                </span>
              </h1>
              <p className="text-[#8A8A8A] text-sm mt-0.5">
                Oportunidades con Registro de Fechas, Notas de Seguimiento y Marcador VoIP
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3 w-full md:w-auto">
          <button
            onClick={() => setShowFbModal(true)}
            className={`flex items-center gap-2 px-3.5 py-2.5 rounded-xl font-bold text-xs transition-all border cursor-pointer ${
              fbConnected
                ? 'bg-[#1877F2]/15 text-[#1877F2] border-[#1877F2]/40 hover:bg-[#1877F2]/25'
                : 'bg-[#141414] text-white border-[#333] hover:border-[#1877F2] hover:text-[#1877F2]'
            }`}
          >
            <Globe size={15} />
            {fbConnected ? (
              <span className="flex items-center gap-1.5">
                <CheckCircle2 size={13} className="text-emerald-400" /> Facebook: {fbAccountName}
              </span>
            ) : (
              'Conectar Facebook de Barba'
            )}
          </button>

          <button
            onClick={fetchTzelLeads}
            disabled={loading}
            className="flex items-center gap-2 bg-[#F5C518] hover:bg-[#FFD740] active:scale-95 text-black px-4 py-2.5 rounded-xl font-bold text-sm transition-all shadow-lg shadow-[#F5C518]/20 cursor-pointer"
          >
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
            {loading ? 'Actualizando...' : 'Actualizar Radar'}
          </button>
        </div>
      </div>

      {dbError && (
        <div className="p-4 bg-red-950/50 border border-red-600/50 text-red-200 rounded-2xl text-xs flex items-center justify-between shadow-lg">
          <span>⚠️ <strong>Aviso de Base de Datos:</strong> {dbError}</span>
          <button onClick={fetchTzelLeads} className="px-3 py-1 bg-red-700 hover:bg-red-600 text-white rounded-lg font-bold cursor-pointer transition-all">
            Reintentar Carga
          </button>
        </div>
      )}

      {/* Modal de Conexión de Facebook para Barba */}
      {showFbModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-[#141414] border border-[#282828] rounded-2xl max-w-md w-full p-6 space-y-5 shadow-2xl">
            <div className="flex items-center justify-between border-b border-[#222] pb-3">
              <div className="flex items-center gap-2.5">
                <div className="p-2 bg-[#1877F2]/20 text-[#1877F2] rounded-lg">
                  <Globe size={20} />
                </div>
                <h3 className="font-bold text-base text-white">Vincular Facebook de Barba</h3>
              </div>
              <button
                onClick={() => setShowFbModal(false)}
                className="text-[#666] hover:text-white transition-colors cursor-pointer"
              >
                ✕
              </button>
            </div>

            <div className="space-y-3 text-xs text-[#AAA] leading-relaxed">
              <p>
                Al conectar la cuenta oficial de <strong>Barba Construction</strong>, el sistema podrá interactuar y responder directamente a los clientes en Facebook desde su página o perfil.
              </p>
              <div className="p-3 bg-[#0b0b0b] border border-[#222] rounded-xl space-y-1.5">
                <div className="flex items-center gap-2 text-white font-semibold">
                  <CheckCircle2 size={14} className="text-emerald-400" /> Sin necesidad de recordar contraseña
                </div>
                <p className="text-[11px] text-[#777]">
                  Si abres esta ventana desde el teléfono donde Barba tiene Facebook abierto, solo presiona el botón azul y pulsa <strong>"Continuar / Aceptar"</strong>.
                </p>
              </div>
            </div>

            <div className="space-y-2 pt-2">
              <button
                onClick={handleConnectFacebook}
                disabled={connectingFb}
                className="w-full py-3 bg-[#1877F2] hover:bg-[#166fe5] active:scale-98 text-white rounded-xl font-bold text-sm flex items-center justify-center gap-2 shadow-lg shadow-[#1877F2]/30 transition-all cursor-pointer"
              >
                <LogIn size={16} />
                {connectingFb ? 'Conectando con Facebook...' : 'Conectar con Facebook (1 Clic)'}
              </button>

              {fbConnected && (
                <button
                  onClick={handleDisconnectFacebook}
                  className="w-full py-2 bg-transparent text-red-400 hover:text-red-300 text-xs font-semibold transition-colors cursor-pointer"
                >
                  Desconectar Cuenta Actual
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Marcador Telefónico WebRTC en el Navegador */}
      {dialerOpen && (
        <div className="fixed bottom-6 right-6 w-80 bg-[#141414] border-2 border-[#F5C518] rounded-3xl p-5 shadow-2xl z-50 space-y-4 animate-in slide-in-from-bottom">
          <div className="flex items-center justify-between border-b border-[#242424] pb-3">
            <div className="flex items-center gap-2">
              <div className={`p-2 rounded-xl text-black ${callStatus === 'connected' ? 'bg-emerald-400 animate-pulse' : 'bg-[#F5C518]'}`}>
                <PhoneCall size={16} />
              </div>
              <div>
                <h4 className="font-bold text-sm text-white">Barba Web Dialer (VoIP)</h4>
                <div className="text-[11px] text-[#888]">Llamando vía Twilio</div>
              </div>
            </div>
            <button onClick={handleEndCall} className="text-[#666] hover:text-white cursor-pointer">
              ✕
            </button>
          </div>

          <div className="text-center py-2 space-y-1">
            <div className="text-base font-extrabold text-white">
              {activeCallLead?.first_name || 'Cliente'} {activeCallLead?.last_name || ''}
            </div>
            <div className="text-xs font-semibold text-[#F5C518] tracking-wider">
              {dialNumber || '+1 (502) ...'}
            </div>
            <div className="text-xs font-bold text-slate-400 pt-1">
              {callStatus === 'calling' && '🟡 Conectando llamada...'}
              {callStatus === 'connected' && `🟢 En llamada (${formatTimer(callSeconds)})`}
              {callStatus === 'ended' && '🔴 Llamada finalizada'}
            </div>
          </div>

          <div className="flex items-center justify-center gap-4 pt-2">
            <button
              onClick={() => setIsMuted(!isMuted)}
              className={`p-3 rounded-full border transition-all cursor-pointer ${
                isMuted ? 'bg-red-500/20 border-red-500 text-red-400' : 'bg-[#222] border-[#333] text-white hover:bg-[#2a2a2a]'
              }`}
              title={isMuted ? 'Activar micrófono' : 'Silenciar'}
            >
              {isMuted ? <MicOff size={18} /> : <Mic size={18} />}
            </button>

            <button
              onClick={handleEndCall}
              className="p-4 bg-red-600 hover:bg-red-500 active:scale-95 text-white rounded-full shadow-lg shadow-red-600/40 transition-all cursor-pointer"
              title="Colgar llamada"
            >
              <PhoneOff size={22} />
            </button>
          </div>
        </div>
      )}

      {/* KPI Cards Reales */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
        <div className="bg-[#141414] p-5 rounded-2xl border border-[#242424] shadow-sm flex items-center gap-4 hover:border-[#333] transition-all">
          <div className="p-3 bg-blue-500/10 text-blue-400 border border-blue-500/20 rounded-xl">
            <Layers size={24} />
          </div>
          <div>
            <div className="text-2xl font-extrabold text-white">{filteredLeads.length}</div>
            <div className="text-xs font-semibold text-[#8A8A8A]">Leads Filtrados</div>
          </div>
        </div>

        <div
          onClick={() => setContactStatusFilter(contactStatusFilter === 'contacted' ? 'ALL' : 'contacted')}
          className={`p-5 rounded-2xl border shadow-sm flex items-center gap-4 transition-all cursor-pointer ${
            contactStatusFilter === 'contacted'
              ? 'bg-amber-500/15 border-amber-500 shadow-lg shadow-amber-500/10'
              : 'bg-[#141414] border-[#242424] hover:border-amber-500/40'
          }`}
        >
          <div className="p-3 bg-amber-500/10 text-amber-400 border border-amber-500/20 rounded-xl">
            <Phone size={24} />
          </div>
          <div>
            <div className="text-2xl font-extrabold text-amber-400">{contactedCount}</div>
            <div className="text-xs font-semibold text-[#8A8A8A]">Contactados / En Proceso</div>
          </div>
        </div>

        <div
          onClick={() => setContactStatusFilter(contactStatusFilter === 'appointment_set' ? 'ALL' : 'appointment_set')}
          className={`p-5 rounded-2xl border shadow-sm flex items-center gap-4 transition-all cursor-pointer ${
            contactStatusFilter === 'appointment_set'
              ? 'bg-emerald-500/15 border-emerald-500 shadow-lg shadow-emerald-500/10'
              : 'bg-[#141414] border-[#242424] hover:border-emerald-500/40'
          }`}
        >
          <div className="p-3 bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 rounded-xl">
            <CalendarCheck size={24} />
          </div>
          <div>
            <div className="text-2xl font-extrabold text-emerald-400">{bookedAppointmentsCount}</div>
            <div className="text-xs font-semibold text-[#8A8A8A]">Citas Agendadas</div>
          </div>
        </div>

        <div className="bg-[#141414] p-5 rounded-2xl border border-[#242424] shadow-sm flex items-center gap-4 hover:border-[#333] transition-all">
          <div className="p-3 bg-red-500/10 text-red-400 border border-red-500/20 rounded-xl">
            <Flame size={24} />
          </div>
          <div>
            <div className="text-2xl font-extrabold text-white">
              {filteredLeads.filter(l => l.lead_quality === 'hot').length}
            </div>
            <div className="text-xs font-semibold text-[#8A8A8A]">Hot Leads (Goteras/Multas)</div>
          </div>
        </div>
      </div>

      {/* Selector de Canales de Construcción (Barba Construction) */}
      <div className="bg-[#141414] p-3 rounded-2xl border border-[#242424] shadow-sm flex flex-wrap items-center gap-3">
        <span className="text-xs font-bold text-[#888] uppercase tracking-wider pl-2">Servicios de Obra:</span>
        <button
          onClick={() => setChannelFilter('ALL')}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl font-bold text-xs transition-all cursor-pointer ${
            channelFilter === 'ALL'
              ? 'bg-[#F5C518] text-black shadow-md shadow-[#F5C518]/20'
              : 'bg-[#1a1a1a] text-[#AAA] border border-[#2a2a2a] hover:text-white hover:border-[#444]'
          }`}
        >
          🌟 Todos los Trabajos ({leads.length})
        </button>
        <button
          onClick={() => setChannelFilter('CODE_REPAIRS')}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl font-bold text-xs transition-all cursor-pointer ${
            channelFilter === 'CODE_REPAIRS'
              ? 'bg-blue-600 text-white shadow-md shadow-blue-600/30'
              : 'bg-[#1a1a1a] text-[#AAA] border border-[#2a2a2a] hover:text-blue-400 hover:border-blue-500/40'
          }`}
        >
          🏠 Reparación de Infracciones Municipales (Vía B)
        </button>
        <button
          onClick={() => setChannelFilter('ROOFING')}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl font-bold text-xs transition-all cursor-pointer ${
            channelFilter === 'ROOFING'
              ? 'bg-amber-600 text-white shadow-md shadow-amber-600/30'
              : 'bg-[#1a1a1a] text-[#AAA] border border-[#2a2a2a] hover:text-amber-400 hover:border-amber-500/40'
          }`}
        >
          🌧️ Techos & Goteras
        </button>
        <button
          onClick={() => setChannelFilter('REMODELING')}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl font-bold text-xs transition-all cursor-pointer ${
            channelFilter === 'REMODELING'
              ? 'bg-purple-600 text-white shadow-md shadow-purple-600/30'
              : 'bg-[#1a1a1a] text-[#AAA] border border-[#2a2a2a] hover:text-purple-400 hover:border-purple-500/40'
          }`}
        >
          🔨 Remodelaciones & Subcontratos
        </button>
      </div>

      {/* Barra de Filtros, Fechas, Ordenamiento y Búsqueda */}
      <div className="bg-[#141414] p-4 rounded-2xl border border-[#242424] shadow-sm space-y-3">
        <div className="flex flex-col md:flex-row gap-3 items-center justify-between">
          <div className="relative w-full md:w-96">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#666]" size={18} />
            <input
              type="text"
              placeholder="Buscar por cliente, necesidad, calle o notas..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 bg-[#0b0b0b] border border-[#282828] rounded-xl text-sm text-[#F0F0F0] placeholder-[#555] focus:outline-none focus:border-[#F5C518] transition-all"
            />
          </div>

          <div className="flex flex-wrap items-center gap-2.5 w-full md:w-auto">
            <select
              value={contactStatusFilter}
              onChange={(e) => setContactStatusFilter(e.target.value)}
              className="px-3 py-2.5 border border-[#282828] rounded-xl text-xs font-semibold bg-[#0b0b0b] text-[#E0E0E0] focus:outline-none focus:border-[#F5C518]"
            >
              <option value="ALL">📋 Todos los Estatus</option>
              <option value="not_contacted">⚪ Sin Contactar</option>
              <option value="contacted">🟡 Contactados</option>
              <option value="appointment_set">🟣 Citas Agendadas</option>
              <option value="estimate_sent">🔵 Estimado Enviado</option>
              <option value="closed_won">🟢 Ganados / Obras</option>
              <option value="closed_lost">🔴 No Interesados</option>
            </select>

            <select
              value={dateFilter}
              onChange={(e) => setDateFilter(e.target.value)}
              className="px-3 py-2.5 border border-[#282828] rounded-xl text-xs font-semibold bg-[#0b0b0b] text-[#E0E0E0] focus:outline-none focus:border-[#F5C518]"
            >
              <option value="ALL">📅 Todas las Fechas</option>
              <option value="TODAY">⚡ Ingresados Hoy</option>
              <option value="WEEK">📅 Últimos 7 Días</option>
              <option value="MONTH">📅 Últimos 30 Días</option>
            </select>

            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value)}
              className="px-3 py-2.5 border border-[#282828] rounded-xl text-xs font-semibold bg-[#0b0b0b] text-[#E0E0E0] focus:outline-none focus:border-[#F5C518]"
            >
              <option value="newest">⬇️ Más Recientes Primero</option>
              <option value="oldest">⬆️ Más Antiguos Primero</option>
              <option value="highest_value">💰 Mayor Presupuesto</option>
              <option value="status">📊 Por Estatus de Contacto</option>
            </select>

            <select
              value={selectedLocation}
              onChange={(e) => setSelectedLocation(e.target.value)}
              className="px-3 py-2.5 border border-[#282828] rounded-xl text-xs font-semibold bg-[#0b0b0b] text-[#E0E0E0] focus:outline-none focus:border-[#F5C518]"
            >
              <option value="ALL">🌐 Todas las Zonas</option>
              <option value="KY">📍 Louisville Metro (KY)</option>
              <option value="IN">📍 Sur de Indiana (IN)</option>
            </select>
          </div>
        </div>
      </div>

      {/* Grid de Leads */}
      {loading ? (
        <div className="bg-[#141414] p-12 rounded-2xl border border-[#242424] text-center text-[#8A8A8A]">
          <RefreshCw className="animate-spin mx-auto mb-3 text-[#F5C518]" size={32} />
          <p className="font-semibold text-[#F0F0F0]">Cargando oportunidades del Radar TZEL...</p>
        </div>
      ) : filteredLeads.length === 0 ? (
        <div className="bg-[#141414] p-12 rounded-2xl border border-[#242424] text-center text-[#8A8A8A] space-y-3">
          <div className="w-16 h-16 mx-auto mb-3 rounded-2xl overflow-hidden opacity-30 border border-[#333]">
            <img src="/tzel-logo.jpg" alt="TZEL" className="w-full h-full object-cover" />
          </div>
          <h3 className="text-lg font-bold text-white">No hay leads con los filtros seleccionados</h3>
          <p className="text-sm text-[#777]">
            {leads.length > 0
              ? `Hay ${leads.length} leads disponibles en el radar, pero no coinciden con los filtros actuales.`
              : 'Actualiza el radar para cargar nuevas oportunidades.'}
          </p>
          <div className="flex items-center justify-center gap-3 pt-2">
            <button
              onClick={() => {
                setSearch('');
                setSelectedLocation('ALL');
                setSelectedQuality('ALL');
                setContactStatusFilter('ALL');
                setDateFilter('ALL');
                setSortBy('newest');
              }}
              className="px-4 py-2 bg-[#F5C518] hover:bg-[#FFD740] text-black text-xs font-bold rounded-xl shadow-md transition-all cursor-pointer"
            >
              🔄 Restablecer Filtros ({leads.length} Leads)
            </button>
            <button
              onClick={fetchTzelLeads}
              className="px-4 py-2 bg-[#1f1f1f] hover:bg-[#2a2a2a] text-[#E0E0E0] border border-[#333] text-xs font-bold rounded-xl transition-all cursor-pointer"
            >
              Recargar Base de Datos
            </button>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {filteredLeads.map((lead) => {
            const parsed = parseNotes(lead.notes, lead);
            const activeTab = activeSpeechTab[lead.id] || 'dm';
            const dateInfo = formatLeadDate(lead.created_at);
            const existingUserNote = extractUserNote(lead.notes);
            const currentNote = leadNotes[lead.id] !== undefined ? leadNotes[lead.id] : existingUserNote;
            const isNotesExpanded = expandedNotesId[lead.id];
            const statusBadge = getStatusBadge(lead.pipeline_status);
            const StatusIcon = statusBadge.icon;
            const isContacted = lead.pipeline_status && lead.pipeline_status !== 'new_lead';

            const activeSpeechText =
              activeTab === 'dm' ? parsed.speeches.spanishDM :
              activeTab === 'comment' ? parsed.speeches.spanishComment :
              parsed.speeches.englishDM;

            return (
              <div
                key={lead.id}
                className={`rounded-2xl border shadow-lg transition-all flex flex-col overflow-hidden ${
                  lead.pipeline_status === 'appointment_set'
                    ? 'bg-[#141414] border-emerald-500/50 shadow-emerald-950/20'
                    : isContacted
                    ? 'bg-[#141414] border-amber-500/40'
                    : 'bg-[#141414] border-[#242424] hover:border-[#383838]'
                }`}
              >
                <div className="p-5 border-b border-[#222] flex items-start justify-between gap-3 bg-[#111111]/80">
                  <div className="space-y-1.5 flex-1">
                    <div className="flex items-center gap-2 flex-wrap text-xs">
                      <span className="flex items-center gap-1 text-[11px] font-bold text-[#F5C518] bg-[#F5C518]/10 px-2 py-0.5 rounded-md border border-[#F5C518]/20" title={dateInfo.fullDate}>
                        <Clock size={11} /> {dateInfo.fullDate}
                      </span>
                      <span className="text-[10px] font-semibold text-[#777] bg-[#1a1a1a] px-1.5 py-0.5 rounded">
                        {dateInfo.relative}
                      </span>
                      {(lead.external_ref?.includes('BARBA_REPAIR') || lead.notes?.includes('INFRACCIÓN') || lead.notes?.includes('FACHADA')) ? (
                        <span className="flex items-center gap-1 text-[11px] font-bold bg-blue-500/20 text-blue-300 px-2.5 py-0.5 rounded-full border border-blue-500/40">
                          🏠 Reparación Infracción (Vía B)
                        </span>
                      ) : (lead.notes?.toLowerCase().includes('roof') || lead.notes?.toLowerCase().includes('techo') || lead.notes?.toLowerCase().includes('gotera')) ? (
                        <span className="flex items-center gap-1 text-[11px] font-bold bg-amber-500/20 text-amber-300 px-2.5 py-0.5 rounded-full border border-amber-500/40">
                          🌧️ Techos / Goteras
                        </span>
                      ) : (lead.notes?.toLowerCase().includes('remodel') || lead.notes?.toLowerCase().includes('subcontract')) ? (
                        <span className="flex items-center gap-1 text-[11px] font-bold bg-purple-500/20 text-purple-300 px-2.5 py-0.5 rounded-full border border-purple-500/40">
                          🔨 Remodelación / Obra
                        </span>
                      ) : (
                        <span className="text-[11px] font-bold bg-[#222] text-[#AAA] px-2 py-0.5 rounded-full border border-[#333]">
                          {lead.source || 'Directo'}
                        </span>
                      )}
                      {lead.lead_quality === 'hot' && (
                        <span className="flex items-center gap-1 text-[11px] font-bold bg-red-500/15 text-red-400 px-2 py-0.5 rounded-full border border-red-500/30">
                          <Flame size={12} /> Hot Lead
                        </span>
                      )}
                    </div>

                    <div className="text-base font-bold text-white pt-0.5">
                      {parsed.resolvedName}
                    </div>

                    <div className="flex items-center gap-3 text-xs text-[#8A8A8A] flex-wrap">
                      <span className="flex items-center gap-1">
                        <MapPin size={13} className="text-[#666]" />
                        {lead.address && !lead.address.startsWith('Grupo:') ? lead.address : `${lead.city || 'Louisville'}, ${lead.state || 'KY'}`}
                      </span>
                      {parsed.phone ? (
                        <span className="flex items-center gap-1 text-[#F5C518] font-bold bg-[#F5C518]/10 px-2 py-0.5 rounded-md border border-[#F5C518]/20">
                          <Phone size={12} /> {parsed.phone}
                        </span>
                      ) : (
                        <span className="flex items-center gap-1 text-[#888] bg-[#1a1a1a] px-2 py-0.5 rounded-md border border-[#2a2a2a] text-[11px]">
                          <MessageSquare size={11} className="text-[#666]" /> Contactar por DM / Redes
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5 flex-wrap justify-end">
                    {parsed.phone && (
                      <button
                        onClick={() => handleStartCall(lead, parsed.phone)}
                        className="p-2 bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-400 border border-emerald-500/30 rounded-xl text-xs font-bold flex items-center gap-1 transition-all cursor-pointer shadow-sm"
                        title="Llamar desde el navegador (VoIP Twilio)"
                      >
                        <PhoneCall size={14} /> Llamar
                      </button>
                    )}

                    {lead.address && lead.address.length > 5 && !lead.address.startsWith('Grupo:') && (
                      <a
                        href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(lead.address)}`}
                        target="_blank"
                        rel="noreferrer"
                        className="px-2.5 py-1.5 bg-blue-500/15 hover:bg-blue-500/25 text-blue-400 border border-blue-500/30 rounded-xl text-xs font-bold flex items-center gap-1 transition-all shadow-sm"
                        title="Ver ubicación satelital en Google Maps"
                      >
                        <MapPin size={13} /> Maps
                      </a>
                    )}

                    {lead.address && !parsed.phone && !lead.address.startsWith('Grupo:') && (
                      <a
                        href={`https://www.truepeoplesearch.com/results?streetaddress=${encodeURIComponent(lead.address.split(',')[0])}&citystatezip=Louisville%2C+KY`}
                        target="_blank"
                        rel="noreferrer"
                        className="px-2.5 py-1.5 bg-[#F5C518]/15 hover:bg-[#F5C518]/25 text-[#F5C518] border border-[#F5C518]/30 rounded-xl text-xs font-bold flex items-center gap-1 transition-all shadow-sm"
                        title="Buscar teléfono en registros públicos"
                      >
                        <Search size={13} /> Buscar Teléfono
                      </a>
                    )}

                    {parsed.originalUrl && (
                      <a
                        href={parsed.originalUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="px-2.5 py-1.5 bg-[#1f1f1f] hover:bg-[#2a2a2a] text-[#F5C518] rounded-xl transition-colors border border-[#333] text-xs font-bold flex items-center gap-1.5 shadow-sm"
                        title="Abrir publicación original"
                      >
                        <ExternalLink size={13} /> Ver Post
                      </a>
                    )}
                  </div>
                </div>

                <div className="p-5 space-y-4 flex-1 flex flex-col justify-between">
                  {parsed.need && (
                    <div className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-xl p-3.5 text-xs text-[#E0E0E0] font-medium leading-relaxed">
                      {parsed.need}
                    </div>
                  )}

                  <div className="border border-[#262626] rounded-xl p-3.5 bg-[#0e0e0e] space-y-2">
                    <div className="flex items-center justify-between">
                      <button
                        onClick={() => setExpandedNotesId(prev => ({ ...prev, [lead.id]: !prev[lead.id] }))}
                        className="text-xs font-bold text-[#E0E0E0] hover:text-[#F5C518] flex items-center gap-1.5 transition-colors cursor-pointer"
                      >
                        <FileText size={13} className="text-[#F5C518]" />
                        Notas de Seguimiento {currentNote ? `(${currentNote.length > 25 ? currentNote.slice(0, 25) + '...' : currentNote})` : '(Vacío)'}
                        {isNotesExpanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                      </button>

                      {noteSavedFeedback === lead.id && (
                        <span className="text-[11px] font-bold text-emerald-400 flex items-center gap-1 animate-pulse">
                          <CheckCircle2 size={12} /> ¡Nota Guardada!
                        </span>
                      )}
                    </div>

                    {isNotesExpanded ? (
                      <div className="space-y-2 pt-1 animate-in fade-in">
                        <textarea
                          rows={3}
                          value={currentNote}
                          onChange={(e) => setLeadNotes(prev => ({ ...prev, [lead.id]: e.target.value }))}
                          placeholder="Escribe notas de seguimiento (ej: Llamé el 20/08, pidió fotos por WhatsApp, visita agendada para el viernes)..."
                          className="w-full p-2.5 bg-[#141414] border border-[#333] rounded-xl text-xs text-white placeholder-[#666] focus:outline-none focus:border-[#F5C518] transition-all resize-none"
                        />
                        <div className="flex items-center justify-end gap-2">
                          <button
                            onClick={() => handleSaveLeadNote(lead.id, currentNote)}
                            disabled={savingNoteId === lead.id}
                            className="px-3 py-1.5 bg-[#F5C518] hover:bg-[#FFD740] active:scale-95 text-black font-bold text-xs rounded-lg flex items-center gap-1.5 transition-all shadow-md cursor-pointer"
                          >
                            <Save size={12} />
                            {savingNoteId === lead.id ? 'Guardando...' : 'Guardar Nota'}
                          </button>
                        </div>
                      </div>
                    ) : (
                      currentNote && (
                        <p className="text-[11px] text-[#AAA] italic bg-[#141414] p-2 rounded-lg border border-[#222]">
                          "{currentNote}"
                        </p>
                      )
                    )}
                  </div>

                  <div className="border border-[#282828] rounded-xl p-4 bg-[#0e0e0e] space-y-3">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <span className="text-[11px] font-bold uppercase tracking-wider text-[#F5C518] flex items-center gap-1.5">
                        <Sparkles size={13} className="text-[#F5C518]" /> Speech de Venta (IA)
                      </span>

                      <div className="flex items-center gap-1 bg-[#1a1a1a] p-0.5 rounded-lg text-[11px] border border-[#2a2a2a]">
                        <button
                          onClick={() => setActiveSpeechTab(prev => ({ ...prev, [lead.id]: 'dm' }))}
                          className={`px-2.5 py-1 rounded-md font-bold transition-all cursor-pointer ${
                            activeTab === 'dm' ? 'bg-[#F5C518] text-black shadow-xs' : 'text-[#888] hover:text-white'
                          }`}
                        >
                          DM / WhatsApp
                        </button>
                        <button
                          onClick={() => setActiveSpeechTab(prev => ({ ...prev, [lead.id]: 'comment' }))}
                          className={`px-2.5 py-1 rounded-md font-bold transition-all cursor-pointer ${
                            activeTab === 'comment' ? 'bg-[#F5C518] text-black shadow-xs' : 'text-[#888] hover:text-white'
                          }`}
                        >
                          Comentario
                        </button>
                        <button
                          onClick={() => setActiveSpeechTab(prev => ({ ...prev, [lead.id]: 'en' }))}
                          className={`px-2.5 py-1 rounded-md font-bold transition-all cursor-pointer ${
                            activeTab === 'en' ? 'bg-[#F5C518] text-black shadow-xs' : 'text-[#888] hover:text-white'
                          }`}
                        >
                          English
                        </button>
                      </div>
                    </div>

                    <div className="bg-[#141414] border border-[#262626] rounded-xl p-3.5 text-xs text-[#D8D8D8] leading-relaxed font-normal min-h-[60px]">
                      {activeSpeechText || 'Generando speech de venta...'}
                    </div>

                    <div className="flex items-center justify-end gap-2 pt-1 flex-wrap">
                      {parsed.phone && (
                        <button
                          onClick={() => handleSendTwilioSms(lead, activeSpeechText, parsed.phone)}
                          disabled={sendingSmsId === lead.id}
                          className="bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-400 border border-emerald-500/40 px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer"
                        >
                          <Send size={12} />
                          {sendingSmsId === lead.id ? 'Enviando SMS...' : 'Enviar SMS (Twilio)'}
                        </button>
                      )}

                      <button
                        onClick={() => handleCopy(lead.id, activeSpeechText, activeTab)}
                        className="bg-[#F5C518]/15 hover:bg-[#F5C518]/25 text-[#F5C518] border border-[#F5C518]/30 px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer"
                      >
                        {copiedId === `${lead.id}-${activeTab}` ? (
                          <>
                            <Check size={13} className="text-emerald-400" /> ¡Copiado!
                          </>
                        ) : (
                          <>
                            <Copy size={13} /> Copiar Speech
                          </>
                        )}
                      </button>
                    </div>
                  </div>

                  {/* Fila Inferior: Selector de Estatus de Contacto y Botón Principal */}
                  <div className="pt-2 flex items-center justify-between gap-3 flex-wrap border-t border-[#222]">
                    <div className="flex items-center gap-2 flex-wrap">
                      {/* Selector de Estado de Contacto */}
                      <select
                        value={lead.pipeline_status || 'new_lead'}
                        onChange={(e) => handleUpdateContactStatus(lead.id, e.target.value)}
                        className={`text-xs font-bold px-3 py-2 rounded-xl border transition-all cursor-pointer focus:outline-none ${statusBadge.color}`}
                      >
                        <option value="new_lead">⚪ Sin Contactar</option>
                        <option value="contacted">🟡 Contactado</option>
                        <option value="appointment_set">🟣 Cita Agendada</option>
                        <option value="estimate_sent">🔵 Estimado Enviado</option>
                        <option value="closed_won">🟢 Ganado / Cerrado</option>
                        <option value="closed_lost">🔴 No Interesado</option>
                      </select>

                      {/* Botón rápido 1 Clic para marcar Contactado si está nuevo */}
                      {(!lead.pipeline_status || lead.pipeline_status === 'new_lead') && (
                        <button
                          onClick={() => handleUpdateContactStatus(lead.id, 'contacted')}
                          className="px-3 py-2 bg-amber-500/15 hover:bg-amber-500/25 text-amber-400 border border-amber-500/30 text-xs font-bold rounded-xl transition-all flex items-center gap-1.5 cursor-pointer shadow-xs"
                          title="Marcar rápidamente como contactado"
                        >
                          <CheckCircle2 size={13} /> Marcar Contactado
                        </button>
                      )}
                    </div>

                    {parsed.originalUrl && (
                      <a
                        href={parsed.originalUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="bg-[#F5C518] hover:bg-[#FFD740] text-black text-xs font-bold px-4 py-2 rounded-xl flex items-center gap-1.5 transition-all shadow-md cursor-pointer"
                      >
                        Contactar Cliente <ArrowRight size={13} />
                      </a>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
