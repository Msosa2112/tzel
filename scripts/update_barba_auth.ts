import * as fs from "fs";
import * as path from "path";

const authContextPath = "c:\\TRABAJO\\barba construction\\barba-crm\\src\\context\\AuthContext.jsx";

if (fs.existsSync(authContextPath)) {
  let content = fs.readFileSync(authContextPath, "utf-8");

  const targetCode = `export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);`;

  const newCode = `function getInitialSession() {
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith('sb-') && key.endsWith('-auth-token')) {
        const raw = localStorage.getItem(key);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed?.user) return parsed;
        }
      }
    }
  } catch {}
  return null;
}

export function AuthProvider({ children }) {
  const initialSession = getInitialSession();
  const [session, setSession] = useState(initialSession);
  const [profile, setProfile] = useState(() => initialSession ? getFallbackProfile(initialSession.user) : null);
  const [loading, setLoading] = useState(!initialSession);`;

  if (content.includes(targetCode)) {
    content = content.replace(targetCode, newCode);
    fs.writeFileSync(authContextPath, content, "utf-8");
    console.log("✅ AuthContext.jsx actualizado con carga síncrona instantánea.");
  } else {
    console.log("ℹ️ AuthContext ya estaba actualizado o código no coincide exactamente.");
  }
}
