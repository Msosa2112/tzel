import * as fs from 'fs';
import * as path from 'path';

function patchAdminLayoutWithTzelIcon() {
  const crmDir = path.resolve('c:/TRABAJO/barba construction/barba-crm');
  const adminLayoutPath = path.join(crmDir, 'src/layouts/AdminLayout.jsx');

  if (fs.existsSync(adminLayoutPath)) {
    let layoutContent = fs.readFileSync(adminLayoutPath, 'utf8');
    
    // Add TzelIcon component definition if not present
    if (!layoutContent.includes('const TzelIcon =')) {
      layoutContent = layoutContent.replace(
        "export default function AdminLayout({ profile, onSignOut }) {",
        "const TzelIcon = () => (\n  <img src=\"/tzel-logo.png\" alt=\"TZEL\" style={{ width: 18, height: 18, objectFit: 'contain', borderRadius: 3 }} />\n);\n\nexport default function AdminLayout({ profile, onSignOut }) {"
      );
    }

    // Update nav item to use TzelIcon and clean label
    layoutContent = layoutContent.replace(
      "{ to: '/admin/tzel-leads', icon: Radar, label: '📡 Leads de TZEL' },",
      "{ to: '/admin/tzel-leads', icon: TzelIcon, label: 'Leads de TZEL' },"
    );

    fs.writeFileSync(adminLayoutPath, layoutContent, 'utf8');
    console.log('✅ [AdminLayout.jsx] Icono de TZEL configurado en la barra lateral.');
  }
}

patchAdminLayoutWithTzelIcon();
