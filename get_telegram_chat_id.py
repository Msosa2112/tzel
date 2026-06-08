import os
import requests
from dotenv import load_dotenv

load_dotenv()

token = os.getenv("TELEGRAM_BOT_TOKEN")
if not token:
    print("[ERROR] TELEGRAM_BOT_TOKEN not found in .env")
    exit(1)

def get_chat_id():
    url = f"https://api.telegram.org/bot{token}/getUpdates"
    print("Fetching updates from your Telegram Bot...")
    try:
        response = requests.get(url, timeout=10)
        if response.status_code == 200:
            data = response.json()
            result = data.get("result", [])
            if not result:
                print("\n[INFO] No se encontraron mensajes aún.")
                print("Por favor, sigue estos pasos:")
                print("1. Abre tu aplicación de Telegram.")
                print("2. Busca el bot que acabas de crear (el que te dio el Token).")
                print("3. Presiona el botón 'Iniciar' o envíale un mensaje de texto (ej. 'hola').")
                print("4. Ejecuta de nuevo este script.")
                return
            
            # Get the last message's chat ID
            last_update = result[-1]
            message = last_update.get("message")
            if not message:
                print("[ERROR] No se pudo encontrar el objeto 'message' en la actualización.")
                return
                
            chat = message.get("chat")
            chat_id = chat.get("id")
            first_name = chat.get("first_name", "Usuario")
            
            print(f"\n[SUCCESS] ¡Mensaje recibido de {first_name}!")
            print(f"Chat ID encontrado: {chat_id}")
            
            # Save to .env
            env_content = ""
            if os.path.exists(".env"):
                with open(".env", "r") as f:
                    env_content = f.read()
            
            lines = env_content.splitlines()
            new_lines = []
            for line in lines:
                if not line.startswith("TELEGRAM_CHAT_ID="):
                    new_lines.append(line)
            new_lines.append(f"TELEGRAM_CHAT_ID={chat_id}")
            
            with open(".env", "w") as f:
                f.write("\n".join(new_lines) + "\n")
            print("[SUCCESS] Guardado TELEGRAM_CHAT_ID en tu archivo .env")
            
            # Send confirmation message
            confirm_url = f"https://api.telegram.org/bot{token}/sendMessage"
            payload = {
                "chat_id": chat_id,
                "text": f"🤖 *¡Hola {first_name}!* Tu ID de chat ({chat_id}) ha sido detectado y guardado con éxito en el sistema. Ya recibirás aquí las notificaciones de nuevos leads en tiempo real.",
                "parse_mode": "Markdown"
            }
            requests.post(confirm_url, json=payload)
            print("[SUCCESS] Se envió un mensaje de confirmación a tu chat de Telegram.")
            
        else:
            print(f"[FAILED] Error del servidor de Telegram: {response.text}")
    except Exception as e:
        print(f"[EXCEPTION] Ocurrió un error al conectar: {e}")

if __name__ == "__main__":
    get_chat_id()
