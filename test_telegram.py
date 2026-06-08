import os
import requests
from dotenv import load_dotenv

load_dotenv()

token = os.getenv("TELEGRAM_BOT_TOKEN")
chat_id = os.getenv("TELEGRAM_CHAT_ID")

def test_telegram():
    if not token or not chat_id:
        print("[ERROR] TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID is missing from .env")
        print("\nPara configurar Telegram:")
        print("1. Busca @BotFather en Telegram y crea un bot con /newbot. Copia el token de acceso.")
        print("2. Abre una conversación con tu bot e inicia con /start.")
        print("3. Busca un bot como @userinfobot o @GetIDsBot para obtener tu ID de chat personal.")
        print("4. Agrega estas variables a tu archivo .env:")
        print("   TELEGRAM_BOT_TOKEN=tu_token_aqui")
        print("   TELEGRAM_CHAT_ID=tu_chat_id_aqui")
        return

    print(f"Enviando mensaje de prueba a Telegram...")
    url = f"https://api.telegram.org/bot{token}/sendMessage"
    payload = {
        "chat_id": chat_id,
        "text": "🤖 *Conexión Exitosa con Antigravity IDE*\n\n¡Tu bot de Surplus Funds & Distressed Properties está configurado y listo para enviarte notificaciones en tiempo real!",
        "parse_mode": "Markdown"
    }
    
    try:
        response = requests.post(url, json=payload, timeout=10)
        print(f"Status Code: {response.status_code}")
        if response.status_code == 200:
            print("[SUCCESS] ¡Mensaje enviado con éxito! Revisa tu Telegram.")
        else:
            print(f"[FAILED] Error response: {response.text}")
    except Exception as e:
        print(f"[EXCEPTION] Ocurrió un error al conectar: {e}")

if __name__ == "__main__":
    test_telegram()
