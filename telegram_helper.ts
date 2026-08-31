import axios from "axios";
import * as dotenv from "dotenv";

dotenv.config();

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Envía un mensaje estructurado premium a Telegram.
 * Prioriza enviar la foto con la ficha completa en el caption (1 solo globo de mensaje).
 */
export async function sendTelegramNotification(
  message: string,
  replyMarkup?: any,
  photoUrl: string | null = null,
  parseMode: "Markdown" | "HTML" = "HTML",
  retryCount = 0
): Promise<boolean> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) {
    console.log("[TELEGRAM] Advertencia: Credenciales de Telegram no configuradas.");
    return false;
  }

  if (retryCount > 3) {
    console.error("[TELEGRAM ERROR] Superado el número máximo de reintentos por rate limit (429).");
    return false;
  }

  // 1. Si hay foto
  if (photoUrl && photoUrl.startsWith("http")) {
    const urlPhoto = `https://api.telegram.org/bot${token}/sendPhoto`;
    
    // Si cabe en el caption de la foto (límite de Telegram: 1024 caracteres)
    if (message.length <= 1024) {
      try {
        const response = await axios.post(urlPhoto, {
          chat_id: chatId,
          photo: photoUrl,
          caption: message,
          parse_mode: parseMode,
          reply_markup: replyMarkup
        }, { timeout: 15000 });
        if (response.status === 200) return true;
      } catch (err: any) {
        if (err.response?.status === 429) {
          const retryAfter = err.response?.data?.parameters?.retry_after || 5;
          await sleep(retryAfter * 1000);
          return sendTelegramNotification(message, replyMarkup, photoUrl, parseMode, retryCount + 1);
        }
        console.warn(`[TELEGRAM PHOTO WARN] Falló sendPhoto (${err.message}). Enviando solo texto...`);
      }
    } else {
      // Mensaje largo con foto: enviar foto con resumen corto y luego el texto
      const summaryCaption = message.substring(0, 900) + "...";
      try {
        await axios.post(urlPhoto, {
          chat_id: chatId,
          photo: photoUrl,
          caption: summaryCaption,
          parse_mode: parseMode,
          reply_markup: replyMarkup
        }, { timeout: 15000 });
        return true;
      } catch (err: any) {
        if (err.response?.status === 429) {
          const retryAfter = err.response?.data?.parameters?.retry_after || 5;
          await sleep(retryAfter * 1000);
          return sendTelegramNotification(message, replyMarkup, photoUrl, parseMode, retryCount + 1);
        }
        console.warn(`[TELEGRAM PHOTO WARN] Falló sendPhoto largo: ${err.message}. Intentando texto.`);
      }
    }
  }

  // 2. Envío de texto estándar (sendMessage)
  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  
  // Limitar texto para evitar error 400
  let safeText = message;
  if (safeText.length > 4000) {
    safeText = safeText.substring(0, 3950) + "\n\n<i>[Ficha compactada para Telegram]</i>";
  }

  const payload: any = {
    chat_id: chatId,
    text: safeText,
    parse_mode: parseMode,
    disable_web_page_preview: true
  };

  if (replyMarkup) {
    payload.reply_markup = replyMarkup;
  }

  try {
    const response = await axios.post(url, payload, { timeout: 12000 });
    return response.status === 200;
  } catch (e: any) {
    if (e.response?.status === 429) {
      const retryAfter = e.response?.data?.parameters?.retry_after || 5;
      await sleep(retryAfter * 1000);
      return sendTelegramNotification(message, replyMarkup, null, parseMode, retryCount + 1);
    }
    console.error(`[TELEGRAM EXCEPTION] Error al enviar mensaje: ${e.message || e}`);
    if (e.response && e.response.data) {
      console.error("[TELEGRAM RESPONSE ERROR DETAIL]:", JSON.stringify(e.response.data));
    }
    return false;
  }
}
